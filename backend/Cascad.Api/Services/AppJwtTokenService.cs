using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Cascad.Api.Data.Entities;
using Cascad.Api.Options;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Cascad.Api.Services;

public sealed class AppJwtTokenService : IAppJwtTokenService
{
    private readonly AppJwtOptions _options;
    private readonly JwtSecurityTokenHandler _handler = new();

    public AppJwtTokenService(IOptions<AppJwtOptions> options)
    {
        _options = options.Value;
    }

    public TokenResult GenerateToken(AppUser user)
    {
        var issuedAt = DateTime.UtcNow;
        var expiresAt = issuedAt.AddMinutes(_options.ExpiresMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new("username", user.Username),
            new("status", user.Status.ToString()),
            new(ClaimTypes.Role, user.PlatformRole.ToString())
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: issuedAt,
            expires: expiresAt,
            signingCredentials: credentials);

        return new TokenResult(_handler.WriteToken(token), expiresAt);
    }
}
