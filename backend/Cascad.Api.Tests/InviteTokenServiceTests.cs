using Cascad.Api.Services;

namespace Cascad.Api.Tests;

public sealed class InviteTokenServiceTests
{
    [Fact]
    public void CreateRawToken_ShouldGenerateDifferentValues()
    {
        var service = new InviteTokenService();

        var token1 = service.CreateRawToken();
        var token2 = service.CreateRawToken();

        Assert.NotEqual(token1, token2);
        Assert.NotEmpty(token1);
    }

    [Fact]
    public void ComputeHash_ShouldBeStable()
    {
        var service = new InviteTokenService();
        const string token = "abc123";

        var hash1 = service.ComputeHash(token);
        var hash2 = service.ComputeHash(token);

        Assert.Equal(hash1, hash2);
        Assert.NotEqual(hash1, service.ComputeHash("other"));
    }
}
