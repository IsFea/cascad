namespace Cascad.Api.Data.Entities;

public sealed class ChannelReadState
{
    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid ChannelId { get; set; }

    public Channel Channel { get; set; } = null!;

    public Guid UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public DateTime LastReadAtUtc { get; set; } = DateTime.UnixEpoch;

    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
