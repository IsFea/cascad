using Cascad.Api.Contracts.Uploads;
using Cascad.Api.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Services;

public sealed class LocalChatMediaStorage : IChatMediaStorage
{
    private readonly StorageOptions _storageOptions;

    public LocalChatMediaStorage(IOptions<StorageOptions> storageOptions)
    {
        _storageOptions = storageOptions.Value;
    }

    public async Task<UploadImageResponse> SaveChatImageAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            throw new InvalidOperationException("Empty file");
        }

        if (file.Length > _storageOptions.MaxImageSizeBytes)
        {
            throw new InvalidOperationException("File too large");
        }

        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Unsupported file type");
        }

        if (!await HasSupportedImageSignature(file, cancellationToken))
        {
            throw new InvalidOperationException("Invalid image payload");
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
        await using (var stream = File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var url = $"{_storageOptions.PublicBasePath.TrimEnd('/')}/chat-images/{fileName}";
        return new UploadImageResponse(url, file.FileName, file.Length, file.ContentType);
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
}
