namespace Cascad.Api.Options;

public sealed class VoicePresenceOptions
{
    public const string SectionName = "VoicePresence";

    public int SessionTtlSeconds { get; set; } = 45;

    public int StreamTtlSeconds { get; set; } = 15;

    public int CleanupIntervalSeconds { get; set; } = 5;

    public int SignalRKeepAliveSeconds { get; set; } = 5;

    public int SignalRClientTimeoutSeconds { get; set; } = 30;

    public int MaxSessionsCleanupBatchSize { get; set; } = 150;

    public int MaxStreamsCleanupBatchSize { get; set; } = 200;
}
