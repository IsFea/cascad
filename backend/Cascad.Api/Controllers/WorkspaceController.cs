using Cascad.Api.Contracts.Common;
using Cascad.Api.Contracts.Workspace;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Cascad.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/workspace")]
[Authorize]
public sealed class WorkspaceController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IVoicePresenceMaintenanceService _voicePresenceMaintenance;

    public WorkspaceController(
        AppDbContext db,
        IVoicePresenceMaintenanceService voicePresenceMaintenance)
    {
        _db = db;
        _voicePresenceMaintenance = voicePresenceMaintenance;
    }

    [HttpGet]
    [ProducesResponseType<WorkspaceBootstrapResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<WorkspaceBootstrapResponse>> GetWorkspace(CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
        if (user is null)
        {
            return Unauthorized();
        }

        if (user.Status != UserApprovalStatus.Approved)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new ProblemDetails
            {
                Title = "Approval pending"
            });
        }

        var workspace = await _db.Workspaces
            .OrderBy(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        if (workspace is null)
        {
            return NotFound();
        }

        var membership = await _db.WorkspaceMembers
            .SingleOrDefaultAsync(
                x => x.WorkspaceId == workspace.Id && x.UserId == user.Id,
                cancellationToken);
        if (membership is null)
        {
            _db.WorkspaceMembers.Add(new WorkspaceMember
            {
                WorkspaceId = workspace.Id,
                UserId = user.Id,
                Role = user.PlatformRole,
                JoinedAtUtc = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(cancellationToken);
        }

        await _voicePresenceMaintenance.CleanupStaleVoiceStateAsync(cancellationToken);

        var channels = await _db.Channels
            .Where(x => x.WorkspaceId == workspace.Id && !x.IsDeleted)
            .OrderBy(x => x.Type)
            .ThenBy(x => x.Position)
            .ThenBy(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var members = await _db.WorkspaceMembers
            .Where(x => x.WorkspaceId == workspace.Id)
            .Include(x => x.User)
            .ToListAsync(cancellationToken);

        var voiceSessions = await _db.VoiceSessions
            .Where(x => x.Channel.WorkspaceId == workspace.Id)
            .ToListAsync(cancellationToken);

        var moderationByUser = await _db.VoiceModerationStates
            .Where(x => x.WorkspaceId == workspace.Id)
            .ToDictionaryAsync(x => x.UserId, cancellationToken);
        var activeScreenShares = await _db.VoiceStreamPublications
            .Where(x => x.Channel.WorkspaceId == workspace.Id && x.IsActive)
            .Select(x => new { x.UserId, x.ChannelId })
            .ToListAsync(cancellationToken);
        var screenShareByUserChannel = activeScreenShares
            .Select(x => (x.UserId, x.ChannelId))
            .ToHashSet();

        var voiceByUser = voiceSessions
            .GroupBy(x => x.UserId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(v => v.LastSeenAtUtc).First());

        var response = new WorkspaceBootstrapResponse(
            new WorkspaceDto(workspace.Id, workspace.Name, workspace.CreatedAtUtc),
            ToUserDto(user),
            voiceByUser.TryGetValue(user.Id, out var selfVoice) ? selfVoice.ChannelId : null,
            selfVoice?.TabInstanceId,
            channels.Select(ToChannelDto).ToList(),
            members
                .Select(member =>
                {
                    voiceByUser.TryGetValue(member.UserId, out var voiceState);
                    moderationByUser.TryGetValue(member.UserId, out var moderationState);
                    var selfMuted = voiceState?.IsMuted ?? false;
                    var selfDeafened = voiceState?.IsDeafened ?? false;
                    var serverMuted = moderationState?.IsServerMuted ?? false;
                    var serverDeafened = moderationState?.IsServerDeafened ?? false;
                    var effectiveDeafened = selfDeafened || serverDeafened;
                    var effectiveMuted = selfMuted || serverMuted || serverDeafened;
                    return new WorkspaceMemberDto(
                        member.UserId,
                        member.User.Username,
                        member.Role,
                        member.User.AvatarUrl,
                        voiceState?.ChannelId,
                        voiceState is not null &&
                        screenShareByUserChannel.Contains((member.UserId, voiceState.ChannelId)),
                        effectiveMuted,
                        effectiveDeafened,
                        serverMuted,
                        serverDeafened);
                })
                .OrderByDescending(x => x.Role)
                .ThenBy(x => x.Username)
                .ToList());

        return Ok(response);
    }

    [HttpPost("channels")]
    [ProducesResponseType<ChannelDto>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChannelDto>> CreateChannel(
        [FromBody] CreateChannelRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var workspace = await _db.Workspaces.OrderBy(x => x.CreatedAtUtc).FirstOrDefaultAsync(cancellationToken);
        if (workspace is null)
        {
            return NotFound();
        }

        var maxPosition = await _db.Channels
            .Where(x => x.WorkspaceId == workspace.Id && x.Type == request.Type)
            .Select(x => (int?)x.Position)
            .MaxAsync(cancellationToken) ?? 0;

        var channel = new Channel
        {
            WorkspaceId = workspace.Id,
            Name = request.Name.Trim(),
            Type = request.Type,
            Position = maxPosition + 1,
            MaxParticipants = request.Type == ChannelType.Voice
                ? request.MaxParticipants ?? 12
                : null,
            MaxConcurrentStreams = request.Type == ChannelType.Voice
                ? request.MaxConcurrentStreams ?? 4
                : null,
            LiveKitRoomName = request.Type == ChannelType.Voice
                ? $"voice-{workspace.Id:N}-{Guid.NewGuid():N}"
                : null,
            CreatedByUserId = userId,
            CreatedAtUtc = DateTime.UtcNow
        };

        _db.Channels.Add(channel);
        await _db.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, ToChannelDto(channel));
    }

    [HttpPut("channels/{channelId:guid}")]
    [ProducesResponseType<ChannelDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChannelDto>> UpdateChannel(
        Guid channelId,
        [FromBody] UpdateChannelRequest request,
        CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == channelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null)
        {
            return NotFound();
        }

        channel.Name = request.Name.Trim();
        if (channel.Type == ChannelType.Voice)
        {
            channel.MaxParticipants = request.MaxParticipants;
            channel.MaxConcurrentStreams = request.MaxConcurrentStreams;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Ok(ToChannelDto(channel));
    }

    [HttpDelete("channels/{channelId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteChannel(Guid channelId, CancellationToken cancellationToken)
    {
        if (User.GetPlatformRole() != PlatformRole.Admin)
        {
            return Forbid();
        }

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == channelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null)
        {
            return NotFound();
        }

        channel.IsDeleted = true;
        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private static ChannelDto ToChannelDto(Channel channel)
    {
        return new ChannelDto(
            channel.Id,
            channel.WorkspaceId,
            channel.Name,
            channel.Type,
            channel.Position,
            channel.MaxParticipants,
            channel.MaxConcurrentStreams,
            channel.LiveKitRoomName,
            channel.CreatedAtUtc);
    }

    private static UserDto ToUserDto(AppUser user)
    {
        return new UserDto(user.Id, user.Username, user.Status, user.PlatformRole, user.AvatarUrl);
    }

}
