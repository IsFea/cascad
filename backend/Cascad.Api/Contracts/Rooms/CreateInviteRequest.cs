using System.ComponentModel.DataAnnotations;

namespace Cascad.Api.Contracts.Rooms;

public sealed class CreateInviteRequest
{
    [Range(1, 168)]
    public int ExpiresInHours { get; init; } = 24;
}
