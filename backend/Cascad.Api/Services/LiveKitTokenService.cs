using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Cascad.Api.Data.Entities;
using Cascad.Api.Options;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Cascad.Api.Services;

public sealed class LiveKitTokenService : ILiveKitTokenService
{
    private readonly LiveKitOptions _options;

    public LiveKitTokenService(IOptions<LiveKitOptions> options)
    {
        _options = options.Value;
    }

    public string GenerateToken(Room room, AppUser user)
    {
        var now = DateTime.UtcNow;
        var expiresAt = now.AddHours(6);

        var videoGrant = new Dictionary<string, object>
        {
            ["roomJoin"] = true,
            ["room"] = room.LiveKitRoomName,
            ["canPublish"] = true,
            ["canSubscribe"] = true,
            ["canPublishData"] = true
        };

        var payload = new JwtPayload
        {
            ["iss"] = _options.ApiKey,
            ["sub"] = user.Id.ToString(),
            ["name"] = user.Nickname,
            ["nbf"] = new DateTimeOffset(now).ToUnixTimeSeconds(),
            ["exp"] = new DateTimeOffset(expiresAt).ToUnixTimeSeconds(),
            ["video"] = videoGrant
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.ApiSecret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(new JwtHeader(credentials), payload);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
