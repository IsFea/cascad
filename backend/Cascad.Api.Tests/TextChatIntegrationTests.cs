using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Cascad.Api.Contracts.Auth;
using Cascad.Api.Contracts.Channels;
using Cascad.Api.Contracts.Workspace;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.Http.Connections;

namespace Cascad.Api.Tests;

public sealed class TextChatIntegrationTests : IClassFixture<TestWebAppFactory>
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly TestWebAppFactory _factory;

    public TextChatIntegrationTests(TestWebAppFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task CreateMessage_ShouldReturn201_AndBroadcastViaSignalR()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var workspace = await adminClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Text);

        // Setup SignalR listener
        var messageChannel = System.Threading.Channels.Channel.CreateUnbounded<ChannelMessageDto>();
        var hubConnection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress!.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(adminToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        hubConnection.On<ChannelMessageDto>("textMessage", msg => messageChannel.Writer.TryWrite(msg));
        await hubConnection.StartAsync();
        await hubConnection.InvokeAsync("JoinTextChannel", textChannel.Id);

        try
        {
            var response = await adminClient.PostAsJsonAsync(
                $"/api/channels/{textChannel.Id}/messages",
                new CreateChannelMessageRequest { Content = "Hello world!" });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            var created = await response.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
            Assert.NotNull(created);
            Assert.Equal("Hello world!", created!.Content);
            Assert.False(created.IsDeleted);
            Assert.False(created.IsEdited);
            Assert.Empty(created.Attachments);
            Assert.Empty(created.Reactions);

            // Verify SignalR broadcast
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var broadcastMsg = await messageChannel.Reader.ReadAsync(cts.Token);
            Assert.Equal(created.Id, broadcastMsg.Id);
            Assert.Equal("Hello world!", broadcastMsg.Content);
        }
        finally
        {
            await hubConnection.StopAsync();
            await hubConnection.DisposeAsync();
        }
    }

    [Fact]
    public async Task DeleteMessage_AsAuthor_ShouldSoftDelete_AndBroadcast()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var workspace = await adminClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Text);

        // Create a message
        var createResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "Delete me" });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(created);

        // Setup SignalR listener
        var deleteChannel = System.Threading.Channels.Channel.CreateUnbounded<dynamic?>();
        var hubConnection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress!.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(adminToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        hubConnection.On<dynamic>("messageDeleted", data => deleteChannel.Writer.TryWrite(data));
        await hubConnection.StartAsync();
        await hubConnection.InvokeAsync("JoinTextChannel", textChannel.Id);

        try
        {
            var deleteResponse = await adminClient.DeleteAsync(
                $"/api/channels/{textChannel.Id}/messages/{created.Id}");
            Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

            // Verify SignalR broadcast
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var deleteEvent = await deleteChannel.Reader.ReadAsync(cts.Token);
            Assert.NotNull(deleteEvent);
        }
        finally
        {
            await hubConnection.StopAsync();
            await hubConnection.DisposeAsync();
        }

        // Verify soft-delete: message should still be retrievable but with isDeleted=true
        var getResponse = await adminClient.GetAsync($"/api/channels/{textChannel.Id}/messages");
        getResponse.EnsureSuccessStatusCode();
        var messages = await getResponse.Content.ReadFromJsonAsync<ChannelMessagesResponse>(JsonOptions);
        Assert.NotNull(messages);
        var deletedMsg = messages!.Messages.FirstOrDefault(m => m.Id == created.Id);
        Assert.NotNull(deletedMsg);
        Assert.True(deletedMsg.IsDeleted);
        Assert.Equal("Сообщение удалено", deletedMsg.Content);
        Assert.Empty(deletedMsg.Attachments);
    }

    [Fact]
    public async Task DeleteMessage_AsNonAuthorNonAdmin_ShouldReturn403()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create and approve a regular user
        await RegisterAndApproveAsync(adminClient, "regularuser");
        var userToken = await LoginAsync(adminClient, "regularuser", "regularuser12345");

        var userClient = _factory.CreateClient();
        userClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userToken);
        var userWorkspace = await userClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(userWorkspace);
        var textChannel = userWorkspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Text);

        // Admin creates a message
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "Admin message" });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(created);

        // Regular user tries to delete admin's message
        userClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userToken);
        var deleteResponse = await userClient.DeleteAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, deleteResponse.StatusCode);
    }

    [Fact]
    public async Task EditMessage_AsAuthor_ShouldUpdateContent_AndBroadcast()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var workspace = await adminClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Text);

        // Create a message
        var createResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "Original" });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(created);

        // Edit the message
        var editResponse = await adminClient.PutAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}",
            new CreateChannelMessageRequest { Content = "Updated content" });
        editResponse.EnsureSuccessStatusCode();
        var edited = await editResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(edited);
        Assert.True(edited!.IsEdited);
        Assert.Equal("Updated content", edited.Content);

        // Verify via GET
        var getResponse = await adminClient.GetAsync($"/api/channels/{textChannel.Id}/messages");
        getResponse.EnsureSuccessStatusCode();
        var messages = await getResponse.Content.ReadFromJsonAsync<ChannelMessagesResponse>(JsonOptions);
        Assert.NotNull(messages);
        var updatedMsg = messages!.Messages.First(m => m.Id == created.Id);
        Assert.True(updatedMsg.IsEdited);
        Assert.NotNull(updatedMsg.UpdatedAtUtc);
    }

    [Fact]
    public async Task AddReaction_ShouldAddReaction_AndBroadcast()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var workspace = await adminClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Text);

        // Create a message
        var createResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "React to this" });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(created);

        // Add reaction
        var reactionResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}/reactions",
            new AddReactionRequest { Emoji = "👍" });
        reactionResponse.EnsureSuccessStatusCode();
        var withReaction = await reactionResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(withReaction);
        Assert.Single(withReaction!.Reactions);
        Assert.Equal("👍", withReaction.Reactions[0].Emoji);

        // Adding same reaction again should fail
        var duplicateResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}/reactions",
            new AddReactionRequest { Emoji = "👍" });
        Assert.Equal(HttpStatusCode.BadRequest, duplicateResponse.StatusCode);
    }

    [Fact]
    public async Task RemoveReaction_ShouldRemoveReaction_AndBroadcast()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var workspace = await adminClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Text);

        // Create a message and add reaction
        var createResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "Test" });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(created);

        var addResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}/reactions",
            new AddReactionRequest { Emoji = "❤️" });
        addResponse.EnsureSuccessStatusCode();

        // Remove reaction
        var removeResponse = await adminClient.DeleteAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}/reactions/{Uri.EscapeDataString("❤️")}");
        Assert.Equal(HttpStatusCode.NoContent, removeResponse.StatusCode);

        // Verify removed
        var getResponse = await adminClient.GetAsync($"/api/channels/{textChannel.Id}/messages");
        getResponse.EnsureSuccessStatusCode();
        var messages = await getResponse.Content.ReadFromJsonAsync<ChannelMessagesResponse>(JsonOptions);
        Assert.NotNull(messages);
        var msg = messages!.Messages.First(m => m.Id == created.Id);
        Assert.Empty(msg.Reactions);
    }

    [Fact]
    public async Task GetMessages_ShouldIncludeReactions_AndEditedFlag()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var workspace = await adminClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var textChannel = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Text);

        // Create message, edit, add reaction
        var createResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages",
            new CreateChannelMessageRequest { Content = "Initial" });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<ChannelMessageDto>(JsonOptions);
        Assert.NotNull(created);

        var editResponse = await adminClient.PutAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}",
            new CreateChannelMessageRequest { Content = "Edited text" });
        editResponse.EnsureSuccessStatusCode();

        var reactionResponse = await adminClient.PostAsJsonAsync(
            $"/api/channels/{textChannel.Id}/messages/{created.Id}/reactions",
            new AddReactionRequest { Emoji = "🎉" });
        reactionResponse.EnsureSuccessStatusCode();

        // GET all messages
        var getResponse = await adminClient.GetAsync($"/api/channels/{textChannel.Id}/messages?limit=50");
        getResponse.EnsureSuccessStatusCode();
        var messages = await getResponse.Content.ReadFromJsonAsync<ChannelMessagesResponse>(JsonOptions);
        Assert.NotNull(messages);
        Assert.NotEmpty(messages!.Messages);

        var msg = messages.Messages.First(m => m.Id == created.Id);
        Assert.True(msg.IsEdited);
        Assert.NotNull(msg.UpdatedAtUtc);
        Assert.Single(msg.Reactions);
        Assert.Equal("🎉", msg.Reactions[0].Emoji);
    }

    private static async Task<string> LoginAsync(HttpClient client, string username, string password)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new LoginRequest { Username = username, Password = password });
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

        var approvals = await adminClient.GetFromJsonAsync<Cascad.Api.Contracts.Admin.ApprovalsResponse>(
            "/api/admin/approvals", JsonOptions);
        var pending = approvals!.Users.Single(x => x.Username == username);
        await adminClient.PostAsync($"/api/admin/approvals/{pending.UserId}/approve", null);
    }
}
