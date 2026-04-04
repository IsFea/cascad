using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
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
}
