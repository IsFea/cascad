namespace Cascad.Api.Contracts.Voice;

public sealed class VoiceDeafenRequest
{
    public Guid ChannelId { get; set; }

    public Guid TargetUserId { get; set; }

    public bool IsDeafened { get; set; }
}
