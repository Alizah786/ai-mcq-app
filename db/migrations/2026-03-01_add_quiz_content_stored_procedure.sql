IF OBJECT_ID('dbo.usp_Quiz_LoadContent', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_Quiz_LoadContent;
GO

CREATE PROCEDURE dbo.usp_Quiz_LoadContent
  @QuizId INT
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    q.QuizId,
    q.ClassId,
    q.Title,
    q.Topic,
    q.Difficulty,
    q.SourceType,
    q.Status,
    q.ParentQuizId,
    q.IsTeacherEdited,
    q.RequiresTeacherReview,
    q.TeacherReviewed,
    q.TeacherReviewedAtUtc,
    ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes,
    qq.QuestionId,
    qq.QuestionText,
    qq.Explanation,
    qq.DiagramType,
    qq.DiagramData,
    qq.IsHiddenForStudent,
    qq.DisplayOrder AS QuestionDisplayOrder,
    ISNULL(qq.Points, 1) AS Points,
    qq.QuestionType,
    qq.ExpectedAnswerText,
    qq.AnswerMatchMode,
    qq.ExpectedAnswerNumber,
    qq.NumericTolerance,
    qc.ChoiceId,
    qc.ChoiceText,
    qc.IsCorrect,
    qc.DisplayOrder AS ChoiceDisplayOrder
  FROM dbo.Quiz q
  LEFT JOIN dbo.QuizQuestion qq
    ON qq.QuizId = q.QuizId
  LEFT JOIN dbo.QuizChoice qc
    ON qc.QuestionId = qq.QuestionId
  WHERE q.QuizId = @QuizId
  ORDER BY
    ISNULL(qq.DisplayOrder, 2147483647),
    ISNULL(qq.QuestionId, 2147483647),
    ISNULL(qc.DisplayOrder, 2147483647),
    ISNULL(qc.ChoiceId, 2147483647);
END
GO
