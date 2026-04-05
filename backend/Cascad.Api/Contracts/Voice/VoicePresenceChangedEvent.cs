namespace Cascad.Api.Contracts.Voice;

public sealed record VoicePresenceChangedEvent(
    Guid WorkspaceId,
    Guid UserId,
    string Username,
    string? AvatarUrl,
    Guid? PreviousVoiceChannelId,
    Guid? CurrentVoiceChannelId,
    bool IsScreenSharing,
    bool IsMuted,
    bool IsDeafened,
    bool IsServerMuted,
    bool IsServerDeafened,
    DateTime OccurredAtUtc);
