using Cascad.Api.Contracts.Voice;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Cascad.Api.Hubs;
using Cascad.Api.Options;
using Cascad.Api.Realtime;
using Cascad.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/voice")]
[Authorize]
public sealed class VoiceController : ControllerBase
{
    private const string VoiceSessionReplacedCode = "VOICE_SESSION_REPLACED";
    private const string VoiceServerModeratedCode = "VOICE_SERVER_MODERATED";

    private readonly AppDbContext _db;
    private readonly IHubContext<ChatHub> _hubContext;
    private readonly ILiveKitTokenService _liveKitTokenService;
    private readonly LiveKitOptions _liveKitOptions;
    private readonly VoicePresenceOptions _voicePresenceOptions;
    private readonly IVoicePresenceMaintenanceService _voicePresenceMaintenance;

    public VoiceController(
        AppDbContext db,
        IHubContext<ChatHub> hubContext,
        ILiveKitTokenService liveKitTokenService,
        IOptions<LiveKitOptions> liveKitOptions,
        IOptions<VoicePresenceOptions> voicePresenceOptions,
        IVoicePresenceMaintenanceService voicePresenceMaintenance)
    {
        _db = db;
        _hubContext = hubContext;
        _liveKitTokenService = liveKitTokenService;
        _liveKitOptions = liveKitOptions.Value;
        _voicePresenceOptions = voicePresenceOptions.Value;
        _voicePresenceMaintenance = voicePresenceMaintenance;
    }

    [HttpPost("connect")]
    [ProducesResponseType<VoiceConnectResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<VoiceConnectResponse>> Connect(
        [FromBody] VoiceConnectRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return Unauthorized();
        }

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == request.ChannelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null || channel.Type != ChannelType.Voice)
        {
            return NotFound();
        }

        var isMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == channel.WorkspaceId && x.UserId == userId,
            cancellationToken);
        if (!isMember)
        {
            return Forbid();
        }

        await _voicePresenceMaintenance.CleanupStaleVoiceStateAsync(cancellationToken);

        var existingSessions = await _db.VoiceSessions
            .Where(x => x.UserId == userId)
            .ToListAsync(cancellationToken);
        var previousVoiceChannelId = existingSessions
            .OrderByDescending(x => x.LastSeenAtUtc)
            .Select(x => (Guid?)x.ChannelId)
            .FirstOrDefault();
        foreach (var session in existingSessions.Where(x => x.ChannelId != channel.Id))
        {
            _db.VoiceSessions.Remove(session);
        }

        var currentParticipants = await _db.VoiceSessions.CountAsync(
            x => x.ChannelId == channel.Id,
            cancellationToken);
        if (channel.MaxParticipants.HasValue)
        {
            var isAlreadyInChannel = existingSessions.Any(x => x.ChannelId == channel.Id);
            if (!isAlreadyInChannel && currentParticipants >= channel.MaxParticipants.Value)
            {
                return BadRequest(new ProblemDetails
                {
                    Title = "Channel is full"
                });
            }
        }

        var now = DateTime.UtcNow;
        var sessionInstanceId = Guid.NewGuid().ToString("N");
        var current = existingSessions.SingleOrDefault(x => x.ChannelId == channel.Id);
        if (current is null)
        {
            _db.VoiceSessions.Add(new VoiceSession
            {
                ChannelId = channel.Id,
                UserId = userId,
                IsMuted = false,
                IsDeafened = false,
                SessionInstanceId = sessionInstanceId,
                ConnectedAtUtc = now,
                LastSeenAtUtc = now
            });
        }
        else
        {
            current.SessionInstanceId = sessionInstanceId;
            current.LastSeenAtUtc = now;
        }

        await _db.SaveChangesAsync(cancellationToken);

        var moderationState = await GetVoiceModerationStateAsync(channel.WorkspaceId, userId, cancellationToken);
        if (previousVoiceChannelId != channel.Id)
        {
            var effectiveState = ResolveEffectiveVoiceState(
                selfMuted: current?.IsMuted ?? false,
                selfDeafened: current?.IsDeafened ?? false,
                moderationState);
            await BroadcastVoicePresenceChangedAsync(
                workspaceId: channel.WorkspaceId,
                userId: user.Id,
                username: user.Username,
                avatarUrl: user.AvatarUrl,
                previousVoiceChannelId: previousVoiceChannelId,
                currentVoiceChannelId: channel.Id,
                isMuted: effectiveState.IsMuted,
                isDeafened: effectiveState.IsDeafened,
                isServerMuted: effectiveState.IsServerMuted,
                isServerDeafened: effectiveState.IsServerDeafened,
                occurredAtUtc: now,
                cancellationToken: cancellationToken);
        }

        var rtcToken = _liveKitTokenService.GenerateToken(channel, user);
        return Ok(new VoiceConnectResponse(
            channel.Id,
            channel.Name,
            channel.LiveKitRoomName ?? $"voice-{channel.Id:N}",
            rtcToken,
            _liveKitOptions.RtcUrl,
            sessionInstanceId,
            channel.MaxParticipants,
            channel.MaxConcurrentStreams));
    }

    [HttpPost("disconnect")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Disconnect(
        [FromBody] VoiceDisconnectRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var sessionsQuery = _db.VoiceSessions
            .Where(x => x.UserId == userId && (!request.ChannelId.HasValue || x.ChannelId == request.ChannelId.Value));

        if (!string.IsNullOrWhiteSpace(request.SessionInstanceId))
        {
            var trimmedSessionId = request.SessionInstanceId.Trim();
            sessionsQuery = sessionsQuery.Where(x => x.SessionInstanceId == trimmedSessionId);
        }

        var sessions = await sessionsQuery
            .ToListAsync(cancellationToken);
        if (sessions.Count > 0)
        {
            _db.VoiceSessions.RemoveRange(sessions);
        }

        List<VoiceStreamPublication> streams;
        if (!string.IsNullOrWhiteSpace(request.SessionInstanceId))
        {
            var channelIds = sessions.Select(x => x.ChannelId).Distinct().ToArray();
            if (channelIds.Length == 0)
            {
                streams = new List<VoiceStreamPublication>();
            }
            else
            {
                streams = await _db.VoiceStreamPublications
                    .Where(x => x.UserId == userId && channelIds.Contains(x.ChannelId))
                    .ToListAsync(cancellationToken);
            }
        }
        else
        {
            streams = await _db.VoiceStreamPublications
                .Where(x => x.UserId == userId && (!request.ChannelId.HasValue || x.ChannelId == request.ChannelId.Value))
                .ToListAsync(cancellationToken);
        }

        if (streams.Count > 0)
        {
            _db.VoiceStreamPublications.RemoveRange(streams);
        }

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _db.ChangeTracker.Clear();
        }

        if (sessions.Count > 0)
        {
            var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
            if (user is not null)
            {
                var sessionChannelIds = sessions.Select(x => x.ChannelId).Distinct().ToArray();
                var affectedChannels = await _db.Channels
                    .Where(x => !x.IsDeleted && sessionChannelIds.Contains(x.Id))
                    .Select(x => new { x.Id, x.WorkspaceId })
                    .ToListAsync(cancellationToken);

                var workspaceByChannelId = affectedChannels.ToDictionary(x => x.Id, x => x.WorkspaceId);
                foreach (var session in sessions
                    .GroupBy(x => x.ChannelId)
                    .Select(g => g.OrderByDescending(x => x.LastSeenAtUtc).First()))
                {
                    if (!workspaceByChannelId.TryGetValue(session.ChannelId, out var workspaceId))
                    {
                        continue;
                    }

                    var moderationState = await GetVoiceModerationStateAsync(workspaceId, userId, cancellationToken);
                    var effectiveState = ResolveEffectiveVoiceState(
                        selfMuted: false,
                        selfDeafened: false,
                        moderationState);
                    await BroadcastVoicePresenceChangedAsync(
                        workspaceId: workspaceId,
                        userId: userId,
                        username: user.Username,
                        avatarUrl: user.AvatarUrl,
                        previousVoiceChannelId: session.ChannelId,
                        currentVoiceChannelId: null,
                        isMuted: effectiveState.IsMuted,
                        isDeafened: effectiveState.IsDeafened,
                        isServerMuted: effectiveState.IsServerMuted,
                        isServerDeafened: effectiveState.IsServerDeafened,
                        occurredAtUtc: DateTime.UtcNow,
                        cancellationToken: cancellationToken);
                }
            }
        }

        return NoContent();
    }

    [HttpPost("self-state")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateSelfState(
        [FromBody] VoiceSelfStateRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        await _voicePresenceMaintenance.CleanupStaleVoiceStateAsync(cancellationToken);

        var session = await _db.VoiceSessions.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == userId,
            cancellationToken);
        if (session is null)
        {
            return NotFound();
        }

        AdoptSessionInstanceIdIfMissing(session, request.SessionInstanceId);
        if (IsSessionReplaced(session, request.SessionInstanceId))
        {
            return VoiceSessionReplaced();
        }

        var channel = await _db.Channels
            .Where(x => x.Id == session.ChannelId)
            .Select(x => new { x.WorkspaceId })
            .SingleOrDefaultAsync(cancellationToken);
        if (channel is null)
        {
            return NotFound();
        }

        var moderationState = await GetVoiceModerationStateAsync(channel.WorkspaceId, userId, cancellationToken);
        var isAdmin = User.GetPlatformRole() == PlatformRole.Admin;
        if (!isAdmin && IsServerModerationRemovalRequested(moderationState, request.IsMuted, request.IsDeafened))
        {
            return VoiceServerModerated();
        }

        if (isAdmin && moderationState is not null)
        {
            var moderationChanged = false;
            if (!request.IsMuted && moderationState.IsServerMuted)
            {
                moderationState.IsServerMuted = false;
                moderationChanged = true;
            }

            if (!request.IsDeafened && moderationState.IsServerDeafened)
            {
                moderationState.IsServerDeafened = false;
                moderationChanged = true;
            }

            if (moderationChanged)
            {
                moderationState.UpdatedAtUtc = DateTime.UtcNow;
                if (!moderationState.IsServerMuted && !moderationState.IsServerDeafened)
                {
                    _db.VoiceModerationStates.Remove(moderationState);
                }
            }
        }

        session.IsMuted = request.IsMuted;
        session.IsDeafened = request.IsDeafened;
        session.LastSeenAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);

        var user = await _db.Users
            .Where(x => x.Id == userId)
            .Select(x => new { x.Username, x.AvatarUrl })
            .SingleOrDefaultAsync(cancellationToken);

        if (user is not null)
        {
            var moderationAfter = moderationState;
            if (moderationAfter is not null)
            {
                var moderationEntityState = _db.Entry(moderationAfter).State;
                if (moderationEntityState is EntityState.Deleted or EntityState.Detached)
                {
                    moderationAfter = null;
                }
            }

            var effectiveState = ResolveEffectiveVoiceState(
                selfMuted: session.IsMuted,
                selfDeafened: session.IsDeafened,
                moderationAfter);

            await BroadcastVoicePresenceChangedAsync(
                workspaceId: channel.WorkspaceId,
                userId: userId,
                username: user.Username,
                avatarUrl: user.AvatarUrl,
                previousVoiceChannelId: session.ChannelId,
                currentVoiceChannelId: session.ChannelId,
                isMuted: effectiveState.IsMuted,
                isDeafened: effectiveState.IsDeafened,
                isServerMuted: effectiveState.IsServerMuted,
                isServerDeafened: effectiveState.IsServerDeafened,
                occurredAtUtc: DateTime.UtcNow,
                cancellationToken: cancellationToken);
        }

        return NoContent();
    }

    [HttpPost("heartbeat")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Heartbeat(
        [FromBody] VoiceHeartbeatRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        await _voicePresenceMaintenance.CleanupStaleVoiceStateAsync(cancellationToken);

        var session = await _db.VoiceSessions.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == userId,
            cancellationToken);
        if (session is null)
        {
            return NotFound();
        }

        AdoptSessionInstanceIdIfMissing(session, request.SessionInstanceId);
        if (IsSessionReplaced(session, request.SessionInstanceId))
        {
            return VoiceSessionReplaced();
        }

        var now = DateTime.UtcNow;
        session.LastSeenAtUtc = now;

        var stream = await _db.VoiceStreamPublications.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == userId,
            cancellationToken);
        if (stream is not null)
        {
            stream.IsActive = true;
            stream.LastSeenAtUtc = now;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("moderation/mute")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> MuteMember(
        [FromBody] VoiceModerationRequest request,
        CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == request.ChannelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null || channel.Type != ChannelType.Voice)
        {
            return NotFound();
        }

        var targetUser = await _db.Users
            .Where(x => x.Id == request.TargetUserId)
            .Select(x => new { x.Username, x.AvatarUrl })
            .SingleOrDefaultAsync(cancellationToken);
        if (targetUser is null)
        {
            return NotFound();
        }

        var isWorkspaceMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == channel.WorkspaceId && x.UserId == request.TargetUserId,
            cancellationToken);
        if (!isWorkspaceMember)
        {
            return NotFound();
        }

        var now = DateTime.UtcNow;
        var moderationState = await GetVoiceModerationStateAsync(channel.WorkspaceId, request.TargetUserId, cancellationToken);
        if (moderationState is null)
        {
            if (request.IsMuted)
            {
                moderationState = new VoiceModerationState
                {
                    WorkspaceId = channel.WorkspaceId,
                    UserId = request.TargetUserId,
                    IsServerMuted = true,
                    IsServerDeafened = false,
                    UpdatedAtUtc = now,
                };
                _db.VoiceModerationStates.Add(moderationState);
            }
        }
        else
        {
            moderationState.IsServerMuted = request.IsMuted;
            moderationState.UpdatedAtUtc = now;
            if (!moderationState.IsServerMuted && !moderationState.IsServerDeafened)
            {
                _db.VoiceModerationStates.Remove(moderationState);
            }
        }

        var targetSession = await _db.VoiceSessions
            .Where(x => x.UserId == request.TargetUserId && x.Channel.WorkspaceId == channel.WorkspaceId)
            .OrderByDescending(x => x.LastSeenAtUtc)
            .Select(x => new { x.ChannelId, x.IsMuted, x.IsDeafened })
            .FirstOrDefaultAsync(cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);

        var moderationAfter = moderationState;
        if (moderationAfter is not null)
        {
            var moderationEntityState = _db.Entry(moderationAfter).State;
            if (moderationEntityState is EntityState.Deleted or EntityState.Detached)
            {
                moderationAfter = null;
            }
        }

        var effectiveState = ResolveEffectiveVoiceState(
            selfMuted: targetSession?.IsMuted ?? false,
            selfDeafened: targetSession?.IsDeafened ?? false,
            moderationAfter);

        await BroadcastVoicePresenceChangedAsync(
            workspaceId: channel.WorkspaceId,
            userId: request.TargetUserId,
            username: targetUser.Username,
            avatarUrl: targetUser.AvatarUrl,
            previousVoiceChannelId: targetSession?.ChannelId,
            currentVoiceChannelId: targetSession?.ChannelId,
            isMuted: effectiveState.IsMuted,
            isDeafened: effectiveState.IsDeafened,
            isServerMuted: effectiveState.IsServerMuted,
            isServerDeafened: effectiveState.IsServerDeafened,
            occurredAtUtc: now,
            cancellationToken: cancellationToken);

        return NoContent();
    }

    [HttpPost("moderation/kick")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> KickMember(
        [FromBody] VoiceKickRequest request,
        CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var session = await _db.VoiceSessions.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == request.TargetUserId,
            cancellationToken);
        if (session is not null)
        {
            _db.VoiceSessions.Remove(session);
        }

        var stream = await _db.VoiceStreamPublications.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == request.TargetUserId,
            cancellationToken);
        if (stream is not null)
        {
            _db.VoiceStreamPublications.Remove(stream);
        }

        await _db.SaveChangesAsync(cancellationToken);

        if (session is not null)
        {
            var channel = await _db.Channels
                .Where(x => x.Id == request.ChannelId)
                .Select(x => new { x.WorkspaceId })
                .SingleOrDefaultAsync(cancellationToken);
            var user = await _db.Users
                .Where(x => x.Id == request.TargetUserId)
                .Select(x => new { x.Username, x.AvatarUrl })
                .SingleOrDefaultAsync(cancellationToken);

            if (channel is not null && user is not null)
            {
                var moderationState = await GetVoiceModerationStateAsync(
                    workspaceId: channel.WorkspaceId,
                    userId: request.TargetUserId,
                    cancellationToken);
                var effectiveState = ResolveEffectiveVoiceState(
                    selfMuted: false,
                    selfDeafened: false,
                    moderationState);
                await BroadcastVoicePresenceChangedAsync(
                    workspaceId: channel.WorkspaceId,
                    userId: request.TargetUserId,
                    username: user.Username,
                    avatarUrl: user.AvatarUrl,
                    previousVoiceChannelId: request.ChannelId,
                    currentVoiceChannelId: null,
                    isMuted: effectiveState.IsMuted,
                    isDeafened: effectiveState.IsDeafened,
                    isServerMuted: effectiveState.IsServerMuted,
                    isServerDeafened: effectiveState.IsServerDeafened,
                    occurredAtUtc: DateTime.UtcNow,
                    cancellationToken: cancellationToken);
            }
        }

        return NoContent();
    }

    [HttpPost("moderation/deafen")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeafenMember(
        [FromBody] VoiceDeafenRequest request,
        CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == request.ChannelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null || channel.Type != ChannelType.Voice)
        {
            return NotFound();
        }

        var targetUser = await _db.Users
            .Where(x => x.Id == request.TargetUserId)
            .Select(x => new { x.Username, x.AvatarUrl })
            .SingleOrDefaultAsync(cancellationToken);
        if (targetUser is null)
        {
            return NotFound();
        }

        var isWorkspaceMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == channel.WorkspaceId && x.UserId == request.TargetUserId,
            cancellationToken);
        if (!isWorkspaceMember)
        {
            return NotFound();
        }

        var now = DateTime.UtcNow;
        var moderationState = await GetVoiceModerationStateAsync(channel.WorkspaceId, request.TargetUserId, cancellationToken);
        if (moderationState is null)
        {
            if (request.IsDeafened)
            {
                moderationState = new VoiceModerationState
                {
                    WorkspaceId = channel.WorkspaceId,
                    UserId = request.TargetUserId,
                    IsServerMuted = false,
                    IsServerDeafened = true,
                    UpdatedAtUtc = now,
                };
                _db.VoiceModerationStates.Add(moderationState);
            }
        }
        else
        {
            moderationState.IsServerDeafened = request.IsDeafened;
            moderationState.UpdatedAtUtc = now;
            if (!moderationState.IsServerMuted && !moderationState.IsServerDeafened)
            {
                _db.VoiceModerationStates.Remove(moderationState);
            }
        }

        var targetSession = await _db.VoiceSessions
            .Where(x => x.UserId == request.TargetUserId && x.Channel.WorkspaceId == channel.WorkspaceId)
            .OrderByDescending(x => x.LastSeenAtUtc)
            .Select(x => new { x.ChannelId, x.IsMuted, x.IsDeafened })
            .FirstOrDefaultAsync(cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);

        var moderationAfter = moderationState;
        if (moderationAfter is not null)
        {
            var moderationEntityState = _db.Entry(moderationAfter).State;
            if (moderationEntityState is EntityState.Deleted or EntityState.Detached)
            {
                moderationAfter = null;
            }
        }

        var effectiveState = ResolveEffectiveVoiceState(
            selfMuted: targetSession?.IsMuted ?? false,
            selfDeafened: targetSession?.IsDeafened ?? false,
            moderationAfter);

        await BroadcastVoicePresenceChangedAsync(
            workspaceId: channel.WorkspaceId,
            userId: request.TargetUserId,
            username: targetUser.Username,
            avatarUrl: targetUser.AvatarUrl,
            previousVoiceChannelId: targetSession?.ChannelId,
            currentVoiceChannelId: targetSession?.ChannelId,
            isMuted: effectiveState.IsMuted,
            isDeafened: effectiveState.IsDeafened,
            isServerMuted: effectiveState.IsServerMuted,
            isServerDeafened: effectiveState.IsServerDeafened,
            occurredAtUtc: now,
            cancellationToken: cancellationToken);

        return NoContent();
    }

    [HttpPost("streams/permit")]
    [ProducesResponseType<StreamPermitResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<StreamPermitResponse>> PermitStream(
        [FromBody] StreamPermitRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        await _voicePresenceMaintenance.CleanupStaleVoiceStateAsync(cancellationToken);

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == request.ChannelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null || channel.Type != ChannelType.Voice)
        {
            return NotFound();
        }

        var session = await _db.VoiceSessions.SingleOrDefaultAsync(
            x => x.ChannelId == channel.Id && x.UserId == userId,
            cancellationToken);
        if (session is null)
        {
            return Forbid();
        }

        AdoptSessionInstanceIdIfMissing(session, request.SessionInstanceId);
        if (IsSessionReplaced(session, request.SessionInstanceId))
        {
            return VoiceSessionReplaced();
        }

        var now = DateTime.UtcNow;
        session.LastSeenAtUtc = now;
        var staleCutoff = now - TimeSpan.FromSeconds(Math.Max(1, _voicePresenceOptions.StreamTtlSeconds));
        var staleEntries = await _db.VoiceStreamPublications
            .Where(x => x.ChannelId == channel.Id && x.LastSeenAtUtc < staleCutoff)
            .ToListAsync(cancellationToken);
        foreach (var stale in staleEntries)
        {
            _db.VoiceStreamPublications.Remove(stale);
        }

        var existing = await _db.VoiceStreamPublications.SingleOrDefaultAsync(
            x => x.ChannelId == channel.Id && x.UserId == userId,
            cancellationToken);

        if (existing is not null)
        {
            existing.IsActive = true;
            existing.LastSeenAtUtc = now;
            await _db.SaveChangesAsync(cancellationToken);
            var activeCount = await _db.VoiceStreamPublications.CountAsync(
                x => x.ChannelId == channel.Id && x.IsActive,
                cancellationToken);
            return Ok(new StreamPermitResponse(true, null, activeCount, channel.MaxConcurrentStreams));
        }

        var count = await _db.VoiceStreamPublications.CountAsync(
            x => x.ChannelId == channel.Id && x.IsActive,
            cancellationToken);
        if (channel.MaxConcurrentStreams.HasValue && count >= channel.MaxConcurrentStreams.Value)
        {
            return Ok(new StreamPermitResponse(
                false,
                "Maximum concurrent streams reached.",
                count,
                channel.MaxConcurrentStreams));
        }

        _db.VoiceStreamPublications.Add(new VoiceStreamPublication
        {
            ChannelId = channel.Id,
            UserId = userId,
            IsActive = true,
            StartedAtUtc = now,
            LastSeenAtUtc = now
        });
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(new StreamPermitResponse(true, null, count + 1, channel.MaxConcurrentStreams));
    }

    [HttpPost("streams/release")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> ReleaseStream(
        [FromBody] StreamPermitRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        await _voicePresenceMaintenance.CleanupStaleVoiceStateAsync(cancellationToken);

        var session = await _db.VoiceSessions.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == userId,
            cancellationToken);

        if (session is not null)
        {
            AdoptSessionInstanceIdIfMissing(session, request.SessionInstanceId);
        }

        if (session is not null && IsSessionReplaced(session, request.SessionInstanceId))
        {
            return VoiceSessionReplaced();
        }

        if (session is not null)
        {
            session.LastSeenAtUtc = DateTime.UtcNow;
        }

        var stream = await _db.VoiceStreamPublications.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == userId,
            cancellationToken);
        if (stream is not null)
        {
            _db.VoiceStreamPublications.Remove(stream);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return NoContent();
    }

    private static bool IsSessionReplaced(VoiceSession session, string? requestSessionInstanceId)
    {
        if (string.IsNullOrWhiteSpace(requestSessionInstanceId))
        {
            return false;
        }

        return !string.Equals(
            session.SessionInstanceId,
            requestSessionInstanceId.Trim(),
            StringComparison.Ordinal);
    }

    private static void AdoptSessionInstanceIdIfMissing(VoiceSession session, string? requestSessionInstanceId)
    {
        if (!string.IsNullOrWhiteSpace(session.SessionInstanceId))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(requestSessionInstanceId))
        {
            return;
        }

        session.SessionInstanceId = requestSessionInstanceId.Trim();
    }

    private ObjectResult VoiceSessionReplaced()
    {
        var details = new ProblemDetails
        {
            Title = "Voice session replaced by another tab.",
            Status = StatusCodes.Status409Conflict
        };
        details.Extensions["code"] = VoiceSessionReplacedCode;
        return StatusCode(StatusCodes.Status409Conflict, details);
    }

    private ObjectResult VoiceServerModerated()
    {
        var details = new ProblemDetails
        {
            Title = "Voice state is controlled by server moderation.",
            Status = StatusCodes.Status403Forbidden
        };
        details.Extensions["code"] = VoiceServerModeratedCode;
        return StatusCode(StatusCodes.Status403Forbidden, details);
    }

    private Task<VoiceModerationState?> GetVoiceModerationStateAsync(
        Guid workspaceId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        return _db.VoiceModerationStates.SingleOrDefaultAsync(
            x => x.WorkspaceId == workspaceId && x.UserId == userId,
            cancellationToken);
    }

    private static bool IsServerModerationRemovalRequested(
        VoiceModerationState? moderationState,
        bool requestedMuted,
        bool requestedDeafened)
    {
        if (moderationState is null)
        {
            return false;
        }

        if (moderationState.IsServerDeafened && !requestedDeafened)
        {
            return true;
        }

        if (moderationState.IsServerMuted && !requestedMuted)
        {
            return true;
        }

        return false;
    }

    private static EffectiveVoiceState ResolveEffectiveVoiceState(
        bool selfMuted,
        bool selfDeafened,
        VoiceModerationState? moderationState)
    {
        var serverMuted = moderationState?.IsServerMuted ?? false;
        var serverDeafened = moderationState?.IsServerDeafened ?? false;
        var effectiveDeafened = selfDeafened || serverDeafened;
        var effectiveMuted = selfMuted || serverMuted || serverDeafened;
        return new EffectiveVoiceState(
            effectiveMuted,
            effectiveDeafened,
            serverMuted,
            serverDeafened);
    }

    private async Task BroadcastVoicePresenceChangedAsync(
        Guid workspaceId,
        Guid userId,
        string username,
        string? avatarUrl,
        Guid? previousVoiceChannelId,
        Guid? currentVoiceChannelId,
        bool isMuted,
        bool isDeafened,
        bool isServerMuted,
        bool isServerDeafened,
        DateTime occurredAtUtc,
        CancellationToken cancellationToken)
    {
        var payload = new VoicePresenceChangedEvent(
            workspaceId,
            userId,
            username,
            avatarUrl,
            previousVoiceChannelId,
            currentVoiceChannelId,
            isMuted,
            isDeafened,
            isServerMuted,
            isServerDeafened,
            occurredAtUtc);

        var hasChannelTransition = previousVoiceChannelId != currentVoiceChannelId;
        var tasks = new List<Task>();

        if (hasChannelTransition)
        {
            tasks.Add(
                _hubContext.Clients.Group(ChatGroupNames.Workspace(workspaceId))
                    .SendAsync("voicePresenceChanged", payload, cancellationToken));
        }

        if (previousVoiceChannelId.HasValue)
        {
            tasks.Add(
                _hubContext.Clients.Group(ChatGroupNames.VoiceChannel(previousVoiceChannelId.Value))
                    .SendAsync("voiceChannelPresenceChanged", payload, cancellationToken));
        }

        if (currentVoiceChannelId.HasValue && currentVoiceChannelId != previousVoiceChannelId)
        {
            tasks.Add(
                _hubContext.Clients.Group(ChatGroupNames.VoiceChannel(currentVoiceChannelId.Value))
                    .SendAsync("voiceChannelPresenceChanged", payload, cancellationToken));
        }

        if (tasks.Count == 0)
        {
            return;
        }

        await Task.WhenAll(tasks);
    }

    private sealed record EffectiveVoiceState(
        bool IsMuted,
        bool IsDeafened,
        bool IsServerMuted,
        bool IsServerDeafened);
}
