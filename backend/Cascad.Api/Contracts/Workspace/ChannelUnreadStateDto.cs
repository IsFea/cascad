namespace Cascad.Api.Contracts.Workspace;

public sealed record ChannelUnreadStateDto(
    Guid ChannelId,
    int UnreadCount,
    DateTime? LastReadAtUtc);
