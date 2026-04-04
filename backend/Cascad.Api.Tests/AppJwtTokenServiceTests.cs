using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Cascad.Api.Data.Entities;
using Cascad.Api.Options;
using Cascad.Api.Services;

namespace Cascad.Api.Tests;

public sealed class AppJwtTokenServiceTests
{
    [Fact]
    public void GenerateToken_ShouldContainExpectedClaims()
    {
        var options = Microsoft.Extensions.Options.Options.Create(new AppJwtOptions
        {
            Issuer = "issuer-test",
            Audience = "audience-test",
            SigningKey = "UNIT_TEST_SIGNING_KEY_1234567890_1234567890",
            ExpiresMinutes = 30
        });

        var service = new AppJwtTokenService(options);
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            Username = "alice",
            NormalizedUsername = "ALICE",
            Status = UserApprovalStatus.Approved,
            PlatformRole = PlatformRole.Admin
        };

        var result = service.GenerateToken(user);
        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(result.Token);

        Assert.Equal("issuer-test", parsed.Issuer);
        Assert.Contains(parsed.Audiences, x => x == "audience-test");
        Assert.Contains(parsed.Claims, x => x.Type == "username" && x.Value == "alice");
        Assert.Contains(parsed.Claims, x => x.Type == "status" && x.Value == "Approved");
        Assert.Contains(parsed.Claims, x => x.Type == ClaimTypes.Role && x.Value == "Admin");
        Assert.Contains(parsed.Claims, x => x.Type == "sub" && x.Value == user.Id.ToString());
        Assert.True(result.ExpiresAtUtc > DateTime.UtcNow);
    }
}
