namespace Cascad.Api.Contracts.Channels;

public sealed record ChannelMessageDto(
    Guid Id,
    Guid ChannelId,
    Guid UserId,
    string Username,
    string? AvatarUrl,
    string Content,
    DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc,
    bool IsEdited,
    bool IsDeleted,
    IReadOnlyList<MessageAttachmentDto> Attachments,
    IReadOnlyList<MessageMentionDto> Mentions,
    IReadOnlyList<MessageReactionDto> Reactions);
