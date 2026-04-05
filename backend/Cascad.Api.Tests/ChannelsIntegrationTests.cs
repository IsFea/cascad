using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Cascad.Api.Contracts.Admin;
using Cascad.Api.Contracts.Auth;
using Cascad.Api.Contracts.Channels;
using Cascad.Api.Contracts.Workspace;
using Cascad.Api.Data;
using Cascad.Api.Data.Entities;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ChannelEntity = Cascad.Api.Data.Entities.Channel;

namespace Cascad.Api.Tests;

public sealed class ChannelsIntegrationTests : IClassFixture<TestWebAppFactory>
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly TestWebAppFactory _factory;

    public ChannelsIntegrationTests(TestWebAppFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task JoinTextChannel_ShouldNotDeliverEvents_ToNonMember()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await RegisterAndApproveAsync(adminClient, "chatoutsider");
        var outsiderClient = _factory.CreateClient();
        var outsiderToken = await LoginAsync(outsiderClient, "chatoutsider", "chatoutsider12345");
        outsiderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", outsiderToken);

        var (workspaceId, channelId) = await CreatePrivateTextChannelForAdminAsync();

        var outsiderEvents = System.Threading.Channels.Channel.CreateUnbounded<ChannelMessageDto>();
        var outsiderHub = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(outsiderToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        outsiderHub.On<ChannelMessageDto>("textMessage", payload => outsiderEvents.Writer.TryWrite(payload));

        await outsiderHub.StartAsync();
        try
        {
            await outsiderHub.InvokeAsync("JoinWorkspace", workspaceId);
            await outsiderHub.InvokeAsync("JoinTextChannel", channelId);

            var sendResponse = await adminClient.PostAsJsonAsync(
                $"/api/channels/{channelId}/messages",
                new CreateChannelMessageRequest
                {
                    Content = "private message"
                });
            sendResponse.EnsureSuccessStatusCode();

            var leakedEvent = await TryWaitForTextMessageAsync(
                outsiderEvents.Reader,
                x => x.ChannelId == channelId,
                TimeSpan.FromMilliseconds(700));
            Assert.Null(leakedEvent);
        }
        finally
        {
            await outsiderHub.StopAsync();
            await outsiderHub.DisposeAsync();
        }
    }

    [Fact]
    public async Task JoinWorkspace_ShouldReceiveTextMessages_WithoutJoiningTextChannel()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await RegisterAndApproveAsync(adminClient, "workspacewatcher");
        var watcherClient = _factory.CreateClient();
        var watcherToken = await LoginAsync(watcherClient, "workspacewatcher", "workspacewatcher12345");
        watcherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", watcherToken);

        var watcherWorkspace = await watcherClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(watcherWorkspace);
        var workspaceId = watcherWorkspace!.Workspace.Id;
        var textChannel = watcherWorkspace.Channels.First(x => x.Type == ChannelType.Text);

        var watcherEvents = System.Threading.Channels.Channel.CreateUnbounded<ChannelMessageDto>();
        var watcherHub = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(watcherToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();
        watcherHub.On<ChannelMessageDto>("textMessage", payload => watcherEvents.Writer.TryWrite(payload));

        await watcherHub.StartAsync();
        try
        {
            await watcherHub.InvokeAsync("JoinWorkspace", workspaceId);

            var sendResponse = await adminClient.PostAsJsonAsync(
                $"/api/channels/{textChannel.Id}/messages",
                new CreateChannelMessageRequest
                {
                    Content = "workspace-broadcast-check"
                });
            sendResponse.EnsureSuccessStatusCode();

            var delivered = await TryWaitForTextMessageAsync(
                watcherEvents.Reader,
                x => x.ChannelId == textChannel.Id && x.Content.Contains("workspace-broadcast-check", StringComparison.Ordinal),
                TimeSpan.FromSeconds(2));
            Assert.NotNull(delivered);
        }
        finally
        {
            await watcherHub.StopAsync();
            await watcherHub.DisposeAsync();
        }
    }

    [Fact]
    public async Task CreateMessage_ShouldBeIdempotent_WhenClientMessageIdIsReused()
    {
        var client = _factory.CreateClient();
        var adminToken = await LoginAsync(client, "admin", "admin12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(client, "chatdedupe");

        client.DefaultRequestHeaders.Authorization = null;
        var token = await LoginAsync(client, "chatdedupe", "chatdedupe12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == ChannelType.Text);
        var clientMessageId = Guid.NewGuid();

        var firstResponse = await client.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest
            {
                ClientMessageId = clientMessageId,
                Content = "same-on-retry"
            });
        Assert.Equal(HttpStatusCode.Created, firstResponse.StatusCode);
        var first = await firstResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(first);

        var secondResponse = await client.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest
            {
                ClientMessageId = clientMessageId,
                Content = "same-on-retry"
            });
        Assert.Equal(HttpStatusCode.OK, secondResponse.StatusCode);
        var second = await secondResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(second);

        Assert.Equal(first!.Id, second!.Id);
    }

    [Fact]
    public async Task CreateMessage_ShouldIgnoreNonExistingMentions()
    {
        var client = _factory.CreateClient();
        var adminToken = await LoginAsync(client, "admin", "admin12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(client, "chatmentions");

        client.DefaultRequestHeaders.Authorization = null;
        var token = await LoginAsync(client, "chatmentions", "chatmentions12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == ChannelType.Text);

        var response = await client.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest
            {
                Content = "hello @totally_missing_user"
            });
        response.EnsureSuccessStatusCode();
        var created = await response.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(created);
        Assert.Empty(created!.Mentions);
    }

    [Fact]
    public async Task GetMessages_ShouldReturnOnlyNewItems_WhenAfterIsProvided()
    {
        var client = _factory.CreateClient();
        var adminToken = await LoginAsync(client, "admin", "admin12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(client, "chatafter");

        client.DefaultRequestHeaders.Authorization = null;
        var token = await LoginAsync(client, "chatafter", "chatafter12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == ChannelType.Text);

        var firstResponse = await client.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest
            {
                Content = "first"
            });
        firstResponse.EnsureSuccessStatusCode();
        var first = await firstResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(first);

        await Task.Delay(10);

        var secondResponse = await client.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest
            {
                Content = "second"
            });
        secondResponse.EnsureSuccessStatusCode();
        var second = await secondResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(second);

        var updates = await client.GetFromJsonAsync<ChannelMessagesResponse>(
            $"/api/channels/{textChannel.Id}/messages?after={Uri.EscapeDataString(first!.CreatedAtUtc.ToString("O"))}&limit=50",
            JsonOptions);
        Assert.NotNull(updates);
        Assert.DoesNotContain(updates!.Messages, x => x.Id == first.Id);
        Assert.Contains(updates.Messages, x => x.Id == second!.Id);
    }

    [Fact]
    public async Task WorkspaceUnread_ShouldReflectNewMessages_AndResetAfterRead()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(adminClient, "chatreader");

        var readerClient = _factory.CreateClient();
        var readerToken = await LoginAsync(readerClient, "chatreader", "chatreader12345");
        readerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", readerToken);

        var before = await readerClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(before);
        var textChannel = before!.Channels.First(x => x.Type == ChannelType.Text);
        var baselineUnread = before.ChatUnread.Channels
            .SingleOrDefault(x => x.ChannelId == textChannel.Id)?
            .UnreadCount ?? 0;

        var firstSend = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "reader-unread-1" });
        firstSend.EnsureSuccessStatusCode();

        await Task.Delay(15);

        var secondSend = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "reader-unread-2" });
        secondSend.EnsureSuccessStatusCode();
        var secondMessage = await secondSend.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(secondMessage);

        var after = await readerClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(after);
        var unreadInChannel = after!.ChatUnread.Channels
            .SingleOrDefault(x => x.ChannelId == textChannel.Id)?
            .UnreadCount ?? 0;
        Assert.True(unreadInChannel >= baselineUnread + 2);
        Assert.True(after.ChatUnread.TotalUnreadCount >= unreadInChannel);

        var markReadResponse = await readerClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/read",
            new MarkChannelReadRequest(secondMessage!.CreatedAtUtc));
        Assert.Equal(HttpStatusCode.NoContent, markReadResponse.StatusCode);

        var afterRead = await readerClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(afterRead);
        var unreadAfterRead = afterRead!.ChatUnread.Channels
            .SingleOrDefault(x => x.ChannelId == textChannel.Id)?
            .UnreadCount ?? 0;
        Assert.Equal(0, unreadAfterRead);
    }

    [Fact]
    public async Task MarkChannelRead_ShouldReturnForbid_ForNonMember()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await RegisterAndApproveAsync(adminClient, "readoutsider");
        var outsiderClient = _factory.CreateClient();
        var outsiderToken = await LoginAsync(outsiderClient, "readoutsider", "readoutsider12345");
        outsiderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", outsiderToken);

        var (_, channelId) = await CreatePrivateTextChannelForAdminAsync();

        var response = await outsiderClient.PostAsJsonAsync(
            $"/api/channels/{channelId}/read",
            new MarkChannelReadRequest(DateTime.UtcNow));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private async Task<(Guid workspaceId, Guid channelId)> CreatePrivateTextChannelForAdminAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var admin = await db.Users.SingleAsync(x => x.Username == "admin");

        var workspace = new Workspace
        {
            Name = $"Private {Guid.NewGuid():N}",
            CreatedAtUtc = DateTime.UtcNow
        };
        db.Workspaces.Add(workspace);
        db.WorkspaceMembers.Add(new WorkspaceMember
        {
            WorkspaceId = workspace.Id,
            UserId = admin.Id,
            Role = PlatformRole.Admin,
            JoinedAtUtc = DateTime.UtcNow
        });

        var channel = new ChannelEntity
        {
            WorkspaceId = workspace.Id,
            Name = "private-text",
            Type = ChannelType.Text,
            Position = 1,
            CreatedByUserId = admin.Id,
            CreatedAtUtc = DateTime.UtcNow,
            IsDeleted = false
        };
        db.Channels.Add(channel);
        await db.SaveChangesAsync();

        return (workspace.Id, channel.Id);
    }

    private static async Task<string> LoginAsync(HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new LoginRequest
            {
                Username = username,
                Password = password
            });
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions);
        Assert.NotNull(payload);
        return payload!.AppToken;
    }

    private static async Task RegisterAndApproveAsync(HttpClient adminClient, string username)
    {
        await adminClient.PostAsJsonAsync(
            "/api/auth/register",
            new RegisterRequest
            {
                Username = username,
                Password = $"{username}12345",
                ConfirmPassword = $"{username}12345"
            });

        var approvals = await adminClient.GetFromJsonAsync<ApprovalsResponse>("/api/admin/approvals", JsonOptions);
        var pending = approvals!.Users.Single(x => x.Username == username);
        await adminClient.PostAsync($"/api/admin/approvals/{pending.UserId}/approve", null);
    }

    private static async Task<ChannelMessageDto?> TryWaitForTextMessageAsync(
        ChannelReader<ChannelMessageDto> reader,
        Func<ChannelMessageDto, bool> predicate,
        TimeSpan timeout)
    {
        using var timeoutCts = new CancellationTokenSource(timeout);
        try
        {
            await foreach (var item in reader.ReadAllAsync(timeoutCts.Token))
            {
                if (predicate(item))
                {
                    return item;
                }
            }
        }
        catch (OperationCanceledException)
        {
            return null;
        }

        return null;
    }
}
