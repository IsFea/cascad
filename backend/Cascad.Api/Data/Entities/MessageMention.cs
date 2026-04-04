namespace Cascad.Api.Data.Entities;

public sealed class MessageMention
{
    public Guid MessageId { get; set; }

    public ChannelMessage Message { get; set; } = null!;

    public Guid MentionedUserId { get; set; }

    public AppUser MentionedUser { get; set; } = null!;
}
