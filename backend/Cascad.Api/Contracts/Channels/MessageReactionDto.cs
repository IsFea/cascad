namespace Cascad.Api.Contracts.Channels;

public sealed record MessageReactionDto(
    Guid UserId,
    string Username,
    string Emoji);
