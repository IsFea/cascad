using System.Text.RegularExpressions;
using Cascad.Api.Contracts.Channels;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Cascad.Api.Extensions;
using Cascad.Api.Hubs;
using Cascad.Api.Realtime;
using Cascad.Api.Services;
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
    private readonly IMessageContentSanitizer _sanitizer;
    private readonly IRateLimitingService _rateLimiter;

    public ChannelsController(
        AppDbContext db,
        IHubContext<ChatHub> hubContext,
        IMessageContentSanitizer sanitizer,
        IRateLimitingService rateLimiter)
    {
        _db = db;
        _hubContext = hubContext;
        _sanitizer = sanitizer;
        _rateLimiter = rateLimiter;
    }

    [HttpGet("{channelId:guid}/messages")]
    [ProducesResponseType<ChannelMessagesResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChannelMessagesResponse>> GetMessages(
        Guid channelId,
        [FromQuery] string? before,
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
        var query = _db.ChannelMessages
            .Where(x => x.ChannelId == channelId)
            .Include(x => x.User)
            .Include(x => x.Attachments)
            .Include(x => x.Mentions)
            .ThenInclude(x => x.MentionedUser)
            .Include(x => x.Reactions)
            .ThenInclude(x => x.User)
            .OrderByDescending(x => x.CreatedAtUtc)
            .AsQueryable();

        if (DateTime.TryParse(before, out var beforeUtc))
        {
            query = query.Where(x => x.CreatedAtUtc < beforeUtc.ToUniversalTime());
        }

        var messages = await query.Take(safeLimit + 1).ToListAsync(cancellationToken);
        var hasNext = messages.Count > safeLimit;
        var page = messages.Take(safeLimit).OrderBy(x => x.CreatedAtUtc).ToList();
        var nextBefore = hasNext ? page.First().CreatedAtUtc.ToString("O") : null;

        return Ok(new ChannelMessagesResponse(page.Select(ToDto).ToList(), nextBefore));
    }

    [HttpPost("{channelId:guid}/messages")]
    [ProducesResponseType<ChannelMessageDto>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
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

        // Rate limiting
        if (!_rateLimiter.AllowMessage(userId, channelId))
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, new ProblemDetails
            {
                Title = "Rate limit exceeded. Please wait before sending another message."
            });
        }

        var content = request.Content.Trim();
        if (string.IsNullOrWhiteSpace(content) && request.AttachmentUrls.Count == 0)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Empty message"
            });
        }

        // Sanitize content
        var sanitizedContent = _sanitizer.Sanitize(content);

        var message = new ChannelMessage
        {
            WorkspaceId = channel.WorkspaceId,
            ChannelId = channel.Id,
            UserId = user.Id,
            Content = sanitizedContent,
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

        var mentionNames = MentionRegex()
            .Matches(content)
            .Select(x => x.Groups[1].Value.ToUpperInvariant())
            .Distinct()
            .Take(20)
            .ToList();

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
                    MentionedUserId = mentioned.Id
                });
            }
        }

        _db.ChannelMessages.Add(message);
        await _db.SaveChangesAsync(cancellationToken);

        await _db.Entry(message).Reference(x => x.User).LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Attachments).LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Mentions).Query()
            .Include(x => x.MentionedUser)
            .LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Reactions).Query()
            .Include(x => x.User)
            .LoadAsync(cancellationToken);

        var dto = ToDto(message);
        await _hubContext.Clients.Group(ChatGroupNames.TextChannel(channelId))
            .SendAsync("textMessage", dto, cancellationToken);

        return StatusCode(StatusCodes.Status201Created, dto);
    }

    [HttpDelete("{channelId:guid}/messages/{messageId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> DeleteMessage(
        Guid channelId,
        Guid messageId,
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

        var message = await _db.ChannelMessages
            .Include(x => x.Attachments)
            .SingleOrDefaultAsync(x => x.Id == messageId && x.ChannelId == channelId, cancellationToken);
        if (message is null || message.IsDeleted)
        {
            return NotFound();
        }

        // Only author or admin can delete
        var isAdmin = user.PlatformRole == Data.Entities.PlatformRole.Admin;
        if (message.UserId != userId && !isAdmin)
        {
            return Forbid();
        }

        // Soft delete
        message.IsDeleted = true;
        message.DeletedByUserId = userId;
        message.DeletedAtUtc = DateTime.UtcNow;
        message.Content = "Сообщение удалено";

        // Unlink attachments (mark for GC by clearing URL)
        foreach (var attachment in message.Attachments)
        {
            attachment.UrlPath = string.Empty;
        }

        await _db.SaveChangesAsync(cancellationToken);

        // Broadcast deletion event
        await _hubContext.Clients.Group(ChatGroupNames.TextChannel(channelId))
            .SendAsync("messageDeleted", new
            {
                messageId = message.Id,
                channelId,
                isDeleted = true
            }, cancellationToken);

        return NoContent();
    }

    [HttpPut("{channelId:guid}/messages/{messageId:guid}")]
    [ProducesResponseType<ChannelMessageDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChannelMessageDto>> EditMessage(
        Guid channelId,
        Guid messageId,
        [FromBody] CreateChannelMessageRequest request,
        CancellationToken cancellationToken)
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

        var message = await _db.ChannelMessages
            .SingleOrDefaultAsync(x => x.Id == messageId && x.ChannelId == channelId, cancellationToken);
        if (message is null || message.IsDeleted)
        {
            return NotFound();
        }

        // Only author can edit
        if (message.UserId != userId)
        {
            return Forbid();
        }

        var content = request.Content.Trim();
        if (string.IsNullOrWhiteSpace(content))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Message content cannot be empty"
            });
        }

        message.Content = _sanitizer.Sanitize(content);
        message.UpdatedAtUtc = DateTime.UtcNow;
        message.IsEdited = true;

        await _db.SaveChangesAsync(cancellationToken);

        // Reload for DTO
        await _db.Entry(message).Reference(x => x.User).LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Attachments).LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Mentions).Query()
            .Include(x => x.MentionedUser)
            .LoadAsync(cancellationToken);
        await _db.Entry(message).Collection(x => x.Reactions).Query()
            .Include(x => x.User)
            .LoadAsync(cancellationToken);

        var dto = ToDto(message);
        await _hubContext.Clients.Group(ChatGroupNames.TextChannel(channelId))
            .SendAsync("messageEdited", dto, cancellationToken);

        return Ok(dto);
    }

    [HttpPost("{channelId:guid}/messages/{messageId:guid}/reactions")]
    [ProducesResponseType<ChannelMessageDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChannelMessageDto>> AddReaction(
        Guid channelId,
        Guid messageId,
        [FromBody] AddReactionRequest request,
        CancellationToken cancellationToken)
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

        var message = await _db.ChannelMessages
            .Include(x => x.User)
            .Include(x => x.Attachments)
            .Include(x => x.Mentions)
            .ThenInclude(x => x.MentionedUser)
            .Include(x => x.Reactions)
            .ThenInclude(x => x.User)
            .SingleOrDefaultAsync(x => x.Id == messageId && x.ChannelId == channelId, cancellationToken);
        if (message is null || message.IsDeleted)
        {
            return NotFound();
        }

        // Check if reaction already exists
        var existingReaction = message.Reactions
            .FirstOrDefault(r => r.UserId == userId && r.Emoji == request.Emoji);
        if (existingReaction is not null)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Reaction already exists"
            });
        }

        var reaction = new MessageReaction
        {
            MessageId = messageId,
            UserId = userId,
            Emoji = request.Emoji.Trim(),
            CreatedAtUtc = DateTime.UtcNow
        };

        message.Reactions.Add(reaction);
        await _db.SaveChangesAsync(cancellationToken);

        var dto = ToDto(message);
        await _hubContext.Clients.Group(ChatGroupNames.TextChannel(channelId))
            .SendAsync("reactionChanged", new
            {
                messageId,
                emoji = reaction.Emoji,
                userId,
                action = "added"
            }, cancellationToken);

        return Ok(dto);
    }

    [HttpDelete("{channelId:guid}/messages/{messageId:guid}/reactions/{emoji}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> RemoveReaction(
        Guid channelId,
        Guid messageId,
        string emoji,
        CancellationToken cancellationToken)
    {
        if (!User.TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var reaction = await _db.MessageReactions
            .SingleOrDefaultAsync(
                x => x.MessageId == messageId && x.UserId == userId && x.Emoji == emoji,
                cancellationToken);
        if (reaction is null)
        {
            return NotFound();
        }

        _db.MessageReactions.Remove(reaction);
        await _db.SaveChangesAsync(cancellationToken);

        await _hubContext.Clients.Group(ChatGroupNames.TextChannel(channelId))
            .SendAsync("reactionChanged", new
            {
                messageId,
                emoji,
                userId,
                action = "removed"
            }, cancellationToken);

        return NoContent();
    }

    private static ChannelMessageDto ToDto(ChannelMessage message)
    {
        return new ChannelMessageDto(
            message.Id,
            message.ChannelId,
            message.UserId,
            message.User.Username,
            message.User.AvatarUrl,
            message.IsDeleted ? "Сообщение удалено" : message.Content,
            message.CreatedAtUtc,
            message.UpdatedAtUtc,
            message.IsEdited,
            message.IsDeleted,
            message.IsDeleted
                ? new List<MessageAttachmentDto>()
                : message.Attachments
                    .OrderBy(x => x.CreatedAtUtc)
                    .Select(x => new MessageAttachmentDto(
                        x.Id,
                        x.OriginalFileName,
                        x.ContentType,
                        x.FileSizeBytes,
                        x.UrlPath))
                    .ToList(),
            message.Mentions
                .Select(x => new MessageMentionDto(x.MentionedUserId, x.MentionedUser.Username))
                .ToList(),
            message.Reactions
                .Select(x => new MessageReactionDto(x.UserId, x.User.Username, x.Emoji))
                .ToList());
    }

    [GeneratedRegex("@([\\p{L}\\p{N}._\\-]{2,32})", RegexOptions.Compiled)]
    private static partial Regex MentionRegex();
}
