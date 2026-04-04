namespace Cascad.Api.Contracts.Channels;

public sealed record MessageAttachmentDto(
    Guid Id,
    string OriginalFileName,
    string ContentType,
    long FileSizeBytes,
    string UrlPath);
