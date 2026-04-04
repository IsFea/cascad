namespace Cascad.Api.Contracts.Voice;

public sealed record StreamPermitResponse(
    bool Allowed,
    string? Reason,
    int ActiveStreams,
    int? MaxConcurrentStreams);
