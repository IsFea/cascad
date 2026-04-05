using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading.Channels;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Cascad.Api.Contracts.Admin;
using Cascad.Api.Contracts.Auth;
using Cascad.Api.Contracts.Voice;
using Cascad.Api.Contracts.Workspace;
using Cascad.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Cascad.Api.Tests;

public sealed class RoomsFlowIntegrationTests : IClassFixture<TestWebAppFactory>
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly TestWebAppFactory _factory;

    public RoomsFlowIntegrationTests(TestWebAppFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task RegisterApprovalAndVoiceConnectFlow_ShouldWork()
    {
        var client = _factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync(
            "/api/auth/register",
            new RegisterRequest
            {
                Username = "alice",
                Password = "alice12345",
                ConfirmPassword = "alice12345"
            });
        Assert.Equal(HttpStatusCode.Created, registerResponse.StatusCode);

        var blockedLoginResponse = await client.PostAsJsonAsync(
            "/api/auth/login",
            new LoginRequest
            {
                Username = "alice",
                Password = "alice12345"
            });
        Assert.Equal(HttpStatusCode.Forbidden, blockedLoginResponse.StatusCode);

        var adminToken = await LoginAsync(client, "admin", "admin12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var approvalsResponse = await client.GetFromJsonAsync<ApprovalsResponse>("/api/admin/approvals", JsonOptions);
        Assert.NotNull(approvalsResponse);
        var pending = approvalsResponse!.Users.Single(x => x.Username == "alice");

        var approveResponse = await client.PostAsync($"/api/admin/approvals/{pending.UserId}/approve", null);
        Assert.Equal(HttpStatusCode.NoContent, approveResponse.StatusCode);

        client.DefaultRequestHeaders.Authorization = null;
        var aliceToken = await LoginAsync(client, "alice", "alice12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", aliceToken);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var voiceChannel = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice);

        var connectResponse = await client.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest { ChannelId = voiceChannel.Id });
        connectResponse.EnsureSuccessStatusCode();
        var connected = await connectResponse.Content.ReadFromJsonAsync<VoiceConnectResponse>(JsonOptions);
        Assert.NotNull(connected);
        Assert.False(string.IsNullOrWhiteSpace(connected!.RtcToken));
        Assert.False(string.IsNullOrWhiteSpace(connected.RtcUrl));

        var rtcJwt = new JwtSecurityTokenHandler().ReadJwtToken(connected.RtcToken);
        Assert.Contains(rtcJwt.Claims, x => x.Type == "name" && x.Value == "alice");
    }

    [Fact]
    public async Task StreamPermit_ShouldEnforceChannelLimit()
    {
        var client = _factory.CreateClient();
        var adminToken = await LoginAsync(client, "admin", "admin12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createVoice = await client.PostAsJsonAsync(
            "/api/workspace/channels",
            new CreateChannelRequest
            {
                Name = "limited",
                Type = Cascad.Api.Data.Entities.ChannelType.Voice,
                MaxParticipants = 12,
                MaxConcurrentStreams = 1
            });
        createVoice.EnsureSuccessStatusCode();
        var channel = await createVoice.Content.ReadFromJsonAsync<ChannelDto>(JsonOptions);
        Assert.NotNull(channel);

        // Approve user1
        await RegisterAndApproveAsync(client, "user1");
        client.DefaultRequestHeaders.Authorization = null;
        var user1Token = await LoginAsync(client, "user1", "user112345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", user1Token);
        await client.GetAsync("/api/workspace");
        await client.PostAsJsonAsync("/api/voice/connect", new VoiceConnectRequest { ChannelId = channel!.Id });
        var permit1 = await client.PostAsJsonAsync(
            "/api/voice/streams/permit",
            new StreamPermitRequest { ChannelId = channel.Id });
        var permit1Body = await permit1.Content.ReadFromJsonAsync<StreamPermitResponse>(JsonOptions);
        Assert.NotNull(permit1Body);
        Assert.True(permit1Body!.Allowed);

        // Approve user2
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(client, "user2");
        client.DefaultRequestHeaders.Authorization = null;
        var user2Token = await LoginAsync(client, "user2", "user212345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", user2Token);
        await client.GetAsync("/api/workspace");
        await client.PostAsJsonAsync("/api/voice/connect", new VoiceConnectRequest { ChannelId = channel.Id });
        var permit2 = await client.PostAsJsonAsync(
            "/api/voice/streams/permit",
            new StreamPermitRequest { ChannelId = channel.Id });
        var permit2Body = await permit2.Content.ReadFromJsonAsync<StreamPermitResponse>(JsonOptions);
        Assert.NotNull(permit2Body);
        Assert.False(permit2Body!.Allowed);
    }

    [Fact]
    public async Task VoicePresenceChanged_ShouldBeDeliveredToWorkspaceSubscribers_OnConnectAndDisconnect()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await RegisterAndApproveAsync(adminClient, "voicealice");
        await RegisterAndApproveAsync(adminClient, "voicebob");

        var aliceClient = _factory.CreateClient();
        var aliceToken = await LoginAsync(aliceClient, "voicealice", "voicealice12345");
        aliceClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", aliceToken);

        var bobClient = _factory.CreateClient();
        var bobToken = await LoginAsync(bobClient, "voicebob", "voicebob12345");
        bobClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bobToken);
        var bobWorkspace = await bobClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(bobWorkspace);

        var aliceWorkspace = await aliceClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(aliceWorkspace);
        var workspaceId = aliceWorkspace!.Workspace.Id;
        var voiceChannelId = aliceWorkspace.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;
        var aliceUserId = aliceWorkspace.CurrentUser.Id;

        var eventChannel = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var hubConnection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(bobToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        hubConnection.On<VoicePresenceChangedEventDto>(
            "voicePresenceChanged",
            payload => eventChannel.Writer.TryWrite(payload));

        await hubConnection.StartAsync();
        try
        {
            await hubConnection.InvokeAsync("JoinWorkspace", workspaceId);

            var connectResponse = await aliceClient.PostAsJsonAsync(
                "/api/voice/connect",
                new VoiceConnectRequest { ChannelId = voiceChannelId });
            connectResponse.EnsureSuccessStatusCode();

            var connectEvent = await WaitForVoicePresenceAsync(
                eventChannel.Reader,
                x => x.UserId == aliceUserId && x.CurrentVoiceChannelId == voiceChannelId);
            Assert.Equal(workspaceId, connectEvent.WorkspaceId);
            Assert.Null(connectEvent.PreviousVoiceChannelId);
            Assert.Equal(voiceChannelId, connectEvent.CurrentVoiceChannelId);

            var disconnectResponse = await aliceClient.PostAsJsonAsync(
                "/api/voice/disconnect",
                new VoiceDisconnectRequest { ChannelId = voiceChannelId });
            disconnectResponse.EnsureSuccessStatusCode();

            var disconnectEvent = await WaitForVoicePresenceAsync(
                eventChannel.Reader,
                x => x.UserId == aliceUserId && x.CurrentVoiceChannelId is null && x.PreviousVoiceChannelId == voiceChannelId);
            Assert.Equal(workspaceId, disconnectEvent.WorkspaceId);
            Assert.Equal(voiceChannelId, disconnectEvent.PreviousVoiceChannelId);
            Assert.Null(disconnectEvent.CurrentVoiceChannelId);
        }
        finally
        {
            await hubConnection.StopAsync();
            await hubConnection.DisposeAsync();
        }
    }

    [Fact]
    public async Task VoiceChannelPresenceChanged_ShouldBeDeliveredToVoiceChannelSubscribers_OnConnectAndDisconnect()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await RegisterAndApproveAsync(adminClient, "channelalice");
        await RegisterAndApproveAsync(adminClient, "channelbob");

        var aliceClient = _factory.CreateClient();
        var aliceToken = await LoginAsync(aliceClient, "channelalice", "channelalice12345");
        aliceClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", aliceToken);

        var bobClient = _factory.CreateClient();
        var bobToken = await LoginAsync(bobClient, "channelbob", "channelbob12345");
        bobClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bobToken);
        var bobWorkspace = await bobClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(bobWorkspace);

        var aliceWorkspace = await aliceClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(aliceWorkspace);
        var voiceChannelId = aliceWorkspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;
        var aliceUserId = aliceWorkspace.CurrentUser.Id;

        var eventChannel = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var hubConnection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(bobToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        hubConnection.On<VoicePresenceChangedEventDto>(
            "voiceChannelPresenceChanged",
            payload => eventChannel.Writer.TryWrite(payload));

        await hubConnection.StartAsync();
        try
        {
            await hubConnection.InvokeAsync("JoinVoiceChannel", voiceChannelId);

            var connectResponse = await aliceClient.PostAsJsonAsync(
                "/api/voice/connect",
                new VoiceConnectRequest { ChannelId = voiceChannelId });
            connectResponse.EnsureSuccessStatusCode();

            var connectEvent = await WaitForVoicePresenceAsync(
                eventChannel.Reader,
                x => x.UserId == aliceUserId && x.CurrentVoiceChannelId == voiceChannelId);
            Assert.Equal(voiceChannelId, connectEvent.CurrentVoiceChannelId);

            var disconnectResponse = await aliceClient.PostAsJsonAsync(
                "/api/voice/disconnect",
                new VoiceDisconnectRequest { ChannelId = voiceChannelId });
            disconnectResponse.EnsureSuccessStatusCode();

            var disconnectEvent = await WaitForVoicePresenceAsync(
                eventChannel.Reader,
                x => x.UserId == aliceUserId &&
                     x.PreviousVoiceChannelId == voiceChannelId &&
                     x.CurrentVoiceChannelId is null);
            Assert.Equal(voiceChannelId, disconnectEvent.PreviousVoiceChannelId);
            Assert.Null(disconnectEvent.CurrentVoiceChannelId);
        }
        finally
        {
            await hubConnection.StopAsync();
            await hubConnection.DisposeAsync();
        }
    }

    [Fact]
    public async Task VoiceChannelPresenceChanged_ShouldBeDeliveredToPreviousAndCurrentChannels_OnSwitch()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await RegisterAndApproveAsync(adminClient, "switchmover");
        await RegisterAndApproveAsync(adminClient, "switchwatchera");
        await RegisterAndApproveAsync(adminClient, "switchwatcherb");

        var createVoice = await adminClient.PostAsJsonAsync(
            "/api/workspace/channels",
            new CreateChannelRequest
            {
                Name = "switch-target",
                Type = Cascad.Api.Data.Entities.ChannelType.Voice,
                MaxParticipants = 12,
                MaxConcurrentStreams = 4
            });
        createVoice.EnsureSuccessStatusCode();
        var secondVoice = await createVoice.Content.ReadFromJsonAsync<ChannelDto>(JsonOptions);
        Assert.NotNull(secondVoice);

        var moverClient = _factory.CreateClient();
        var moverToken = await LoginAsync(moverClient, "switchmover", "switchmover12345");
        moverClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", moverToken);
        var moverWorkspace = await moverClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(moverWorkspace);
        var firstVoiceChannelId = moverWorkspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;
        var secondVoiceChannelId = secondVoice!.Id;
        var moverUserId = moverWorkspace.CurrentUser.Id;

        var watcherAToken = await LoginAsync(_factory.CreateClient(), "switchwatchera", "switchwatchera12345");
        var watcherBToken = await LoginAsync(_factory.CreateClient(), "switchwatcherb", "switchwatcherb12345");

        var eventsA = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var eventsB = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();

        var hubA = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(watcherAToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();
        hubA.On<VoicePresenceChangedEventDto>(
            "voiceChannelPresenceChanged",
            payload => eventsA.Writer.TryWrite(payload));

        var hubB = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(watcherBToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();
        hubB.On<VoicePresenceChangedEventDto>(
            "voiceChannelPresenceChanged",
            payload => eventsB.Writer.TryWrite(payload));

        await hubA.StartAsync();
        await hubB.StartAsync();
        try
        {
            await hubA.InvokeAsync("JoinVoiceChannel", firstVoiceChannelId);
            await hubB.InvokeAsync("JoinVoiceChannel", secondVoiceChannelId);

            var connectFirst = await moverClient.PostAsJsonAsync(
                "/api/voice/connect",
                new VoiceConnectRequest { ChannelId = firstVoiceChannelId });
            connectFirst.EnsureSuccessStatusCode();

            var switchResponse = await moverClient.PostAsJsonAsync(
                "/api/voice/connect",
                new VoiceConnectRequest { ChannelId = secondVoiceChannelId });
            switchResponse.EnsureSuccessStatusCode();

            var leftFirstChannelEvent = await WaitForVoicePresenceAsync(
                eventsA.Reader,
                x => x.UserId == moverUserId &&
                     x.PreviousVoiceChannelId == firstVoiceChannelId &&
                     x.CurrentVoiceChannelId == secondVoiceChannelId);
            Assert.Equal(firstVoiceChannelId, leftFirstChannelEvent.PreviousVoiceChannelId);
            Assert.Equal(secondVoiceChannelId, leftFirstChannelEvent.CurrentVoiceChannelId);

            var joinedSecondChannelEvent = await WaitForVoicePresenceAsync(
                eventsB.Reader,
                x => x.UserId == moverUserId &&
                     x.PreviousVoiceChannelId == firstVoiceChannelId &&
                     x.CurrentVoiceChannelId == secondVoiceChannelId);
            Assert.Equal(firstVoiceChannelId, joinedSecondChannelEvent.PreviousVoiceChannelId);
            Assert.Equal(secondVoiceChannelId, joinedSecondChannelEvent.CurrentVoiceChannelId);
        }
        finally
        {
            await hubA.StopAsync();
            await hubA.DisposeAsync();
            await hubB.StopAsync();
            await hubB.DisposeAsync();
        }
    }

    [Fact]
    public async Task StaleVoicePresence_ShouldBeBroadcastByBackgroundCleanupLoop_WithoutVoiceEndpointCall()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        await RegisterAndApproveAsync(adminClient, "stalecleanalice");
        await RegisterAndApproveAsync(adminClient, "stalecleanbob");

        var aliceClient = _factory.CreateClient();
        var aliceToken = await LoginAsync(aliceClient, "stalecleanalice", "stalecleanalice12345");
        aliceClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", aliceToken);

        var bobClient = _factory.CreateClient();
        var bobToken = await LoginAsync(bobClient, "stalecleanbob", "stalecleanbob12345");
        bobClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bobToken);
        var bobWorkspace = await bobClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(bobWorkspace);

        var aliceWorkspace = await aliceClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(aliceWorkspace);
        var workspaceId = aliceWorkspace!.Workspace.Id;
        var voiceChannelId = aliceWorkspace.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;
        var aliceUserId = aliceWorkspace.CurrentUser.Id;

        var workspaceEventChannel = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var voiceChannelEventChannel = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var hubConnection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(bobToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        hubConnection.On<VoicePresenceChangedEventDto>(
            "voicePresenceChanged",
            payload => workspaceEventChannel.Writer.TryWrite(payload));
        hubConnection.On<VoicePresenceChangedEventDto>(
            "voiceChannelPresenceChanged",
            payload => voiceChannelEventChannel.Writer.TryWrite(payload));

        await hubConnection.StartAsync();
        try
        {
            await hubConnection.InvokeAsync("JoinWorkspace", workspaceId);
            await hubConnection.InvokeAsync("JoinVoiceChannel", voiceChannelId);

            var connectResponse = await aliceClient.PostAsJsonAsync(
                "/api/voice/connect",
                new VoiceConnectRequest { ChannelId = voiceChannelId });
            connectResponse.EnsureSuccessStatusCode();

            _ = await WaitForVoicePresenceAsync(
                workspaceEventChannel.Reader,
                x => x.UserId == aliceUserId && x.CurrentVoiceChannelId == voiceChannelId);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var staleSession = await db.VoiceSessions.SingleAsync(
                x => x.ChannelId == voiceChannelId && x.UserId == aliceUserId);
            staleSession.LastSeenAtUtc = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();

            var staleDisconnectEvent = await WaitForVoicePresenceAsync(
                workspaceEventChannel.Reader,
                x => x.UserId == aliceUserId &&
                     x.PreviousVoiceChannelId == voiceChannelId &&
                     x.CurrentVoiceChannelId is null);
            Assert.Equal(workspaceId, staleDisconnectEvent.WorkspaceId);

            var staleChannelDisconnectEvent = await WaitForVoicePresenceAsync(
                voiceChannelEventChannel.Reader,
                x => x.UserId == aliceUserId &&
                     x.PreviousVoiceChannelId == voiceChannelId &&
                     x.CurrentVoiceChannelId is null);
            Assert.Equal(voiceChannelId, staleChannelDisconnectEvent.PreviousVoiceChannelId);
            Assert.Null(staleChannelDisconnectEvent.CurrentVoiceChannelId);
        }
        finally
        {
            await hubConnection.StopAsync();
            await hubConnection.DisposeAsync();
        }
    }

    [Fact]
    public async Task Disconnect_ShouldBeIdempotent_WhenCalledConcurrently()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(adminClient, "voicecharlie");

        var client = _factory.CreateClient();
        var token = await LoginAsync(client, "voicecharlie", "voicecharlie12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var voiceChannelId = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;

        var connectResponse = await client.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest { ChannelId = voiceChannelId });
        connectResponse.EnsureSuccessStatusCode();
        var connected = await connectResponse.Content.ReadFromJsonAsync<VoiceConnectResponse>(JsonOptions);
        Assert.NotNull(connected);

        var request = new VoiceDisconnectRequest
        {
            ChannelId = voiceChannelId,
            SessionInstanceId = connected!.SessionInstanceId
        };

        var first = client.PostAsJsonAsync("/api/voice/disconnect", request);
        var second = client.PostAsJsonAsync("/api/voice/disconnect", request);
        await Task.WhenAll(first, second);

        Assert.Equal(HttpStatusCode.NoContent, first.Result.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, second.Result.StatusCode);
    }

    [Fact]
    public async Task Connect_ShouldReturnConflict_WhenVoiceSessionIsActiveInAnotherTab_WithoutTakeover()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(adminClient, "tabblockeduser");

        var client = _factory.CreateClient();
        var token = await LoginAsync(client, "tabblockeduser", "tabblockeduser12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var voiceChannelId = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;

        var firstConnect = await client.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest
            {
                ChannelId = voiceChannelId,
                TabInstanceId = "tab-a",
                AllowTakeover = false
            });
        firstConnect.EnsureSuccessStatusCode();

        var secondConnect = await client.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest
            {
                ChannelId = voiceChannelId,
                TabInstanceId = "tab-b",
                AllowTakeover = false
            });
        Assert.Equal(HttpStatusCode.Conflict, secondConnect.StatusCode);
        var body = await secondConnect.Content.ReadAsStringAsync();
        Assert.Contains("VOICE_SESSION_ACTIVE_IN_ANOTHER_TAB", body, StringComparison.OrdinalIgnoreCase);

        var reloaded = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(reloaded);
        Assert.Equal(voiceChannelId, reloaded!.ConnectedVoiceChannelId);
        Assert.Equal("tab-a", reloaded.ConnectedVoiceTabInstanceId);
    }

    [Fact]
    public async Task Connect_ShouldTakeOverSession_WhenAllowTakeoverIsTrue_AndOldSessionGetsReplaced()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(adminClient, "tabtakeoveruser");

        var client = _factory.CreateClient();
        var token = await LoginAsync(client, "tabtakeoveruser", "tabtakeoveruser12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var voiceChannelId = workspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;

        var firstConnectResponse = await client.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest
            {
                ChannelId = voiceChannelId,
                TabInstanceId = "tab-a",
                AllowTakeover = false
            });
        firstConnectResponse.EnsureSuccessStatusCode();
        var firstConnectPayload = await firstConnectResponse.Content.ReadFromJsonAsync<VoiceConnectResponse>(JsonOptions);
        Assert.NotNull(firstConnectPayload);

        var secondConnectResponse = await client.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest
            {
                ChannelId = voiceChannelId,
                TabInstanceId = "tab-b",
                AllowTakeover = true
            });
        secondConnectResponse.EnsureSuccessStatusCode();
        var secondConnectPayload = await secondConnectResponse.Content.ReadFromJsonAsync<VoiceConnectResponse>(JsonOptions);
        Assert.NotNull(secondConnectPayload);
        Assert.NotEqual(firstConnectPayload!.SessionInstanceId, secondConnectPayload!.SessionInstanceId);

        var oldHeartbeat = await client.PostAsJsonAsync(
            "/api/voice/heartbeat",
            new VoiceHeartbeatRequest
            {
                ChannelId = voiceChannelId,
                SessionInstanceId = firstConnectPayload.SessionInstanceId
            });
        Assert.Equal(HttpStatusCode.Conflict, oldHeartbeat.StatusCode);
        var oldHeartbeatBody = await oldHeartbeat.Content.ReadAsStringAsync();
        Assert.Contains("VOICE_SESSION_REPLACED", oldHeartbeatBody, StringComparison.OrdinalIgnoreCase);

        var reloaded = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(reloaded);
        Assert.Equal(voiceChannelId, reloaded!.ConnectedVoiceChannelId);
        Assert.Equal("tab-b", reloaded.ConnectedVoiceTabInstanceId);
    }

    [Fact]
    public async Task ServerModeration_ShouldPersistAcrossReconnect_AndBlockSelfClear_ForRegularUser()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(adminClient, "moderateduser");

        var userClient = _factory.CreateClient();
        var userToken = await LoginAsync(userClient, "moderateduser", "moderateduser12345");
        userClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userToken);
        var userWorkspace = await userClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(userWorkspace);
        var userId = userWorkspace!.CurrentUser.Id;
        var voiceChannelId = userWorkspace.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;

        var connectResponse = await userClient.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest { ChannelId = voiceChannelId });
        connectResponse.EnsureSuccessStatusCode();
        var connectPayload = await connectResponse.Content.ReadFromJsonAsync<VoiceConnectResponse>(JsonOptions);
        Assert.NotNull(connectPayload);

        var deafenResponse = await adminClient.PostAsJsonAsync(
            "/api/voice/moderation/deafen",
            new VoiceDeafenRequest
            {
                ChannelId = voiceChannelId,
                TargetUserId = userId,
                IsDeafened = true
            });
        deafenResponse.EnsureSuccessStatusCode();

        var moderatedWorkspace = await userClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(moderatedWorkspace);
        var moderatedMember = moderatedWorkspace!.Members.Single(x => x.UserId == userId);
        Assert.True(moderatedMember.IsDeafened);
        Assert.True(moderatedMember.IsMuted);
        Assert.True(moderatedMember.IsServerDeafened);
        Assert.False(moderatedMember.IsServerMuted);

        var forbiddenResponse = await userClient.PostAsJsonAsync(
            "/api/voice/self-state",
            new VoiceSelfStateRequest
            {
                ChannelId = voiceChannelId,
                SessionInstanceId = connectPayload!.SessionInstanceId,
                IsMuted = false,
                IsDeafened = false
            });
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenResponse.StatusCode);
        var forbiddenBody = await forbiddenResponse.Content.ReadAsStringAsync();
        Assert.Contains("VOICE_SERVER_MODERATED", forbiddenBody, StringComparison.OrdinalIgnoreCase);

        var disconnectResponse = await userClient.PostAsJsonAsync(
            "/api/voice/disconnect",
            new VoiceDisconnectRequest
            {
                ChannelId = voiceChannelId,
                SessionInstanceId = connectPayload.SessionInstanceId
            });
        disconnectResponse.EnsureSuccessStatusCode();

        var reconnectResponse = await userClient.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest { ChannelId = voiceChannelId });
        reconnectResponse.EnsureSuccessStatusCode();

        var reloadedWorkspace = await userClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(reloadedWorkspace);
        var reloadedMember = reloadedWorkspace!.Members.Single(x => x.UserId == userId);
        Assert.True(reloadedMember.IsServerDeafened);
        Assert.True(reloadedMember.IsDeafened);
        Assert.True(reloadedMember.IsMuted);
    }

    [Fact]
    public async Task AdminSelfState_ShouldAllowClearingOwnServerModeration()
    {
        var client = _factory.CreateClient();
        var adminToken = await LoginAsync(client, "admin", "admin12345");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var workspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(workspace);
        var adminId = workspace!.CurrentUser.Id;
        var voiceChannelId = workspace.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;

        var connectResponse = await client.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest { ChannelId = voiceChannelId });
        connectResponse.EnsureSuccessStatusCode();
        var connectPayload = await connectResponse.Content.ReadFromJsonAsync<VoiceConnectResponse>(JsonOptions);
        Assert.NotNull(connectPayload);

        var muteResponse = await client.PostAsJsonAsync(
            "/api/voice/moderation/mute",
            new VoiceModerationRequest
            {
                ChannelId = voiceChannelId,
                TargetUserId = adminId,
                IsMuted = true
            });
        muteResponse.EnsureSuccessStatusCode();

        var mutedWorkspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(mutedWorkspace);
        var mutedMember = mutedWorkspace!.Members.Single(x => x.UserId == adminId);
        Assert.True(mutedMember.IsServerMuted);
        Assert.True(mutedMember.IsMuted);

        var selfStateResponse = await client.PostAsJsonAsync(
            "/api/voice/self-state",
            new VoiceSelfStateRequest
            {
                ChannelId = voiceChannelId,
                SessionInstanceId = connectPayload!.SessionInstanceId,
                IsMuted = false,
                IsDeafened = false
            });
        selfStateResponse.EnsureSuccessStatusCode();

        var reloadedWorkspace = await client.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(reloadedWorkspace);
        var reloadedMember = reloadedWorkspace!.Members.Single(x => x.UserId == adminId);
        Assert.False(reloadedMember.IsServerMuted);
        Assert.False(reloadedMember.IsServerDeafened);
        Assert.False(reloadedMember.IsMuted);
        Assert.False(reloadedMember.IsDeafened);
    }

    [Fact]
    public async Task VoiceChannelPresenceChanged_ShouldBeDelivered_OnModerationWithoutChannelTransition_WithoutWorkspaceBroadcast()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(adminClient, "moderatedalice");
        await RegisterAndApproveAsync(adminClient, "moderatedbob");

        var aliceClient = _factory.CreateClient();
        var aliceToken = await LoginAsync(aliceClient, "moderatedalice", "moderatedalice12345");
        aliceClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", aliceToken);
        var aliceWorkspace = await aliceClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(aliceWorkspace);
        var workspaceId = aliceWorkspace!.Workspace.Id;
        var voiceChannelId = aliceWorkspace.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;
        var aliceUserId = aliceWorkspace.CurrentUser.Id;

        var connectResponse = await aliceClient.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest { ChannelId = voiceChannelId });
        connectResponse.EnsureSuccessStatusCode();

        var bobClient = _factory.CreateClient();
        var bobToken = await LoginAsync(bobClient, "moderatedbob", "moderatedbob12345");
        bobClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bobToken);
        var bobWorkspace = await bobClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(bobWorkspace);
        var workspaceEventChannel = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var voiceChannelEventChannel = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var hubConnection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(bobToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        hubConnection.On<VoicePresenceChangedEventDto>(
            "voicePresenceChanged",
            payload => workspaceEventChannel.Writer.TryWrite(payload));
        hubConnection.On<VoicePresenceChangedEventDto>(
            "voiceChannelPresenceChanged",
            payload => voiceChannelEventChannel.Writer.TryWrite(payload));

        await hubConnection.StartAsync();
        try
        {
            await hubConnection.InvokeAsync("JoinWorkspace", workspaceId);
            await hubConnection.InvokeAsync("JoinVoiceChannel", voiceChannelId);

            var muteResponse = await adminClient.PostAsJsonAsync(
                "/api/voice/moderation/mute",
                new VoiceModerationRequest
                {
                    ChannelId = voiceChannelId,
                    TargetUserId = aliceUserId,
                    IsMuted = true
                });
            muteResponse.EnsureSuccessStatusCode();

            var moderationEvent = await WaitForVoicePresenceAsync(
                voiceChannelEventChannel.Reader,
                x =>
                    x.UserId == aliceUserId &&
                    x.PreviousVoiceChannelId == voiceChannelId &&
                    x.CurrentVoiceChannelId == voiceChannelId &&
                    x.IsServerMuted);

            Assert.Equal(workspaceId, moderationEvent.WorkspaceId);
            Assert.True(moderationEvent.IsMuted);
            Assert.True(moderationEvent.IsServerMuted);

            var workspaceModerationEvent = await TryWaitForVoicePresenceAsync(
                workspaceEventChannel.Reader,
                x =>
                    x.UserId == aliceUserId &&
                    x.PreviousVoiceChannelId == voiceChannelId &&
                    x.CurrentVoiceChannelId == voiceChannelId &&
                    x.IsServerMuted,
                TimeSpan.FromMilliseconds(700));
            Assert.Null(workspaceModerationEvent);
        }
        finally
        {
            await hubConnection.StopAsync();
            await hubConnection.DisposeAsync();
        }
    }

    [Fact]
    public async Task VoiceChannelPresenceChanged_ShouldBroadcastScreenShareState_OnPermitAndRelease()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await LoginAsync(adminClient, "admin", "admin12345");
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await RegisterAndApproveAsync(adminClient, "streamalice");
        await RegisterAndApproveAsync(adminClient, "streambob");

        var aliceClient = _factory.CreateClient();
        var aliceToken = await LoginAsync(aliceClient, "streamalice", "streamalice12345");
        aliceClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", aliceToken);
        var aliceWorkspace = await aliceClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(aliceWorkspace);
        var voiceChannelId = aliceWorkspace!.Channels.First(x => x.Type == Cascad.Api.Data.Entities.ChannelType.Voice).Id;
        var aliceUserId = aliceWorkspace.CurrentUser.Id;

        var connectResponse = await aliceClient.PostAsJsonAsync(
            "/api/voice/connect",
            new VoiceConnectRequest { ChannelId = voiceChannelId });
        connectResponse.EnsureSuccessStatusCode();
        var connectPayload = await connectResponse.Content.ReadFromJsonAsync<VoiceConnectResponse>(JsonOptions);
        Assert.NotNull(connectPayload);

        var bobClient = _factory.CreateClient();
        var bobToken = await LoginAsync(bobClient, "streambob", "streambob12345");
        bobClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bobToken);
        var bobWorkspace = await bobClient.GetFromJsonAsync<WorkspaceBootstrapResponse>("/api/workspace", JsonOptions);
        Assert.NotNull(bobWorkspace);
        var eventChannel = Channel.CreateUnbounded<VoicePresenceChangedEventDto>();
        var hubConnection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(new Uri(_factory.Server.BaseAddress.ToString()), "/hubs/chat"),
                options =>
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(bobToken);
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        hubConnection.On<VoicePresenceChangedEventDto>(
            "voiceChannelPresenceChanged",
            payload => eventChannel.Writer.TryWrite(payload));

        await hubConnection.StartAsync();
        try
        {
            await hubConnection.InvokeAsync("JoinVoiceChannel", voiceChannelId);

            var permitResponse = await aliceClient.PostAsJsonAsync(
                "/api/voice/streams/permit",
                new StreamPermitRequest
                {
                    ChannelId = voiceChannelId,
                    SessionInstanceId = connectPayload!.SessionInstanceId
                });
            permitResponse.EnsureSuccessStatusCode();

            var shareStartedEvent = await WaitForVoicePresenceAsync(
                eventChannel.Reader,
                x =>
                    x.UserId == aliceUserId &&
                    x.PreviousVoiceChannelId == voiceChannelId &&
                    x.CurrentVoiceChannelId == voiceChannelId &&
                    x.IsScreenSharing);
            Assert.True(shareStartedEvent.IsScreenSharing);

            var releaseResponse = await aliceClient.PostAsJsonAsync(
                "/api/voice/streams/release",
                new StreamPermitRequest
                {
                    ChannelId = voiceChannelId,
                    SessionInstanceId = connectPayload.SessionInstanceId
                });
            releaseResponse.EnsureSuccessStatusCode();

            var shareStoppedEvent = await WaitForVoicePresenceAsync(
                eventChannel.Reader,
                x =>
                    x.UserId == aliceUserId &&
                    x.PreviousVoiceChannelId == voiceChannelId &&
                    x.CurrentVoiceChannelId == voiceChannelId &&
                    !x.IsScreenSharing);
            Assert.False(shareStoppedEvent.IsScreenSharing);
        }
        finally
        {
            await hubConnection.StopAsync();
            await hubConnection.DisposeAsync();
        }
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

    private static async Task<VoicePresenceChangedEventDto> WaitForVoicePresenceAsync(
        ChannelReader<VoicePresenceChangedEventDto> reader,
        Func<VoicePresenceChangedEventDto, bool> predicate)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await foreach (var item in reader.ReadAllAsync(timeout.Token))
        {
            if (predicate(item))
            {
                return item;
            }
        }

        throw new TimeoutException("Timed out waiting for voicePresenceChanged event.");
    }

    private static async Task<VoicePresenceChangedEventDto?> TryWaitForVoicePresenceAsync(
        ChannelReader<VoicePresenceChangedEventDto> reader,
        Func<VoicePresenceChangedEventDto, bool> predicate,
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

    private sealed record VoicePresenceChangedEventDto(
        Guid WorkspaceId,
        Guid UserId,
        string Username,
        string? AvatarUrl,
        Guid? PreviousVoiceChannelId,
        Guid? CurrentVoiceChannelId,
        bool IsScreenSharing,
        bool IsMuted,
        bool IsDeafened,
        bool IsServerMuted,
        bool IsServerDeafened,
        DateTime OccurredAtUtc);
}
