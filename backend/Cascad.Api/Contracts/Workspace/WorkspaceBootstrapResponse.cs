using Cascad.Api.Contracts.Common;

namespace Cascad.Api.Contracts.Workspace;

public sealed record WorkspaceBootstrapResponse(
    WorkspaceDto Workspace,
    UserDto CurrentUser,
    Guid? ConnectedVoiceChannelId,
    string? ConnectedVoiceTabInstanceId,
    IReadOnlyList<ChannelDto> Channels,
    IReadOnlyList<WorkspaceMemberDto> Members,
    ChatUnreadDto ChatUnread);
