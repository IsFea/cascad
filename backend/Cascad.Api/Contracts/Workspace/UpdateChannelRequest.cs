namespace Cascad.Api.Contracts.Workspace;

public sealed class UpdateChannelRequest
{
    public string Name { get; set; } = string.Empty;

    public int? MaxParticipants { get; set; }

    public int? MaxConcurrentStreams { get; set; }
}
