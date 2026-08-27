using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using TeamTaskManager.Application.Authentication;
using TeamTaskManager.Application.Projects;
using TeamTaskManager.Domain.Constants;
using TeamTaskManager.Domain.Entities;

namespace TeamTaskManager.Infrastructure.Authentication;

public sealed class AuthenticationService(
    UserManager<ApplicationUser> userManager,
    IOptions<JwtOptions> jwtOptions) : IAuthenticationService
{
    private readonly JwtOptions _jwtOptions = jwtOptions.Value;

    public async Task<LoginResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var user = await userManager.FindByEmailAsync(request.Email);
        if (user is null || !user.IsActive || !await userManager.CheckPasswordAsync(user, request.Password))
        {
            return null;
        }

        var roles = await userManager.GetRolesAsync(user);
        var expiresAt = DateTime.UtcNow.AddMinutes(_jwtOptions.ExpirationMinutes);
        var authenticatedUser = ToAuthenticatedUser(user, roles);

        return new LoginResponse(CreateAccessToken(authenticatedUser, expiresAt), expiresAt, authenticatedUser);
    }

    public async Task<AuthenticatedUser?> GetUserAsync(string userId, CancellationToken cancellationToken = default)
    {
        var user = await userManager.FindByIdAsync(userId);
        if (user is null || !user.IsActive)
        {
            return null;
        }

        var roles = await userManager.GetRolesAsync(user);
        return ToAuthenticatedUser(user, roles);
    }

    public async Task<ProjectOperationResult<LoginResponse>> RegisterAsync(RegistrationRequest request, CancellationToken cancellationToken = default)
    {
        if (await userManager.FindByEmailAsync(request.Email) is not null)
        {
            return ProjectOperationResult<LoginResponse>.Failure("Bu e-posta adresiyle daha önce kullanıcı hesabı oluşturulmuş.");
        }

        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email,
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            IsActive = true,
            CreatedDate = DateTime.UtcNow
        };
        var creationResult = await userManager.CreateAsync(user, request.Password);
        if (!creationResult.Succeeded)
        {
            return ProjectOperationResult<LoginResponse>.Failure(creationResult.Errors.Select(error => error.Description).ToArray());
        }

        var roleResult = await userManager.AddToRoleAsync(user, ApplicationRoles.TeamMember);
        if (!roleResult.Succeeded)
        {
            await userManager.DeleteAsync(user);
            return ProjectOperationResult<LoginResponse>.Failure(roleResult.Errors.Select(error => error.Description).ToArray());
        }

        var roles = await userManager.GetRolesAsync(user);
        var expiresAt = DateTime.UtcNow.AddMinutes(_jwtOptions.ExpirationMinutes);
        var authenticatedUser = ToAuthenticatedUser(user, roles);
        return ProjectOperationResult<LoginResponse>.Success(new LoginResponse(CreateAccessToken(authenticatedUser, expiresAt), expiresAt, authenticatedUser));
    }

    public async Task<IReadOnlyCollection<string>> ChangePasswordAsync(
        string userId,
        ChangePasswordRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await userManager.FindByIdAsync(userId);
        if (user is null || !user.IsActive)
        {
            return ["Kullanıcı bulunamadı veya pasif durumda."];
        }

        var result = await userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        return result.Succeeded ? [] : result.Errors.Select(error => error.Description).ToArray();
    }

    private string CreateAccessToken(AuthenticatedUser user, DateTime expiresAt)
    {
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtOptions.Key));
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id),
            new(ClaimTypes.NameIdentifier, user.Id),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(ClaimTypes.Email, user.Email),
            new(JwtRegisteredClaimNames.GivenName, user.FirstName),
            new(JwtRegisteredClaimNames.FamilyName, user.LastName)
        };

        claims.AddRange(user.Roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var token = new JwtSecurityToken(
            issuer: _jwtOptions.Issuer,
            audience: _jwtOptions.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static AuthenticatedUser ToAuthenticatedUser(ApplicationUser user, IEnumerable<string> roles) =>
        new(user.Id, user.FirstName, user.LastName, user.Email ?? string.Empty, roles.ToArray(), user.IsActive);
}
