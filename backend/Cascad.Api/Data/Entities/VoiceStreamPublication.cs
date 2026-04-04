namespace Cascad.Api.Data.Entities;

public sealed class VoiceStreamPublication
{
    public Guid ChannelId { get; set; }

    public Channel Channel { get; set; } = null!;

    public Guid UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public bool IsActive { get; set; } = true;

    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime LastSeenAtUtc { get; set; } = DateTime.UtcNow;
}
