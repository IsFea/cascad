using Cascad.Api.Contracts.Common;
using Cascad.Api.Contracts.Rooms;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Cascad.Api.Options;
using Cascad.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/rooms")]
[Authorize]
public sealed class RoomsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IInviteTokenService _inviteTokenService;
    private readonly IAppJwtTokenService _appJwtTokenService;
    private readonly ILiveKitTokenService _liveKitTokenService;
    private readonly ClientOptions _clientOptions;
    private readonly LiveKitOptions _liveKitOptions;

    public RoomsController(
        AppDbContext db,
        IInviteTokenService inviteTokenService,
        IAppJwtTokenService appJwtTokenService,
        ILiveKitTokenService liveKitTokenService,
        IOptions<ClientOptions> clientOptions,
        IOptions<LiveKitOptions> liveKitOptions)
    {
        _db = db;
        _inviteTokenService = inviteTokenService;
        _appJwtTokenService = appJwtTokenService;
        _liveKitTokenService = liveKitTokenService;
        _clientOptions = clientOptions.Value;
        _liveKitOptions = liveKitOptions.Value;
    }

    [HttpPost]
    [ProducesResponseType<RoomDto>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<RoomDto>> CreateRoom(
        [FromBody] CreateRoomRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetCurrentUserId(out var userId))
        {
            return Unauthorized();
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return Unauthorized();
        }

        var room = new Room
        {
            Name = request.Name.Trim(),
            OwnerUserId = user.Id,
            LiveKitRoomName = $"room-{Guid.NewGuid():N}",
            CreatedAtUtc = DateTime.UtcNow
        };

        _db.Rooms.Add(room);
        _db.RoomPresences.Add(new RoomPresence
        {
            RoomId = room.Id,
            UserId = user.Id,
            JoinedAtUtc = DateTime.UtcNow,
            LastSeenAtUtc = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetRoom), new { roomId = room.Id }, ToRoomDto(room));
    }

    [HttpPost("{roomId:guid}/invites")]
    [ProducesResponseType<CreateInviteResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CreateInviteResponse>> CreateInvite(
        Guid roomId,
        [FromBody] CreateInviteRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetCurrentUserId(out var userId))
        {
            return Unauthorized();
        }

        var room = await _db.Rooms.SingleOrDefaultAsync(x => x.Id == roomId, cancellationToken);
        if (room is null)
        {
            return NotFound();
        }

        if (room.OwnerUserId != userId)
        {
            return Forbid();
        }

        var rawToken = _inviteTokenService.CreateRawToken();
        var tokenHash = _inviteTokenService.ComputeHash(rawToken);

        var invite = new RoomInvite
        {
            RoomId = room.Id,
            TokenHash = tokenHash,
            ExpiresAtUtc = DateTime.UtcNow.AddHours(request.ExpiresInHours),
            CreatedByUserId = userId,
            CreatedAtUtc = DateTime.UtcNow
        };

        _db.RoomInvites.Add(invite);
        await _db.SaveChangesAsync(cancellationToken);

        var baseUrl = _clientOptions.BaseUrl.TrimEnd('/');
        var inviteUrl = $"{baseUrl}/?invite={rawToken}";

        return Ok(new CreateInviteResponse(rawToken, invite.ExpiresAtUtc, inviteUrl));
    }

    [HttpPost("join")]
    [ProducesResponseType<JoinRoomResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<JoinRoomResponse>> JoinRoom(
        [FromBody] JoinRoomRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetCurrentUserId(out var userId))
        {
            return Unauthorized();
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return Unauthorized();
        }

        var tokenHash = _inviteTokenService.ComputeHash(request.InviteToken);
        var now = DateTime.UtcNow;

        var invite = await _db.RoomInvites
            .Include(x => x.Room)
            .SingleOrDefaultAsync(
                x => x.TokenHash == tokenHash &&
                     !x.IsRevoked &&
                     x.ExpiresAtUtc > now,
                cancellationToken);

        if (invite is null)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid invite token",
                Detail = "Invite token is invalid, expired, or revoked."
            });
        }

        var presence = await _db.RoomPresences.SingleOrDefaultAsync(
            x => x.RoomId == invite.RoomId && x.UserId == userId,
            cancellationToken);

        if (presence is null)
        {
            _db.RoomPresences.Add(new RoomPresence
            {
                RoomId = invite.RoomId,
                UserId = userId,
                JoinedAtUtc = now,
                LastSeenAtUtc = now
            });
        }
        else
        {
            presence.LastSeenAtUtc = now;
        }

        await _db.SaveChangesAsync(cancellationToken);

        var appToken = _appJwtTokenService.GenerateToken(user);
        var rtcToken = _liveKitTokenService.GenerateToken(invite.Room, user);

        return Ok(new JoinRoomResponse(
            ToRoomDto(invite.Room),
            new UserDto(user.Id, user.Username, user.Status, user.PlatformRole, user.AvatarUrl),
            appToken.Token,
            rtcToken,
            _liveKitOptions.RtcUrl));
    }

    [HttpGet("{roomId:guid}")]
    [ProducesResponseType<RoomDetailsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RoomDetailsResponse>> GetRoom(Guid roomId, CancellationToken cancellationToken)
    {
        if (!TryGetCurrentUserId(out var userId))
        {
            return Unauthorized();
        }

        var room = await _db.Rooms
            .Include(x => x.Presences)
            .ThenInclude(x => x.User)
            .SingleOrDefaultAsync(x => x.Id == roomId, cancellationToken);

        if (room is null)
        {
            return NotFound();
        }

        var allowed = room.OwnerUserId == userId || room.Presences.Any(x => x.UserId == userId);
        if (!allowed)
        {
            return Forbid();
        }

        var participants = room.Presences
            .OrderByDescending(x => x.LastSeenAtUtc)
            .Select(x => new UserDto(
                x.User.Id,
                x.User.Username,
                x.User.Status,
                x.User.PlatformRole,
                x.User.AvatarUrl))
            .ToList();

        return Ok(new RoomDetailsResponse(ToRoomDto(room), participants));
    }

    private bool TryGetCurrentUserId(out Guid userId)
    {
        return User.TryGetUserId(out userId);
    }

    private static RoomDto ToRoomDto(Room room)
    {
        return new RoomDto(room.Id, room.Name, room.LiveKitRoomName, room.OwnerUserId, room.CreatedAtUtc);
    }
}
