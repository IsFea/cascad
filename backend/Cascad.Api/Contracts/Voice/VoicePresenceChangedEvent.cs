namespace Cascad.Api.Contracts.Voice;

public sealed record VoicePresenceChangedEvent(
    Guid WorkspaceId,
    Guid UserId,
    string Username,
    string? AvatarUrl,
    Guid? PreviousVoiceChannelId,
    Guid? CurrentVoiceChannelId,
    bool IsMuted,
    bool IsDeafened,
    DateTime OccurredAtUtc);
