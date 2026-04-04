using System.Security.Claims;
using Cascad.Api.Data.Entities;

namespace Cascad.Api.Extensions;

public static class ClaimsPrincipalExtensions
{
    public static bool TryGetUserId(this ClaimsPrincipal principal, out Guid userId)
    {
        var value = principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? principal.FindFirstValue("sub");
        return Guid.TryParse(value, out userId);
    }

    public static string GetUsernameOrEmpty(this ClaimsPrincipal principal)
    {
        return principal.FindFirstValue(ClaimTypes.Name) ?? principal.FindFirstValue("username") ?? string.Empty;
    }

    public static PlatformRole GetPlatformRole(this ClaimsPrincipal principal)
    {
        var role = principal.FindFirstValue(ClaimTypes.Role);
        if (Enum.TryParse<PlatformRole>(role, out var parsed))
        {
            return parsed;
        }

        return PlatformRole.User;
    }

    public static UserApprovalStatus GetUserStatus(this ClaimsPrincipal principal)
    {
        var status = principal.FindFirstValue("status");
        if (Enum.TryParse<UserApprovalStatus>(status, out var parsed))
        {
            return parsed;
        }

        return UserApprovalStatus.Pending;
    }
}
