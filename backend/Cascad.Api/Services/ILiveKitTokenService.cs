using Cascad.Api.Data.Entities;

namespace Cascad.Api.Services;

public interface ILiveKitTokenService
{
    string GenerateToken(Room room, AppUser user);
}
