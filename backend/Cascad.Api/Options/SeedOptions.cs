namespace Cascad.Api.Options;

public sealed class SeedOptions
{
    public const string SectionName = "Seed";

    public bool Enabled { get; set; } = true;

    public bool CreateDemoRoom { get; set; } = true;

    public string DemoOwnerNickname { get; set; } = "host";

    public string DemoRoomName { get; set; } = "Lobby";

    public string? DemoInviteToken { get; set; }

    public int DemoInviteExpiresHours { get; set; } = 720;
}
