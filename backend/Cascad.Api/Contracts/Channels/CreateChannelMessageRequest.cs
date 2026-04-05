namespace Cascad.Api.Contracts.Channels;

public sealed class CreateChannelMessageRequest
{
    public Guid? ClientMessageId { get; set; }

    public string Content { get; set; } = string.Empty;

    public List<string> AttachmentUrls { get; set; } = new();
}
