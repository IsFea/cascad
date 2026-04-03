namespace Cascad.Api.Data.Entities;

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Nickname { get; set; } = string.Empty;

    public string NormalizedNickname { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ICollection<Room> OwnedRooms { get; set; } = new List<Room>();

    public ICollection<RoomInvite> CreatedInvites { get; set; } = new List<RoomInvite>();

    public ICollection<RoomPresence> RoomPresences { get; set; } = new List<RoomPresence>();
}
