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

    public Task JoinTextChannel(Guid channelId)
    {
        return Groups.AddToGroupAsync(Context.ConnectionId, ChatGroupNames.TextChannel(channelId));
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
