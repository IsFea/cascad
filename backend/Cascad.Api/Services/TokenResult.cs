namespace Cascad.Api.Services;

public sealed record TokenResult(string Token, DateTime ExpiresAtUtc);
