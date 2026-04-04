using System.ComponentModel.DataAnnotations.Schema;

namespace Cascad.Api.Data.Entities;

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Username { get; set; } = string.Empty;

    public string NormalizedUsername { get; set; } = string.Empty;

    public string PasswordHash { get; set; } = string.Empty;

    public UserApprovalStatus Status { get; set; } = UserApprovalStatus.Pending;

    public PlatformRole PlatformRole { get; set; } = PlatformRole.User;

    public string? AvatarUrl { get; set; }

    // Backward-compatible alias for older parts of the app.
    [NotMapped]
    public string Nickname
    {
        get => Username;
        set => Username = value;
    }

    [NotMapped]
    public string NormalizedNickname
    {
        get => NormalizedUsername;
        set => NormalizedUsername = value;
    }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ICollection<Room> OwnedRooms { get; set; } = new List<Room>();

    public ICollection<RoomInvite> CreatedInvites { get; set; } = new List<RoomInvite>();

    public ICollection<RoomPresence> RoomPresences { get; set; } = new List<RoomPresence>();

    public ICollection<WorkspaceMember> WorkspaceMemberships { get; set; } = new List<WorkspaceMember>();

    public ICollection<ChannelMessage> Messages { get; set; } = new List<ChannelMessage>();

    public ICollection<VoiceSession> VoiceSessions { get; set; } = new List<VoiceSession>();

    public ICollection<VoiceStreamPublication> StreamPublications { get; set; } =
        new List<VoiceStreamPublication>();

    public ICollection<MessageMention> Mentions { get; set; } = new List<MessageMention>();
}
