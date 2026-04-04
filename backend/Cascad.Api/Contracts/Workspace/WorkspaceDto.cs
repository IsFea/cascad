namespace Cascad.Api.Contracts.Workspace;

public sealed record WorkspaceDto(
    Guid Id,
    string Name,
    DateTime CreatedAtUtc);
