using Cascad.Api.Data.Entities;

namespace Cascad.Api.Contracts.Common;

public sealed record UserDto(
    Guid Id,
    string Username,
    UserApprovalStatus Status,
    PlatformRole Role,
    string? AvatarUrl);
