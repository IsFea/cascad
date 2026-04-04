using Cascad.Api.Contracts.Common;

namespace Cascad.Api.Contracts.Auth;

public sealed record LoginResponse(
    UserDto User,
    string AppToken,
    DateTime ExpiresAtUtc);
