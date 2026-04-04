namespace Cascad.Api.Data.Entities;

public sealed class VoiceModerationState
{
    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public bool IsServerMuted { get; set; }

    public bool IsServerDeafened { get; set; }

    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
