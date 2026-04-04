using Cascad.Api.Contracts.Uploads;
using Cascad.Api.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/uploads")]
[Authorize]
public sealed class UploadsController : ControllerBase
{
    private readonly StorageOptions _storageOptions;

    public UploadsController(IOptions<StorageOptions> storageOptions)
    {
        _storageOptions = storageOptions.Value;
    }

    [HttpPost("chat-image")]
    [ProducesResponseType<UploadImageResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<UploadImageResponse>> UploadChatImage(
        [FromForm] IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            return BadRequest(new ProblemDetails { Title = "Empty file" });
        }

        if (file.Length > _storageOptions.MaxImageSizeBytes)
        {
            return BadRequest(new ProblemDetails { Title = "File too large" });
        }

        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new ProblemDetails { Title = "Unsupported file type" });
        }

        var root = ResolveRootDirectory();
        var imagesDir = Path.Combine(root, "chat-images");
        Directory.CreateDirectory(imagesDir);

        var extension = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            extension = ".png";
        }

        var fileName = $"{Guid.NewGuid():N}{extension}";
        var path = Path.Combine(imagesDir, fileName);
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var url = $"{_storageOptions.PublicBasePath.TrimEnd('/')}/chat-images/{fileName}";
        return Ok(new UploadImageResponse(url, file.FileName, file.Length, file.ContentType));
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
}
