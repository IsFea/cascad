namespace Cascad.Api.Services;

public interface IInviteTokenService
{
    string CreateRawToken();

    string ComputeHash(string rawToken);
}
