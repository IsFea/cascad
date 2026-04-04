using System.IdentityModel.Tokens.Jwt;
using Cascad.Api.Data.Entities;
using Cascad.Api.Options;
using Cascad.Api.Services;

namespace Cascad.Api.Tests;

public sealed class LiveKitTokenServiceTests
{
    [Fact]
    public void GenerateToken_ShouldContainIdentityAndDisplayNameClaims()
    {
        var options = Microsoft.Extensions.Options.Options.Create(new LiveKitOptions
        {
            ApiKey = "devkey",
            ApiSecret = "DEV_LIVEKIT_SECRET_KEY_1234567890123456"
        });

        var service = new LiveKitTokenService(options);
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            Username = "test-player",
            NormalizedUsername = "TEST-PLAYER"
        };
        var room = new Room
        {
            Name = "Raid",
            LiveKitRoomName = "room-test-livekit"
        };

        var token = service.GenerateToken(room, user);
        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal("devkey", parsed.Issuer);
        Assert.Contains(parsed.Claims, claim => claim.Type == "sub" && claim.Value == user.Id.ToString());
        Assert.Contains(parsed.Claims, claim => claim.Type == "name" && claim.Value == user.Nickname);
        Assert.True(parsed.Payload.ContainsKey("video"));
    }
}
