namespace Cascad.Api.Contracts.Admin;

public sealed record ApprovalsResponse(IReadOnlyList<PendingApprovalDto> Users);
