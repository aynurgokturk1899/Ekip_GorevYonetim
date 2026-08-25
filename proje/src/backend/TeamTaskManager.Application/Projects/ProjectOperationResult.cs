namespace TeamTaskManager.Application.Projects;

public sealed record ProjectOperationResult<T>(T? Data, IReadOnlyCollection<string> Errors)
{
    public bool Succeeded => Errors.Count == 0;

    public static ProjectOperationResult<T> Success(T data) => new(data, []);

    public static ProjectOperationResult<T> Failure(params string[] errors) => new(default, errors);
}
