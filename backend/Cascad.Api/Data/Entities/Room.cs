namespace Cascad.Api.Data.Entities;

public sealed class Room
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;

    public string LiveKitRoomName { get; set; } = string.Empty;

    public Guid OwnerUserId { get; set; }

    public AppUser OwnerUser { get; set; } = null!;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ICollection<RoomInvite> Invites { get; set; } = new List<RoomInvite>();

    public ICollection<RoomPresence> Presences { get; set; } = new List<RoomPresence>();
}
