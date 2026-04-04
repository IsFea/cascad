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

    private sealed record VoicePresenceChangedEventDto(
        Guid WorkspaceId,
        Guid UserId,
        string Username,
        string? AvatarUrl,
        Guid? PreviousVoiceChannelId,
        Guid? CurrentVoiceChannelId,
        bool IsMuted,
        bool IsDeafened,
        DateTime OccurredAtUtc);
}
