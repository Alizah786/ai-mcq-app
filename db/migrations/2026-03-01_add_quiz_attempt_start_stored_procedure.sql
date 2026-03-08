CREATE OR ALTER PROCEDURE dbo.usp_QuizAttempt_LoadStartData
  @QuizId INT,
  @Role NVARCHAR(20),
  @StudentId INT,
  @ManagerId INT
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH quiz_scope AS (
    SELECT
      q.QuizId,
      q.Title,
      q.Topic,
      q.ClassId,
      q.Status,
      q.CreateDate,
      q.LastModifiedDate,
      c.CourseCode,
      c.Term,
      q.DeadlineUtc,
      q.TotalMarks,
      q.WeightPercent,
      q.InstructorLabel,
      s.TeacherId,
      ISNULL(q.AttemptLimit, 1) AS AttemptLimit,
      ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes
    FROM dbo.Quiz q
    INNER JOIN dbo.Class c
      ON c.ClassId = q.ClassId
    INNER JOIN dbo.Student s
      ON s.StudentId = c.StudentId
    WHERE q.QuizId = @QuizId
      AND q.Status = N'Ready'
      AND (
        @Role = N'Manager'
        OR (ISNULL(q.RequiresTeacherReview, 0) = 0 OR ISNULL(q.TeacherReviewed, 0) = 1)
      )
      AND (
        (@Role = N'Student' AND (
          c.StudentId = @StudentId
          OR EXISTS (
            SELECT 1
            FROM dbo.QuizAssignment qa
            WHERE qa.QuizId = q.QuizId
              AND qa.StudentId = @StudentId
          )
        ))
        OR
        (@Role = N'Manager' AND s.TeacherId = @ManagerId AND (
          c.StudentId = @StudentId
          OR EXISTS (
            SELECT 1
            FROM dbo.QuizAssignment qa
            WHERE qa.QuizId = q.QuizId
              AND qa.StudentId = @StudentId
              AND qa.TeacherId = @ManagerId
          )
        ))
      )
  )
  SELECT
    qs.QuizId,
    qs.Title,
    qs.Topic,
    qs.ClassId,
    qs.Status,
    qs.CreateDate,
    qs.LastModifiedDate,
    qs.CourseCode,
    qs.Term,
    qs.DeadlineUtc,
    qs.TotalMarks,
    qs.WeightPercent,
    qs.InstructorLabel,
    qs.TeacherId,
    qs.AttemptLimit,
    qs.TimeLimitMinutes,
    qq.QuestionId,
    qq.QuestionText,
    qq.Explanation,
    qq.DiagramType,
    qq.DiagramData,
    qq.IsHiddenForStudent,
    qq.DisplayOrder,
    ISNULL(qq.Points, 1) AS Points,
    qq.QuestionType,
    qc.ChoiceId,
    qc.ChoiceText,
    qc.DisplayOrder AS ChoiceDisplayOrder
  FROM quiz_scope qs
  LEFT JOIN dbo.QuizQuestion qq
    ON qq.QuizId = qs.QuizId
   AND (@Role = N'Manager' OR ISNULL(qq.IsHiddenForStudent, 0) = 0)
  LEFT JOIN dbo.QuizChoice qc
    ON qc.QuestionId = qq.QuestionId
  ORDER BY
    CASE UPPER(ISNULL(qq.QuestionType, 'MCQ'))
      WHEN 'MCQ' THEN 0
      WHEN 'SHORT_TEXT' THEN 1
      WHEN 'TRUE_FALSE' THEN 2
      WHEN 'NUMERIC' THEN 3
      WHEN 'LONG' THEN 4
      ELSE 5
    END,
    qq.DisplayOrder,
    qq.QuestionId,
    qc.DisplayOrder,
    qc.ChoiceId;
END;
GO
