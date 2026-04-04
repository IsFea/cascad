using Cascad.Api.Data.Entities;

namespace Cascad.Api.Contracts.Workspace;

public sealed class CreateChannelRequest
{
    public string Name { get; set; } = string.Empty;

    public ChannelType Type { get; set; }

    public int? MaxParticipants { get; set; }

    public int? MaxConcurrentStreams { get; set; }
}
