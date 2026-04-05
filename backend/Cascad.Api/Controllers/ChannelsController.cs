using System.Text.RegularExpressions;
using Cascad.Api.Contracts.Channels;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Cascad.Api.Hubs;
using Cascad.Api.Realtime;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/channels")]
[Authorize]
public sealed partial class ChannelsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHubContext<ChatHub> _hubContext;

    public ChannelsController(AppDbContext db, IHubContext<ChatHub> hubContext)
    {
        _db = db;
        _hubContext = hubContext;
    }

    [HttpGet("{channelId:guid}/messages")]
    [ProducesResponseType<ChannelMessagesResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChannelMessagesResponse>> GetMessages(
        Guid channelId,
        [FromQuery] string? before,
        [FromQuery] string? after,
        [FromQuery] int limit = 40,
        CancellationToken cancellationToken = default)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == channelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null || channel.Type != ChannelType.Text)
        {
            return NotFound();
        }

        var isMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == channel.WorkspaceId && x.UserId == userId,
            cancellationToken);
        if (!isMember)
        {
            return Forbid();
        }

        var safeLimit = Math.Clamp(limit, 1, 100);
        var hasBefore = TryParseCursor(before, out var beforeUtc);
        var hasAfter = TryParseCursor(after, out var afterUtc);

        var query = _db.ChannelMessages
            .Where(x => x.ChannelId == channelId)
            .Include(x => x.User)
            .Include(x => x.Attachments)
            .Include(x => x.Mentions)
            .ThenInclude(x => x.MentionedUser)
            .AsQueryable();

        if (hasBefore)
        {
            query = query.Where(x => x.CreatedAtUtc < beforeUtc.UtcDateTime);
        }

        if (hasAfter)
        {
            query = query.Where(x => x.CreatedAtUtc > afterUtc.UtcDateTime);
            var updates = await query
                .OrderBy(x => x.CreatedAtUtc)
                .Take(safeLimit)
                .ToListAsync(cancellationToken);

            return Ok(new ChannelMessagesResponse(updates.Select(ToDto).ToList(), null));
        }

        var messages = await query
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(safeLimit + 1)
            .ToListAsync(cancellationToken);
        var hasNext = messages.Count > safeLimit;
        var page = messages.Take(safeLimit).OrderBy(x => x.CreatedAtUtc).ToList();
        var nextBefore = hasNext && page.Count > 0 ? page.First().CreatedAtUtc.ToString("O") : null;

        return Ok(new ChannelMessagesResponse(page.Select(ToDto).ToList(), nextBefore));
    }

    [HttpGet("{channelId:guid}/mention-candidates")]
    [ProducesResponseType<MentionCandidatesResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<MentionCandidatesResponse>> GetMentionCandidates(
        Guid channelId,
        [FromQuery] string? q,
        [FromQuery] int limit = 8,
        CancellationToken cancellationToken = default)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == channelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null || channel.Type != ChannelType.Text)
        {
            return NotFound();
        }

        var isMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == channel.WorkspaceId && x.UserId == userId,
            cancellationToken);
        if (!isMember)
        {
            return Forbid();
        }

        var safeLimit = Math.Clamp(limit, 1, 20);
        var normalizedQuery = q?.Trim().ToUpperInvariant();

        var membersQuery = _db.WorkspaceMembers
            .Where(x => x.WorkspaceId == channel.WorkspaceId)
            .Include(x => x.User)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(normalizedQuery))
        {
            membersQuery = membersQuery.Where(x => x.User.NormalizedUsername.Contains(normalizedQuery));
        }

        var users = await membersQuery
            .OrderBy(x => x.User.Username)
            .Take(safeLimit)
            .Select(x => new MentionCandidateDto(
                x.UserId,
                x.User.Username,
                x.User.AvatarUrl))
            .ToListAsync(cancellationToken);

        return Ok(new MentionCandidatesResponse(users));
    }

    [HttpPost("{channelId:guid}/messages")]
    [ProducesResponseType<ChannelMessageDto>(StatusCodes.Status200OK)]
    [ProducesResponseType<ChannelMessageDto>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChannelMessageDto>> CreateMessage(
        Guid channelId,
        [FromBody] CreateChannelMessageRequest request,
        CancellationToken cancellationToken)
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

        var channel = await _db.Channels.SingleOrDefaultAsync(
            x => x.Id == channelId && !x.IsDeleted,
            cancellationToken);
        if (channel is null || channel.Type != ChannelType.Text)
        {
            return NotFound();
        }

        var isMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == channel.WorkspaceId && x.UserId == userId,
            cancellationToken);
        if (!isMember)
        {
            return Forbid();
        }

        var content = request.Content.Trim();
        if (string.IsNullOrWhiteSpace(content) && request.AttachmentUrls.Count == 0)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Empty message"
            });
        }

        if (request.ClientMessageId.HasValue)
        {
            var existing = await FindByClientMessageIdAsync(
                channelId,
                userId,
                request.ClientMessageId.Value,
                cancellationToken);
            if (existing is not null)
            {
                return Ok(ToDto(existing));
            }
        }

        var message = new ChannelMessage
        {
            WorkspaceId = channel.WorkspaceId,
            ChannelId = channel.Id,
            UserId = user.Id,
            ClientMessageId = request.ClientMessageId,
            Content = content,
            CreatedAtUtc = DateTime.UtcNow
        };

        var cleanedAttachmentUrls = request.AttachmentUrls
            .Select(x => x.Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x) && x.StartsWith("/uploads/chat-images/", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .Take(4)
            .ToList();

        foreach (var attachmentUrl in cleanedAttachmentUrls)
        {
            message.Attachments.Add(new MessageAttachment
            {
                OriginalFileName = Path.GetFileName(attachmentUrl),
                ContentType = "image/*",
                FileSizeBytes = 0,
                UrlPath = attachmentUrl,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        var mentionTokenByNormalized = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (Match match in MentionRegex().Matches(content))
        {
            var mentionToken = match.Value;
            var normalizedName = match.Groups[1].Value.ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(normalizedName) || mentionTokenByNormalized.ContainsKey(normalizedName))
            {
                continue;
            }

            mentionTokenByNormalized[normalizedName] = mentionToken;
            if (mentionTokenByNormalized.Count >= 20)
            {
                break;
            }
        }

        var mentionNames = mentionTokenByNormalized.Keys.ToList();

        if (mentionNames.Count > 0)
        {
            var mentionedUsers = await _db.WorkspaceMembers
                .Where(x => x.WorkspaceId == channel.WorkspaceId)
                .Include(x => x.User)
                .Where(x => mentionNames.Contains(x.User.NormalizedUsername))
                .Select(x => x.User)
                .ToListAsync(cancellationToken);

            foreach (var mentioned in mentionedUsers)
            {
                message.Mentions.Add(new MessageMention
                {
                    MentionedUserId = mentioned.Id,
                    MentionToken = mentionTokenByNormalized.GetValueOrDefault(
                        mentioned.NormalizedUsername,
                        $"@{mentioned.Username}")
                });
            }
        }

        _db.ChannelMessages.Add(message);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException) when (request.ClientMessageId.HasValue)
        {
            var existing = await FindByClientMessageIdAsync(
                channelId,
                userId,
                request.ClientMessageId.Value,
                cancellationToken);
            if (existing is not null)
            {
                return Ok(ToDto(existing));
            }

            throw;
        }

        await _db.Entry(message).Reference(x => x.User).LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Attachments).LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Mentions).Query()
            .Include(x => x.MentionedUser)
            .LoadAsync(cancellationToken);

        var dto = ToDto(message);
        await _hubContext.Clients.Group(ChatGroupNames.TextChannel(channelId))
            .SendAsync("textMessage", dto, cancellationToken);

        return StatusCode(StatusCodes.Status201Created, dto);
    }

    private static ChannelMessageDto ToDto(ChannelMessage message)
    {
        return new ChannelMessageDto(
            message.Id,
            message.ChannelId,
            message.UserId,
            message.User.Username,
            message.User.AvatarUrl,
            message.Content,
            message.CreatedAtUtc,
            message.Attachments
                .OrderBy(x => x.CreatedAtUtc)
                .Select(x => new MessageAttachmentDto(
                    x.Id,
                    x.OriginalFileName,
                    x.ContentType,
                    x.FileSizeBytes,
                    x.UrlPath))
                .ToList(),
            message.Mentions
                .Select(x => new MessageMentionDto(
                    x.MentionedUserId,
                    x.MentionedUser.Username,
                    x.MentionToken))
                .ToList());
    }

    private async Task<ChannelMessage?> FindByClientMessageIdAsync(
        Guid channelId,
        Guid userId,
        Guid clientMessageId,
        CancellationToken cancellationToken)
    {
        return await _db.ChannelMessages
            .Where(x =>
                x.ChannelId == channelId &&
                x.UserId == userId &&
                x.ClientMessageId == clientMessageId)
            .Include(x => x.User)
            .Include(x => x.Attachments)
            .Include(x => x.Mentions)
            .ThenInclude(x => x.MentionedUser)
            .SingleOrDefaultAsync(cancellationToken);
    }

    private static bool TryParseCursor(string? value, out DateTimeOffset utcDateTime)
    {
        if (!DateTimeOffset.TryParse(value, out utcDateTime))
        {
            utcDateTime = default;
            return false;
        }

        utcDateTime = utcDateTime.ToUniversalTime();
        return true;
    }

    [GeneratedRegex("@([\\p{L}\\p{N}._\\-]{2,32})", RegexOptions.Compiled)]
    private static partial Regex MentionRegex();
}
