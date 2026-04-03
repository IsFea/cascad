namespace Cascad.Api.Data.Entities;

public sealed class RoomInvite
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RoomId { get; set; }

    public Room Room { get; set; } = null!;

    public string TokenHash { get; set; } = string.Empty;

    public DateTime ExpiresAtUtc { get; set; }

    public Guid CreatedByUserId { get; set; }

    public AppUser CreatedByUser { get; set; } = null!;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public bool IsRevoked { get; set; }
}
