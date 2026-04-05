using Cascad.Api.Data;
using Cascad.Api.Extensions;
using Cascad.Api.Realtime;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Hubs;

[Authorize]
public sealed class ChatHub : Hub
{
    private readonly AppDbContext _db;

    public ChatHub(AppDbContext db)
    {
        _db = db;
    }

    public async Task JoinTextChannel(Guid channelId)
    {
        if (Context.User is null || !Context.User.TryGetUserId(out var userId))
        {
            return;
        }

        var channel = await _db.Channels
            .Where(x => x.Id == channelId && !x.IsDeleted)
            .Select(x => new { x.Id, x.WorkspaceId, x.Type })
            .SingleOrDefaultAsync(Context.ConnectionAborted);
        if (channel is null || channel.Type != Cascad.Api.Data.Entities.ChannelType.Text)
        {
            return;
        }

        var isMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == channel.WorkspaceId && x.UserId == userId,
            Context.ConnectionAborted);
        if (!isMember)
        {
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, ChatGroupNames.TextChannel(channelId));
    }

    public async Task JoinWorkspace(Guid workspaceId)
    {
        if (Context.User is null || !Context.User.TryGetUserId(out var userId))
        {
            return;
        }

        var isMember = await _db.WorkspaceMembers.AnyAsync(
            x => x.WorkspaceId == workspaceId && x.UserId == userId,
            Context.ConnectionAborted);
        if (!isMember)
        {
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, ChatGroupNames.Workspace(workspaceId));
    }

    public Task LeaveWorkspace(Guid workspaceId)
    {
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, ChatGroupNames.Workspace(workspaceId));
    }

    public Task LeaveTextChannel(Guid channelId)
    {
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, ChatGroupNames.TextChannel(channelId));
    }

    public Task JoinVoiceChannel(Guid channelId)
    {
        return Groups.AddToGroupAsync(Context.ConnectionId, ChatGroupNames.VoiceChannel(channelId));
    }

    public Task LeaveVoiceChannel(Guid channelId)
    {
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, ChatGroupNames.VoiceChannel(channelId));
    }

    public async Task SendVoiceMessage(Guid channelId, string content)
    {
        if (Context.User is null || !Context.User.TryGetUserId(out var userId))
        {
            return;
        }

        var sessionExists = await _db.VoiceSessions.AnyAsync(
            x => x.ChannelId == channelId && x.UserId == userId,
            Context.ConnectionAborted);
        if (!sessionExists)
        {
            return;
        }

        var username = Context.User.GetUsernameOrEmpty();
        await Clients.Group(ChatGroupNames.VoiceChannel(channelId)).SendAsync(
            "voiceMessage",
            new
            {
                channelId,
                userId,
                username,
                content = content.Trim(),
                createdAtUtc = DateTime.UtcNow
            },
            Context.ConnectionAborted);
    }
}
