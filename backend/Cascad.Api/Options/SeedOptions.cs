namespace Cascad.Api.Options;

public sealed class SeedOptions
{
    public const string SectionName = "Seed";

    public bool Enabled { get; set; } = true;

    public string AdminUsername { get; set; } = "admin";

    public string AdminPassword { get; set; } = "admin12345";

    public string WorkspaceName { get; set; } = "Cascad Workspace";

    public string DefaultVoiceChannelName { get; set; } = "General voice";

    public string DefaultTextChannelName { get; set; } = "general";
}
