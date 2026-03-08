CREATE OR ALTER PROCEDURE dbo.usp_Classes_ListWithQuizzes
  @Role NVARCHAR(20),
  @UserId INT,
  @RequestedStudentId INT = NULL
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH base_classes AS (
    SELECT
      c.ClassId,
      c.ClassName,
      c.Subject,
      c.GradeLevel,
      c.CourseCode,
      c.Term,
      c.JoinCode,
      c.StudentId,
      c.TeacherId,
      c.CreateDate,
      c.LastModifiedDate,
      CASE WHEN @Role = N'Manager' THEN s.FullName ELSE NULL END AS StudentCode
    FROM dbo.Class c
    INNER JOIN dbo.Student s
      ON s.StudentId = c.StudentId
    WHERE (
        @Role = N'Manager'
        AND s.TeacherId = @UserId
        AND (@RequestedStudentId IS NULL OR c.StudentId = @RequestedStudentId)
      )
      OR (
        @Role <> N'Manager'
        AND c.StudentId = @UserId
      )
  ),
  question_counts AS (
    SELECT qq.QuizId, COUNT(1) AS QuestionCount
    FROM dbo.QuizQuestion qq
    GROUP BY qq.QuizId
  ),
  direct_quizzes AS (
    SELECT
      bc.ClassId,
      q.QuizId,
      q.Title,
      q.Status,
      q.CreateDate,
      q.LastModifiedDate,
      ISNULL(q.AttemptLimit, 1) AS AttemptLimit,
      ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes,
      ISNULL(q.RequiresTeacherReview, 0) AS RequiresTeacherReview,
      ISNULL(q.TeacherReviewed, 0) AS TeacherReviewed,
      ISNULL(q.IsTeacherEdited, 0) AS IsTeacherEdited,
      CAST(0 AS BIT) AS IsAssigned,
      ISNULL(qc.QuestionCount, 0) AS QuestionCount
    FROM base_classes bc
    INNER JOIN dbo.Quiz q
      ON q.ClassId = bc.ClassId
    LEFT JOIN question_counts qc
      ON qc.QuizId = q.QuizId
    WHERE
      @Role = N'Manager'
      OR (
        q.Status = N'Ready'
        AND (ISNULL(q.RequiresTeacherReview, 0) = 0 OR ISNULL(q.TeacherReviewed, 0) = 1)
      )
  ),
  assigned_quizzes AS (
    SELECT
      bc.ClassId,
      q.QuizId,
      q.Title,
      q.Status,
      q.CreateDate,
      q.LastModifiedDate,
      ISNULL(q.AttemptLimit, 1) AS AttemptLimit,
      ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes,
      ISNULL(q.RequiresTeacherReview, 0) AS RequiresTeacherReview,
      ISNULL(q.TeacherReviewed, 0) AS TeacherReviewed,
      ISNULL(q.IsTeacherEdited, 0) AS IsTeacherEdited,
      CAST(1 AS BIT) AS IsAssigned,
      ISNULL(qc.QuestionCount, 0) AS QuestionCount
    FROM base_classes bc
    INNER JOIN dbo.QuizAssignment qa
      ON qa.StudentId = bc.StudentId
     AND qa.TeacherId = bc.TeacherId
    INNER JOIN dbo.Quiz q
      ON q.QuizId = qa.QuizId
    INNER JOIN dbo.Class sourceClass
      ON sourceClass.ClassId = q.ClassId
    LEFT JOIN question_counts qc
      ON qc.QuizId = q.QuizId
    WHERE sourceClass.ClassName = bc.ClassName
      AND q.ClassId <> bc.ClassId
      AND (
        @Role = N'Manager'
        OR (
          q.Status = N'Ready'
          AND (ISNULL(q.RequiresTeacherReview, 0) = 0 OR ISNULL(q.TeacherReviewed, 0) = 1)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.Quiz q2
        WHERE q2.ClassId = bc.ClassId
          AND q2.Title = q.Title
      )
  ),
  all_quizzes AS (
    SELECT * FROM direct_quizzes
    UNION ALL
    SELECT * FROM assigned_quizzes
  )
  SELECT
    bc.ClassId,
    bc.ClassName,
    bc.Subject,
    bc.GradeLevel,
    bc.CourseCode,
    bc.Term,
    bc.JoinCode,
    bc.StudentId,
    bc.TeacherId,
    bc.StudentCode,
    bc.CreateDate,
    bc.LastModifiedDate,
    aq.QuizId,
    aq.Title,
    aq.Status,
    aq.AttemptLimit,
    aq.TimeLimitMinutes,
    aq.QuestionCount,
    aq.CreateDate AS QuizCreateDate,
    aq.LastModifiedDate AS QuizLastModifiedDate,
    aq.IsAssigned,
    aq.RequiresTeacherReview,
    aq.TeacherReviewed,
    aq.IsTeacherEdited
  FROM base_classes bc
  LEFT JOIN all_quizzes aq
    ON aq.ClassId = bc.ClassId
  ORDER BY
    ISNULL(bc.StudentCode, N''),
    bc.ClassName,
    aq.Title,
    aq.QuizId;
END;
GO
