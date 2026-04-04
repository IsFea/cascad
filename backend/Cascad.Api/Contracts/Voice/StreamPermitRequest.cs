namespace Cascad.Api.Contracts.Voice;

public sealed class StreamPermitRequest
{
    public Guid ChannelId { get; set; }

    public string SessionInstanceId { get; set; } = string.Empty;
}
