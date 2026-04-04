using Cascad.Api.Data.Entities;

namespace Cascad.Api.Contracts.Workspace;

public sealed record WorkspaceMemberDto(
    Guid UserId,
    string Username,
    PlatformRole Role,
    string? AvatarUrl,
    Guid? ConnectedVoiceChannelId,
    bool IsMuted,
    bool IsDeafened);
