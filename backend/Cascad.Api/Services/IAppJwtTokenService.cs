using Cascad.Api.Data.Entities;

namespace Cascad.Api.Services;

public interface IAppJwtTokenService
{
    TokenResult GenerateToken(AppUser user);
}
