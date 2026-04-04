using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Options;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Services;

public sealed class DatabaseSeeder : IDatabaseSeeder
{
    private readonly AppDbContext _db;
    private readonly SeedOptions _options;
    private readonly IPasswordHasher<AppUser> _passwordHasher;
    private readonly ILogger<DatabaseSeeder> _logger;

    public DatabaseSeeder(
        AppDbContext db,
        IOptions<SeedOptions> options,
        IPasswordHasher<AppUser> passwordHasher,
        ILogger<DatabaseSeeder> logger)
    {
        _db = db;
        _options = options.Value;
        _passwordHasher = passwordHasher;
        _logger = logger;
    }

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled)
        {
            return;
        }

        var now = DateTime.UtcNow;
        var adminUsername = (_options.AdminUsername ?? string.Empty).Trim();
        var adminPassword = (_options.AdminPassword ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(adminUsername) || string.IsNullOrWhiteSpace(adminPassword))
        {
            _logger.LogWarning("Seed skipped: Seed:AdminUsername or Seed:AdminPassword is empty.");
            return;
        }

        var normalizedAdminUsername = adminUsername.ToUpperInvariant();
        var admin = await _db.Users.SingleOrDefaultAsync(
            x => x.NormalizedUsername == normalizedAdminUsername,
            cancellationToken);

        if (admin is null)
        {
            admin = new AppUser
            {
                Username = adminUsername,
                NormalizedUsername = normalizedAdminUsername,
                Status = UserApprovalStatus.Approved,
                PlatformRole = PlatformRole.Admin,
                CreatedAtUtc = now
            };
            admin.PasswordHash = _passwordHasher.HashPassword(admin, adminPassword);
            _db.Users.Add(admin);
            await _db.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Seeded admin user: {Username}", adminUsername);
        }

        if (admin.Status != UserApprovalStatus.Approved || admin.PlatformRole != PlatformRole.Admin)
        {
            admin.Status = UserApprovalStatus.Approved;
            admin.PlatformRole = PlatformRole.Admin;
            await _db.SaveChangesAsync(cancellationToken);
        }

        var workspaceName = (_options.WorkspaceName ?? "Cascad Workspace").Trim();
        var workspace = await _db.Workspaces.SingleOrDefaultAsync(
            x => x.Name == workspaceName,
            cancellationToken);

        if (workspace is null)
        {
            workspace = new Workspace
            {
                Name = workspaceName,
                CreatedAtUtc = now
            };
            _db.Workspaces.Add(workspace);
            await _db.SaveChangesAsync(cancellationToken);
        }

        var isMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == workspace.Id && x.UserId == admin.Id,
            cancellationToken);

        if (!isMember)
        {
            _db.WorkspaceMembers.Add(new WorkspaceMember
            {
                WorkspaceId = workspace.Id,
                UserId = admin.Id,
                Role = PlatformRole.Admin,
                JoinedAtUtc = now
            });
            await _db.SaveChangesAsync(cancellationToken);
        }

        var voiceChannelName = (_options.DefaultVoiceChannelName ?? "General voice").Trim();
        var textChannelName = (_options.DefaultTextChannelName ?? "general").Trim();

        var hasVoice = await _db.Channels.AnyAsync(
            x => x.WorkspaceId == workspace.Id && x.Type == ChannelType.Voice && !x.IsDeleted,
            cancellationToken);
        if (!hasVoice)
        {
            _db.Channels.Add(new Channel
            {
                WorkspaceId = workspace.Id,
                Name = voiceChannelName,
                Type = ChannelType.Voice,
                Position = 1,
                CreatedByUserId = admin.Id,
                MaxParticipants = 12,
                MaxConcurrentStreams = 4,
                LiveKitRoomName = $"voice-{workspace.Id:N}-1",
                CreatedAtUtc = now
            });
        }

        var hasText = await _db.Channels.AnyAsync(
            x => x.WorkspaceId == workspace.Id && x.Type == ChannelType.Text && !x.IsDeleted,
            cancellationToken);
        if (!hasText)
        {
            _db.Channels.Add(new Channel
            {
                WorkspaceId = workspace.Id,
                Name = textChannelName,
                Type = ChannelType.Text,
                Position = 1,
                CreatedByUserId = admin.Id,
                CreatedAtUtc = now
            });
        }

        await _db.SaveChangesAsync(cancellationToken);
    }
}
