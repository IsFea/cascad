namespace Cascad.Api.Contracts.Channels;

public sealed record ChannelMessagesResponse(
    IReadOnlyList<ChannelMessageDto> Messages,
    string? NextBefore);
