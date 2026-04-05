using Cascad.Api.Contracts.Uploads;
using Cascad.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Cascad.Api.Controllers;

[ApiController]
[Route("api/uploads")]
[Authorize]
public sealed class UploadsController : ControllerBase
{
    private readonly IChatMediaStorage _chatMediaStorage;

    public UploadsController(IChatMediaStorage chatMediaStorage)
    {
        _chatMediaStorage = chatMediaStorage;
    }

    [HttpPost("chat-image")]
    [ProducesResponseType<UploadImageResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<UploadImageResponse>> UploadChatImage(
        [FromForm] IFormFile file,
        CancellationToken cancellationToken)
    {
        try
        {
            var uploaded = await _chatMediaStorage.SaveChatImageAsync(file, cancellationToken);
            return Ok(uploaded);
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new ProblemDetails { Title = exception.Message });
        }
    }
}
