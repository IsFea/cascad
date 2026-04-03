using System.Text.RegularExpressions;
using Cascad.Api.Contracts.Auth;
using Cascad.Api.Contracts.Common;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed partial class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IAppJwtTokenService _appJwtTokenService;

    public AuthController(AppDbContext db, IAppJwtTokenService appJwtTokenService)
    {
        _db = db;
        _appJwtTokenService = appJwtTokenService;
    }

    [HttpPost("guest")]
    [ProducesResponseType<GuestAuthResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<GuestAuthResponse>> GuestAuth(
        [FromBody] GuestAuthRequest request,
        CancellationToken cancellationToken)
    {
        var nickname = request.Nickname.Trim();
        if (!NicknameRegex().IsMatch(nickname))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid nickname",
                Detail = "Nickname supports letters, numbers, spaces, '_' and '-'."
            });
        }

        var normalized = nickname.ToUpperInvariant();

        var user = await _db.Users.SingleOrDefaultAsync(
            x => x.NormalizedNickname == normalized,
            cancellationToken);

        if (user is null)
        {
            user = new AppUser
            {
                Nickname = nickname,
                NormalizedNickname = normalized,
                CreatedAtUtc = DateTime.UtcNow
            };
            _db.Users.Add(user);
            await _db.SaveChangesAsync(cancellationToken);
        }

        var token = _appJwtTokenService.GenerateToken(user);

        return Ok(new GuestAuthResponse(
            new UserDto(user.Id, user.Nickname),
            token.Token,
            token.ExpiresAtUtc));
    }

    [GeneratedRegex("^[\\p{L}\\p{N}_\\- ]{2,32}$", RegexOptions.Compiled)]
    private static partial Regex NicknameRegex();
}
