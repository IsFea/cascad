namespace Cascad.Api.Contracts.Voice;

public sealed class VoiceDisconnectRequest
{
    public Guid? ChannelId { get; set; }

    public string? SessionInstanceId { get; set; }
}
