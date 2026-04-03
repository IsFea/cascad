namespace Cascad.Api.Contracts.Rooms;

public sealed record CreateInviteResponse(string InviteToken, DateTime ExpiresAtUtc, string InviteUrl);
