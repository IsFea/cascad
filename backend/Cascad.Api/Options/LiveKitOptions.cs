namespace Cascad.Api.Options;

public sealed class LiveKitOptions
{
    public const string SectionName = "LiveKit";

    public string ApiKey { get; set; } = "devkey";

    public string ApiSecret { get; set; } = "DEV_LIVEKIT_SECRET_KEY_1234567890123456";

    public string RtcUrl { get; set; } = "ws://localhost:7880";
}
