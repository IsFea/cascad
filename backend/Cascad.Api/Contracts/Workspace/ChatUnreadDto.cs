namespace Cascad.Api.Contracts.Workspace;

public sealed record ChatUnreadDto(
    int TotalUnreadCount,
    IReadOnlyList<ChannelUnreadStateDto> Channels);
