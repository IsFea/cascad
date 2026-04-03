using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace Cascad.Api.Services;

public sealed class InviteTokenService : IInviteTokenService
{
    public string CreateRawToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return WebEncoders.Base64UrlEncode(bytes);
    }

    public string ComputeHash(string rawToken)
    {
        var normalized = rawToken.Trim();
        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return WebEncoders.Base64UrlEncode(hashBytes);
    }
}
