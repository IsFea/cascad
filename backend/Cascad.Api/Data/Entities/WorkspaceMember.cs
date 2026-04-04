namespace Cascad.Api.Data.Entities;

public sealed class WorkspaceMember
{
    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public PlatformRole Role { get; set; } = PlatformRole.User;

    public DateTime JoinedAtUtc { get; set; } = DateTime.UtcNow;
}
