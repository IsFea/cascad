using Cascad.Api.Data.Entities;

namespace Cascad.Api.Contracts.Workspace;

public sealed record WorkspaceMemberDto(
    Guid UserId,
    string Username,
    PlatformRole Role,
    string? AvatarUrl,
    Guid? ConnectedVoiceChannelId,
    bool IsScreenSharing,
    bool IsMuted,
    bool IsDeafened,
    bool IsServerMuted,
    bool IsServerDeafened);
