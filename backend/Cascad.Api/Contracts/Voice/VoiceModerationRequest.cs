namespace Cascad.Api.Contracts.Voice;

public sealed class VoiceModerationRequest
{
    public Guid ChannelId { get; set; }

    public Guid TargetUserId { get; set; }

    public bool IsMuted { get; set; }
}
