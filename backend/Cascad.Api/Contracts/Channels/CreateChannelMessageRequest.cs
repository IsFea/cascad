namespace Cascad.Api.Contracts.Channels;

public sealed class CreateChannelMessageRequest
{
    public string Content { get; set; } = string.Empty;

    public List<string> AttachmentUrls { get; set; } = new();
}
