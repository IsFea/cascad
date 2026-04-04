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
    private static readonly TimeSpan VoiceSessionTtl = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan StreamLeaseTtl = TimeSpan.FromSeconds(30);

    private readonly AppDbContext _db;
    private readonly IHubContext<ChatHub> _hubContext;
    private readonly ILiveKitTokenService _liveKitTokenService;
    private readonly LiveKitOptions _liveKitOptions;

    public VoiceController(
        AppDbContext db,
        IHubContext<ChatHub> hubContext,
        ILiveKitTokenService liveKitTokenService,
        IOptions<LiveKitOptions> liveKitOptions)
    {
        _db = db;
        _hubContext = hubContext;
        _liveKitTokenService = liveKitTokenService;
        _liveKitOptions = liveKitOptions.Value;
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

        await CleanupStaleVoiceStateAsync(cancellationToken);

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

        if (previousVoiceChannelId != channel.Id)
        {
            await BroadcastVoicePresenceChangedAsync(
                workspaceId: channel.WorkspaceId,
                userId: user.Id,
                username: user.Username,
                avatarUrl: user.AvatarUrl,
                previousVoiceChannelId: previousVoiceChannelId,
                currentVoiceChannelId: channel.Id,
                isMuted: current?.IsMuted ?? false,
                isDeafened: current?.IsDeafened ?? false,
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

                    await BroadcastVoicePresenceChangedAsync(
                        workspaceId: workspaceId,
                        userId: userId,
                        username: user.Username,
                        avatarUrl: user.AvatarUrl,
                        previousVoiceChannelId: session.ChannelId,
                        currentVoiceChannelId: null,
                        isMuted: session.IsMuted,
                        isDeafened: session.IsDeafened,
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

        await CleanupStaleVoiceStateAsync(cancellationToken);

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

        session.IsMuted = request.IsMuted;
        session.IsDeafened = request.IsDeafened;
        session.LastSeenAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
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

        await CleanupStaleVoiceStateAsync(cancellationToken);

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

        var session = await _db.VoiceSessions.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == request.TargetUserId,
            cancellationToken);
        if (session is null)
        {
            return NotFound();
        }

        session.IsMuted = request.IsMuted;
        session.LastSeenAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
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
                await BroadcastVoicePresenceChangedAsync(
                    workspaceId: channel.WorkspaceId,
                    userId: request.TargetUserId,
                    username: user.Username,
                    avatarUrl: user.AvatarUrl,
                    previousVoiceChannelId: request.ChannelId,
                    currentVoiceChannelId: null,
                    isMuted: session.IsMuted,
                    isDeafened: session.IsDeafened,
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

        var session = await _db.VoiceSessions.SingleOrDefaultAsync(
            x => x.ChannelId == request.ChannelId && x.UserId == request.TargetUserId,
            cancellationToken);
        if (session is null)
        {
            return NotFound();
        }

        session.IsDeafened = request.IsDeafened;
        session.LastSeenAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
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

        await CleanupStaleVoiceStateAsync(cancellationToken);

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
        var staleCutoff = now - StreamLeaseTtl;
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

        await CleanupStaleVoiceStateAsync(cancellationToken);

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

    private async Task CleanupStaleVoiceStateAsync(CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var staleSessionCutoff = now - VoiceSessionTtl;
        var staleStreamCutoff = now - StreamLeaseTtl;

        var staleSessions = await _db.VoiceSessions
            .Include(x => x.Channel)
            .Include(x => x.User)
            .Where(x => x.LastSeenAtUtc < staleSessionCutoff)
            .ToListAsync(cancellationToken);

        if (staleSessions.Count > 0)
        {
            _db.VoiceSessions.RemoveRange(staleSessions);
        }

        var staleStreams = await _db.VoiceStreamPublications
            .Where(x => x.LastSeenAtUtc < staleStreamCutoff)
            .ToListAsync(cancellationToken);

        if (staleStreams.Count > 0)
        {
            _db.VoiceStreamPublications.RemoveRange(staleStreams);
        }

        if (staleSessions.Count > 0 || staleStreams.Count > 0)
        {
            await _db.SaveChangesAsync(cancellationToken);
        }

        foreach (var staleSession in staleSessions)
        {
            await BroadcastVoicePresenceChangedAsync(
                workspaceId: staleSession.Channel.WorkspaceId,
                userId: staleSession.UserId,
                username: staleSession.User.Username,
                avatarUrl: staleSession.User.AvatarUrl,
                previousVoiceChannelId: staleSession.ChannelId,
                currentVoiceChannelId: null,
                isMuted: staleSession.IsMuted,
                isDeafened: staleSession.IsDeafened,
                occurredAtUtc: now,
                cancellationToken: cancellationToken);
        }
    }

    private Task BroadcastVoicePresenceChangedAsync(
        Guid workspaceId,
        Guid userId,
        string username,
        string? avatarUrl,
        Guid? previousVoiceChannelId,
        Guid? currentVoiceChannelId,
        bool isMuted,
        bool isDeafened,
        DateTime occurredAtUtc,
        CancellationToken cancellationToken)
    {
        return _hubContext.Clients.Group(ChatGroupNames.Workspace(workspaceId))
            .SendAsync(
                "voicePresenceChanged",
                new VoicePresenceChangedEvent(
                    workspaceId,
                    userId,
                    username,
                    avatarUrl,
                    previousVoiceChannelId,
                    currentVoiceChannelId,
                    isMuted,
                    isDeafened,
                    occurredAtUtc),
                cancellationToken);
    }
}
