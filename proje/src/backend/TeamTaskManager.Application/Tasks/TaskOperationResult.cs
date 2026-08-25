namespace TeamTaskManager.Application.Tasks;

public sealed record TaskOperationResult<T>(T? Data, IReadOnlyCollection<string> Errors)
{
    public bool Succeeded => Errors.Count == 0;
    public static TaskOperationResult<T> Success(T data) => new(data, []);
    public static TaskOperationResult<T> Failure(params string[] errors) => new(default, errors);
}
