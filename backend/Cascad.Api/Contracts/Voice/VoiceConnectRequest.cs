namespace Cascad.Api.Contracts.Voice;

public sealed class VoiceConnectRequest
{
    public Guid ChannelId { get; set; }

    public string TabInstanceId { get; set; } = string.Empty;

    public bool AllowTakeover { get; set; }
}
