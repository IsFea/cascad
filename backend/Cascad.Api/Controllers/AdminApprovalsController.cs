using Cascad.Api.Contracts.Admin;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/admin/approvals")]
[Authorize]
public sealed class AdminApprovalsController : ControllerBase
{
    private readonly AppDbContext _db;

    public AdminApprovalsController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [ProducesResponseType<ApprovalsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ApprovalsResponse>> GetPendingApprovals(CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var users = await _db.Users
            .Where(x => x.Status == UserApprovalStatus.Pending)
            .OrderBy(x => x.CreatedAtUtc)
            .Select(x => new PendingApprovalDto(x.Id, x.Username, x.CreatedAtUtc, x.Status))
            .ToListAsync(cancellationToken);

        return Ok(new ApprovalsResponse(users));
    }

    [HttpPost("{userId:guid}/approve")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Approve(Guid userId, CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return NotFound();
        }

        user.Status = UserApprovalStatus.Approved;
        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("{userId:guid}/reject")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Reject(Guid userId, CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return NotFound();
        }

        user.Status = UserApprovalStatus.Rejected;
        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}
