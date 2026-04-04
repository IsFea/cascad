namespace Cascad.Api.Data.Entities;

public sealed class Channel
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    public ChannelType Type { get; set; } = ChannelType.Text;

    public int Position { get; set; } = 0;

    public int? MaxParticipants { get; set; }

    public int? MaxConcurrentStreams { get; set; }

    public string? LiveKitRoomName { get; set; }

    public Guid CreatedByUserId { get; set; }

    public AppUser CreatedByUser { get; set; } = null!;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public bool IsDeleted { get; set; } = false;

    public ICollection<ChannelMessage> Messages { get; set; } = new List<ChannelMessage>();

    public ICollection<VoiceSession> VoiceSessions { get; set; } = new List<VoiceSession>();

    public ICollection<VoiceStreamPublication> StreamPublications { get; set; } =
        new List<VoiceStreamPublication>();
}
