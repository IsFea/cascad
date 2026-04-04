using Cascad.Api.Contracts.Admin;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/admin/users")]
[Authorize]
public sealed class AdminUsersController : ControllerBase
{
    private readonly AppDbContext _db;

    public AdminUsersController(AppDbContext db)
    {
        _db = db;
    }

    [HttpPost("{userId:guid}/role")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateRole(
        Guid userId,
        [FromBody] UpdateUserRoleRequest request,
        CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        if (!User.TryGetUserId(out var actorUserId))
        {
            return Unauthorized();
        }

        if (actorUserId == userId)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "You cannot change your own role."
            });
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return NotFound();
        }

        if (user.PlatformRole == request.Role)
        {
            return NoContent();
        }

        if (request.Role == PlatformRole.User)
        {
            var adminCount = await _db.Users.CountAsync(
                x => x.Status == UserApprovalStatus.Approved && x.PlatformRole == PlatformRole.Admin,
                cancellationToken);

            if (adminCount <= 1 && user.PlatformRole == PlatformRole.Admin)
            {
                return BadRequest(new ProblemDetails
                {
                    Title = "Cannot demote the last admin."
                });
            }
        }

        user.PlatformRole = request.Role;

        var memberships = await _db.WorkspaceMembers
            .Where(x => x.UserId == user.Id)
            .ToListAsync(cancellationToken);

        foreach (var member in memberships)
        {
            member.Role = request.Role;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}
