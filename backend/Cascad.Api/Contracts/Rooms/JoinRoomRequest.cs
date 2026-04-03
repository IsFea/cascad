using System.ComponentModel.DataAnnotations;

namespace Cascad.Api.Contracts.Rooms;

public sealed class JoinRoomRequest
{
    [Required]
    public string InviteToken { get; init; } = string.Empty;
}
