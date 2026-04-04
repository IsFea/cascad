using Cascad.Api.Data.Entities;

namespace Cascad.Api.Contracts.Workspace;

public sealed record ChannelDto(
    Guid Id,
    Guid WorkspaceId,
    string Name,
    ChannelType Type,
    int Position,
    int? MaxParticipants,
    int? MaxConcurrentStreams,
    string? LiveKitRoomName,
    DateTime CreatedAtUtc);
