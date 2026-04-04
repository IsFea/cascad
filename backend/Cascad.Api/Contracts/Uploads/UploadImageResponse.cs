namespace Cascad.Api.Contracts.Uploads;

public sealed record UploadImageResponse(
    string Url,
    string OriginalFileName,
    long SizeBytes,
    string ContentType);
