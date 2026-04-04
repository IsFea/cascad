using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using Cascad.Api.Contracts.Auth;
using Cascad.Api.Contracts.Rooms;
using Cascad.Api.Data;
using Cascad.Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Cascad.Api.Tests;

public sealed class RoomsFlowIntegrationTests : IClassFixture<TestWebAppFactory>
{
    private readonly TestWebAppFactory _factory;

    public RoomsFlowIntegrationTests(TestWebAppFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GuestJoinFlow_ShouldIssueRtcToken()
    {
        var client = _factory.CreateClient();
        var authToken = await AuthenticateAsync(client, "alice");

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", authToken);

        var createRoomResponse = await client.PostAsJsonAsync(
            "/api/rooms",
            new CreateRoomRequest { Name = "Raid Room" });
        createRoomResponse.EnsureSuccessStatusCode();
        var room = await createRoomResponse.Content.ReadFromJsonAsync<RoomDto>();
        Assert.NotNull(room);

        var inviteResponse = await client.PostAsJsonAsync(
            $"/api/rooms/{room!.Id}/invites",
            new CreateInviteRequest { ExpiresInHours = 24 });
        inviteResponse.EnsureSuccessStatusCode();
        var invite = await inviteResponse.Content.ReadFromJsonAsync<CreateInviteResponse>();
        Assert.NotNull(invite);

        var joinResponse = await client.PostAsJsonAsync(
            "/api/rooms/join",
            new JoinRoomRequest { InviteToken = invite!.InviteToken });
        joinResponse.EnsureSuccessStatusCode();

        var joined = await joinResponse.Content.ReadFromJsonAsync<JoinRoomResponse>();
        Assert.NotNull(joined);
        Assert.Equal(room.Id, joined!.Room.Id);
        Assert.False(string.IsNullOrWhiteSpace(joined.AppToken));
        Assert.False(string.IsNullOrWhiteSpace(joined.RtcToken));
        Assert.False(string.IsNullOrWhiteSpace(joined.RtcUrl));

        var rtcJwt = new JwtSecurityTokenHandler().ReadJwtToken(joined.RtcToken);
        Assert.Contains(rtcJwt.Claims, x => x.Type == "name" && x.Value == joined.User.Nickname);
    }

    [Fact]
    public async Task JoinRoom_ShouldFailForExpiredInvite()
    {
        var client = _factory.CreateClient();
        var authToken = await AuthenticateAsync(client, "bob");

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", authToken);

        var createRoomResponse = await client.PostAsJsonAsync(
            "/api/rooms",
            new CreateRoomRequest { Name = "Duo Room" });
        createRoomResponse.EnsureSuccessStatusCode();
        var room = await createRoomResponse.Content.ReadFromJsonAsync<RoomDto>();
        Assert.NotNull(room);

        var inviteResponse = await client.PostAsJsonAsync(
            $"/api/rooms/{room!.Id}/invites",
            new CreateInviteRequest { ExpiresInHours = 24 });
        inviteResponse.EnsureSuccessStatusCode();
        var invite = await inviteResponse.Content.ReadFromJsonAsync<CreateInviteResponse>();
        Assert.NotNull(invite);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var inviteTokenService = scope.ServiceProvider.GetRequiredService<IInviteTokenService>();
            var tokenHash = inviteTokenService.ComputeHash(invite!.InviteToken);

            var inviteEntity = db.RoomInvites.Single(x => x.TokenHash == tokenHash);
            inviteEntity.ExpiresAtUtc = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }

        var joinResponse = await client.PostAsJsonAsync(
            "/api/rooms/join",
            new JoinRoomRequest { InviteToken = invite!.InviteToken });

        Assert.Equal(HttpStatusCode.BadRequest, joinResponse.StatusCode);
    }

    private static async Task<string> AuthenticateAsync(HttpClient client, string nickname)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/guest",
            new GuestAuthRequest { Nickname = nickname });
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<GuestAuthResponse>();
        Assert.NotNull(payload);
        return payload!.AppToken;
    }
}
