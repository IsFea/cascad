using Cascad.Api.Data.Entities;

namespace Cascad.Api.Contracts.Admin;

public sealed record PendingApprovalDto(
    Guid UserId,
    string Username,
    DateTime CreatedAtUtc,
    UserApprovalStatus Status);
