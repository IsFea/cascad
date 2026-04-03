using System.ComponentModel.DataAnnotations;

namespace Cascad.Api.Contracts.Auth;

public sealed class GuestAuthRequest
{
    [Required]
    [StringLength(32, MinimumLength = 2)]
    public string Nickname { get; init; } = string.Empty;
}
