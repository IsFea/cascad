namespace Cascad.Api.Options;

public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    public bool AllowGuestAuth { get; set; } = false;
}
