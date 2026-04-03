using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Services;

public sealed class DatabaseSeeder : IDatabaseSeeder
{
    private readonly AppDbContext _db;
    private readonly IInviteTokenService _inviteTokenService;
    private readonly SeedOptions _options;
    private readonly ILogger<DatabaseSeeder> _logger;

    public DatabaseSeeder(
        AppDbContext db,
        IInviteTokenService inviteTokenService,
        IOptions<SeedOptions> options,
        ILogger<DatabaseSeeder> logger)
    {
        _db = db;
        _inviteTokenService = inviteTokenService;
        _options = options.Value;
        _logger = logger;
    }

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled || !_options.CreateDemoRoom)
        {
            return;
        }

        var ownerNickname = (_options.DemoOwnerNickname ?? "host").Trim();
        var roomName = (_options.DemoRoomName ?? "Lobby").Trim();

        if (string.IsNullOrWhiteSpace(ownerNickname) || string.IsNullOrWhiteSpace(roomName))
        {
            _logger.LogWarning("Skipping DB seed because DemoOwnerNickname or DemoRoomName is empty.");
            return;
        }

        var normalizedNickname = ownerNickname.ToUpperInvariant();
        var now = DateTime.UtcNow;

        var owner = await _db.Users.SingleOrDefaultAsync(
            x => x.NormalizedNickname == normalizedNickname,
            cancellationToken);

        if (owner is null)
        {
            owner = new AppUser
            {
                Nickname = ownerNickname,
                NormalizedNickname = normalizedNickname,
                CreatedAtUtc = now
            };
            _db.Users.Add(owner);
            await _db.SaveChangesAsync(cancellationToken);
        }

        var room = await _db.Rooms.SingleOrDefaultAsync(
            x => x.OwnerUserId == owner.Id && x.Name == roomName,
            cancellationToken);

        if (room is null)
        {
            room = new Room
            {
                Name = roomName,
                OwnerUserId = owner.Id,
                LiveKitRoomName = $"room-{Guid.NewGuid():N}",
                CreatedAtUtc = now
            };

            _db.Rooms.Add(room);
            _db.RoomPresences.Add(new RoomPresence
            {
                RoomId = room.Id,
                UserId = owner.Id,
                JoinedAtUtc = now,
                LastSeenAtUtc = now
            });
            await _db.SaveChangesAsync(cancellationToken);
        }

        var hasActiveInvite = await _db.RoomInvites.AnyAsync(
            x => x.RoomId == room.Id && !x.IsRevoked && x.ExpiresAtUtc > now,
            cancellationToken);

        if (hasActiveInvite)
        {
            return;
        }

        var configuredInviteToken = _options.DemoInviteToken?.Trim();
        var rawToken = string.IsNullOrWhiteSpace(configuredInviteToken)
            ? _inviteTokenService.CreateRawToken()
            : configuredInviteToken;

        var tokenHash = _inviteTokenService.ComputeHash(rawToken);
        var hashTaken = await _db.RoomInvites.AnyAsync(x => x.TokenHash == tokenHash, cancellationToken);
        if (hashTaken && !string.IsNullOrWhiteSpace(configuredInviteToken))
        {
            _logger.LogWarning("Configured DemoInviteToken already exists. Skipping invite seed.");
            return;
        }

        while (hashTaken)
        {
            rawToken = _inviteTokenService.CreateRawToken();
            tokenHash = _inviteTokenService.ComputeHash(rawToken);
            hashTaken = await _db.RoomInvites.AnyAsync(x => x.TokenHash == tokenHash, cancellationToken);
        }

        var expiresHours = Math.Max(1, _options.DemoInviteExpiresHours);
        var invite = new RoomInvite
        {
            RoomId = room.Id,
            CreatedByUserId = owner.Id,
            TokenHash = tokenHash,
            CreatedAtUtc = now,
            ExpiresAtUtc = now.AddHours(expiresHours),
            IsRevoked = false
        };

        _db.RoomInvites.Add(invite);
        await _db.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Seed ready: room '{RoomName}' for '{OwnerNickname}'. Invite token: {InviteToken}",
            room.Name,
            owner.Nickname,
            rawToken);
    }
}
