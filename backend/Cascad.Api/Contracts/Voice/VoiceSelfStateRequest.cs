namespace Cascad.Api.Contracts.Voice;

public sealed class VoiceSelfStateRequest
{
    public Guid ChannelId { get; set; }

    public bool IsMuted { get; set; }

    public bool IsDeafened { get; set; }
}
