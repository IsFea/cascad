using System.Text.RegularExpressions;
using Cascad.Api.Contracts.Auth;
using Cascad.Api.Contracts.Common;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Cascad.Api.Options;
using Cascad.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed partial class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IAppJwtTokenService _appJwtTokenService;
    private readonly IPasswordHasher<AppUser> _passwordHasher;
    private readonly AuthOptions _authOptions;

    public AuthController(
        AppDbContext db,
        IAppJwtTokenService appJwtTokenService,
        IPasswordHasher<AppUser> passwordHasher,
        IOptions<AuthOptions> authOptions)
    {
        _db = db;
        _appJwtTokenService = appJwtTokenService;
        _passwordHasher = passwordHasher;
        _authOptions = authOptions.Value;
    }

    [HttpPost("register")]
    [ProducesResponseType<RegisterResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RegisterResponse>> Register(
        [FromBody] RegisterRequest request,
        CancellationToken cancellationToken)
    {
        var username = request.Username.Trim();
        if (!UsernameRegex().IsMatch(username))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid username",
                Detail = "Username supports letters, numbers, '.', '_' and '-'. Length: 2-32."
            });
        }

        if (request.Password.Length < 8)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Weak password",
                Detail = "Password must be at least 8 characters."
            });
        }

        if (!string.Equals(request.Password, request.ConfirmPassword, StringComparison.Ordinal))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Password mismatch",
                Detail = "Password and confirmation must match."
            });
        }

        var normalizedUsername = username.ToUpperInvariant();
        var exists = await _db.Users.AnyAsync(
            x => x.NormalizedUsername == normalizedUsername,
            cancellationToken);
        if (exists)
        {
            return Conflict(new ProblemDetails
            {
                Title = "Username already exists"
            });
        }

        var user = new AppUser
        {
            Username = username,
            NormalizedUsername = normalizedUsername,
            Status = UserApprovalStatus.Pending,
            PlatformRole = PlatformRole.User,
            CreatedAtUtc = DateTime.UtcNow
        };
        user.PasswordHash = _passwordHasher.HashPassword(user, request.Password);
        _db.Users.Add(user);
        await _db.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new RegisterResponse(ToUserDto(user)));
    }

    [HttpPost("login")]
    [ProducesResponseType<LoginResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<LoginResponse>> Login(
        [FromBody] LoginRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedUsername = request.Username.Trim().ToUpperInvariant();
        var user = await _db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalizedUsername,
            cancellationToken);
        if (user is null)
        {
            return Unauthorized();
        }

        var verification = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (verification == PasswordVerificationResult.Failed)
        {
            return Unauthorized();
        }

        if (user.Status == UserApprovalStatus.Pending)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new ProblemDetails
            {
                Title = "Approval pending",
                Detail = "Account is waiting for admin approval."
            });
        }

        if (user.Status == UserApprovalStatus.Rejected)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new ProblemDetails
            {
                Title = "Account rejected"
            });
        }

        var token = _appJwtTokenService.GenerateToken(user);
        return Ok(new LoginResponse(ToUserDto(user), token.Token, token.ExpiresAtUtc));
    }

    [Authorize]
    [HttpGet("me")]
    [ProducesResponseType<MeResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<MeResponse>> Me(CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return Unauthorized();
        }

        return Ok(new MeResponse(ToUserDto(user)));
    }

    [HttpPost("guest")]
    [ProducesResponseType<GuestAuthResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status410Gone)]
    public async Task<ActionResult<GuestAuthResponse>> GuestAuth(
        [FromBody] GuestAuthRequest request,
        CancellationToken cancellationToken)
    {
        if (!_authOptions.AllowGuestAuth)
        {
            return StatusCode(StatusCodes.Status410Gone, new ProblemDetails
            {
                Title = "Guest auth disabled"
            });
        }

        var username = request.Nickname.Trim();
        if (!UsernameRegex().IsMatch(username))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid nickname",
                Detail = "Nickname supports letters, numbers, '.', '_' and '-'."
            });
        }

        var normalizedUsername = username.ToUpperInvariant();
        var user = await _db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalizedUsername,
            cancellationToken);

        if (user is null)
        {
            user = new AppUser
            {
                Username = username,
                NormalizedUsername = normalizedUsername,
                Status = UserApprovalStatus.Approved,
                PlatformRole = PlatformRole.User,
                PasswordHash = string.Empty,
                CreatedAtUtc = DateTime.UtcNow
            };
            _db.Users.Add(user);
            await _db.SaveChangesAsync(cancellationToken);
        }

        var token = _appJwtTokenService.GenerateToken(user);
        return Ok(new GuestAuthResponse(
            ToUserDto(user),
            token.Token,
            token.ExpiresAtUtc));
    }

    private static UserDto ToUserDto(AppUser user)
    {
        return new UserDto(user.Id, user.Username, user.Status, user.PlatformRole, user.AvatarUrl);
    }

    [GeneratedRegex("^[\\p{L}\\p{N}._\\-]{2,32}$", RegexOptions.Compiled)]
    private static partial Regex UsernameRegex();
}
