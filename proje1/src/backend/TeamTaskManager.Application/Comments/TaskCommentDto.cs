namespace TeamTaskManager.Application.Comments;

public sealed record TaskCommentDto(int Id, int TaskItemId, string UserId, string Content, DateTime CreatedDate, DateTime? UpdatedDate);
