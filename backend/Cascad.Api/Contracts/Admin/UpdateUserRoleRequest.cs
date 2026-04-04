using Cascad.Api.Data.Entities;

namespace Cascad.Api.Contracts.Admin;

public sealed class UpdateUserRoleRequest
{
    public PlatformRole Role { get; set; } = PlatformRole.User;
}
