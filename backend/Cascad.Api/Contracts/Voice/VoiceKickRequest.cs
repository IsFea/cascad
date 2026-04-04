namespace Cascad.Api.Contracts.Voice;

public sealed class VoiceKickRequest
{
    public Guid ChannelId { get; set; }

    public Guid TargetUserId { get; set; }
}
