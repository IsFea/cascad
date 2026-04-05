using Cascad.Api.Contracts.Voice;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Hubs;
using Cascad.Api.Options;
using Cascad.Api.Realtime;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Services;

public sealed class VoicePresenceMaintenanceService : IVoicePresenceMaintenanceService
{
    private readonly AppDbContext _db;
    private readonly IHubContext<ChatHub> _hubContext;
    private readonly VoicePresenceOptions _options;

    public VoicePresenceMaintenanceService(
        AppDbContext db,
        IHubContext<ChatHub> hubContext,
        IOptions<VoicePresenceOptions> options)
    {
        _db = db;
        _hubContext = hubContext;
        _options = options.Value;
    }

    public async Task CleanupStaleVoiceStateAsync(CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var staleSessionCutoff = now - TimeSpan.FromSeconds(Math.Max(1, _options.SessionTtlSeconds));
        var staleStreamCutoff = now - TimeSpan.FromSeconds(Math.Max(1, _options.StreamTtlSeconds));

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

        if (staleSessions.Count == 0 && staleStreams.Count == 0)
        {
            return;
        }

        await _db.SaveChangesAsync(cancellationToken);

        if (staleSessions.Count == 0)
        {
            return;
        }

        var workspaceIds = staleSessions.Select(x => x.Channel.WorkspaceId).Distinct().ToArray();
        var userIds = staleSessions.Select(x => x.UserId).Distinct().ToArray();
        var moderationStates = await _db.VoiceModerationStates
            .Where(x => workspaceIds.Contains(x.WorkspaceId) && userIds.Contains(x.UserId))
            .ToListAsync(cancellationToken);
        var moderationByWorkspaceUser = moderationStates.ToDictionary(
            x => (x.WorkspaceId, x.UserId),
            x => x);

        foreach (var staleSession in staleSessions)
        {
            moderationByWorkspaceUser.TryGetValue(
                (staleSession.Channel.WorkspaceId, staleSession.UserId),
                out var moderationState);
            var effectiveState = ResolveEffectiveVoiceState(
                selfMuted: false,
                selfDeafened: false,
                moderationState);

            await BroadcastVoicePresenceAsync(
                workspaceId: staleSession.Channel.WorkspaceId,
                userId: staleSession.UserId,
                username: staleSession.User.Username,
                avatarUrl: staleSession.User.AvatarUrl,
                previousVoiceChannelId: staleSession.ChannelId,
                currentVoiceChannelId: null,
                isScreenSharing: false,
                isMuted: effectiveState.IsMuted,
                isDeafened: effectiveState.IsDeafened,
                isServerMuted: effectiveState.IsServerMuted,
                isServerDeafened: effectiveState.IsServerDeafened,
                occurredAtUtc: now,
                cancellationToken: cancellationToken);
        }
    }

    private async Task BroadcastVoicePresenceAsync(
        Guid workspaceId,
        Guid userId,
        string username,
        string? avatarUrl,
        Guid? previousVoiceChannelId,
        Guid? currentVoiceChannelId,
        bool isScreenSharing,
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
            isScreenSharing,
            isMuted,
            isDeafened,
            isServerMuted,
            isServerDeafened,
            occurredAtUtc);

        var tasks = new List<Task>
        {
            _hubContext.Clients.Group(ChatGroupNames.Workspace(workspaceId))
                .SendAsync("voicePresenceChanged", payload, cancellationToken)
        };

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

        await Task.WhenAll(tasks);
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

    private sealed record EffectiveVoiceState(
        bool IsMuted,
        bool IsDeafened,
        bool IsServerMuted,
        bool IsServerDeafened);
}
