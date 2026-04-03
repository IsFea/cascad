namespace Cascad.Api.Data.Entities;

public sealed class RoomPresence
{
    public Guid RoomId { get; set; }

    public Room Room { get; set; } = null!;

    public Guid UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public DateTime JoinedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime LastSeenAtUtc { get; set; } = DateTime.UtcNow;
}
