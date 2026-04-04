namespace Cascad.Api.Options;

public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    public string RootPath { get; set; } = "uploads";

    public string PublicBasePath { get; set; } = "/uploads";

    public long MaxImageSizeBytes { get; set; } = 5 * 1024 * 1024;
}
