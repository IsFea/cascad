using Cascad.Api.Contracts.Common;

namespace Cascad.Api.Contracts.Auth;

public sealed record GuestAuthResponse(UserDto User, string AppToken, DateTime ExpiresAtUtc);
