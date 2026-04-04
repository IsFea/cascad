using System.Text.RegularExpressions;
using Cascad.Api.Contracts.Common;
using Cascad.Api.Contracts.Profile;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Cascad.Api.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/profile")]
[Authorize]
public sealed partial class ProfileController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly StorageOptions _storageOptions;

    public ProfileController(AppDbContext db, IOptions<StorageOptions> storageOptions)
    {
        _db = db;
        _storageOptions = storageOptions.Value;
    }

    [HttpGet]
    [ProducesResponseType<ProfileResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ProfileResponse>> GetProfile(CancellationToken cancellationToken)
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

        return Ok(new ProfileResponse(ToUserDto(user)));
    }

    [HttpPut]
    [ProducesResponseType<ProfileResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ProfileResponse>> UpdateProfile(
        [FromBody] UpdateProfileRequest request,
        CancellationToken cancellationToken)
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

        var username = request.Username.Trim();
        if (!UsernameRegex().IsMatch(username))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid username"
            });
        }

        var normalized = username.ToUpperInvariant();
        var isTaken = await _db.Users.AnyAsync(
            x => x.Id != userId && x.NormalizedUsername == normalized,
            cancellationToken);
        if (isTaken)
        {
            return Conflict(new ProblemDetails
            {
                Title = "Username already exists"
            });
        }

        user.Username = username;
        user.NormalizedUsername = normalized;
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(new ProfileResponse(ToUserDto(user)));
    }

    [HttpPost("avatar")]
    [ProducesResponseType<ProfileResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ProfileResponse>> UploadAvatar(
        [FromForm] IFormFile file,
        CancellationToken cancellationToken)
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

        if (file.Length <= 0)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Empty file"
            });
        }

        if (file.Length > _storageOptions.MaxImageSizeBytes)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "File too large"
            });
        }

        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Unsupported file type"
            });
        }

        if (!await HasSupportedImageSignature(file, cancellationToken))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid image payload"
            });
        }

        var root = ResolveRootDirectory();
        var avatarsDir = Path.Combine(root, "avatars");
        Directory.CreateDirectory(avatarsDir);

        var extension = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            extension = ".png";
        }

        var fileName = $"{user.Id:N}-{Guid.NewGuid():N}{extension}";
        var path = Path.Combine(avatarsDir, fileName);
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        user.AvatarUrl = $"{_storageOptions.PublicBasePath.TrimEnd('/')}/avatars/{fileName}";
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(new ProfileResponse(ToUserDto(user)));
    }

    private string ResolveRootDirectory()
    {
        var root = _storageOptions.RootPath;
        if (!Path.IsPathRooted(root))
        {
            root = Path.Combine(AppContext.BaseDirectory, root);
        }

        Directory.CreateDirectory(root);
        return root;
    }

    private static UserDto ToUserDto(AppUser user)
    {
        return new UserDto(user.Id, user.Username, user.Status, user.PlatformRole, user.AvatarUrl);
    }

    private static async Task<bool> HasSupportedImageSignature(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        await using var stream = file.OpenReadStream();
        var header = new byte[12];
        var read = await stream.ReadAsync(header.AsMemory(0, header.Length), cancellationToken);
        if (read < 4)
        {
            return false;
        }

        var isJpeg = read >= 3 &&
            header[0] == 0xFF &&
            header[1] == 0xD8 &&
            header[2] == 0xFF;

        var isPng = read >= 8 &&
            header[0] == 0x89 &&
            header[1] == 0x50 &&
            header[2] == 0x4E &&
            header[3] == 0x47 &&
            header[4] == 0x0D &&
            header[5] == 0x0A &&
            header[6] == 0x1A &&
            header[7] == 0x0A;

        var isGif = read >= 6 &&
            header[0] == 0x47 &&
            header[1] == 0x49 &&
            header[2] == 0x46 &&
            header[3] == 0x38 &&
            (header[4] == 0x37 || header[4] == 0x39) &&
            header[5] == 0x61;

        var isWebp = read >= 12 &&
            header[0] == 0x52 &&
            header[1] == 0x49 &&
            header[2] == 0x46 &&
            header[3] == 0x46 &&
            header[8] == 0x57 &&
            header[9] == 0x45 &&
            header[10] == 0x42 &&
            header[11] == 0x50;

        return isJpeg || isPng || isGif || isWebp;
    }

    [GeneratedRegex("^[\\p{L}\\p{N}._\\-]{2,32}$", RegexOptions.Compiled)]
    private static partial Regex UsernameRegex();
}
