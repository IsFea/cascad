namespace Cascad.Api.Data.Entities;

public sealed class VoiceSession
{
    public Guid ChannelId { get; set; }

    public Channel Channel { get; set; } = null!;

    public Guid UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public bool IsMuted { get; set; }

    public bool IsDeafened { get; set; }

    public string SessionInstanceId { get; set; } = string.Empty;

    public string TabInstanceId { get; set; } = string.Empty;

    public DateTime ConnectedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime LastSeenAtUtc { get; set; } = DateTime.UtcNow;
}
