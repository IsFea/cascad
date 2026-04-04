namespace Cascad.Api.Data.Entities;

public sealed class ChannelMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid ChannelId { get; set; }

    public Channel Channel { get; set; } = null!;

    public Guid UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public string Content { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ICollection<MessageAttachment> Attachments { get; set; } = new List<MessageAttachment>();

    public ICollection<MessageMention> Mentions { get; set; } = new List<MessageMention>();
}
