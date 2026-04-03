using System.ComponentModel.DataAnnotations;

namespace Cascad.Api.Contracts.Rooms;

public sealed class CreateRoomRequest
{
    [Required]
    [StringLength(80, MinimumLength = 2)]
    public string Name { get; init; } = string.Empty;
}
