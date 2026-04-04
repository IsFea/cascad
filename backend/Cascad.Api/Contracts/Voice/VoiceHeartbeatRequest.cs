namespace Cascad.Api.Contracts.Voice;

public sealed class VoiceHeartbeatRequest
{
    public Guid ChannelId { get; set; }

    public string SessionInstanceId { get; set; } = string.Empty;
}
