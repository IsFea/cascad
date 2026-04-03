namespace Cascad.Api.Options;

public sealed class AppJwtOptions
{
    public const string SectionName = "AppJwt";

    public string Issuer { get; set; } = "Cascad.Api";

    public string Audience { get; set; } = "Cascad.Client";

    public string SigningKey { get; set; } = "CHANGE_ME_TO_A_LONG_RANDOM_SECRET_1234567890";

    public int ExpiresMinutes { get; set; } = 180;
}
