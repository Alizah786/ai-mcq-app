IF OBJECT_ID('dbo.usp_QuizAssignment_ListStudents', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_QuizAssignment_ListStudents;
GO

CREATE PROCEDURE dbo.usp_QuizAssignment_ListStudents
  @QuizId INT,
  @ManagerId INT,
  @ClassName NVARCHAR(200) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH QuizScope AS (
    SELECT TOP 1
      q.QuizId,
      q.Title,
      c.ClassName AS QuizClassName
    FROM dbo.Quiz q
    JOIN dbo.Class c
      ON c.ClassId = q.ClassId
    JOIN dbo.Student ownerStudent
      ON ownerStudent.StudentId = c.StudentId
    WHERE q.QuizId = @QuizId
      AND ownerStudent.TeacherId = @ManagerId
  ),
  ClassOptions AS (
    SELECT DISTINCT
      c.ClassName
    FROM dbo.Class c
    JOIN dbo.Student s
      ON s.StudentId = c.StudentId
    WHERE s.TeacherId = @ManagerId
      AND ISNULL(c.ClassName, '') <> ''
  )
  SELECT
    qs.QuizId,
    qs.Title AS QuizTitle,
    qs.QuizClassName,
    co.ClassName AS ClassOption,
    st.StudentId,
    st.FullName,
    st.Email,
    st.IsActive,
    CASE WHEN qa.StudentId IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS Assigned
  FROM QuizScope qs
  LEFT JOIN ClassOptions co
    ON 1 = 1
  LEFT JOIN dbo.Student st
    ON st.TeacherId = @ManagerId
   AND (
        @ClassName IS NULL OR @ClassName = ''
        OR EXISTS (
          SELECT 1
          FROM dbo.Class c2
          WHERE c2.StudentId = st.StudentId
            AND c2.ClassName = @ClassName
        )
      )
  LEFT JOIN dbo.QuizAssignment qa
    ON qa.TeacherId = @ManagerId
   AND qa.QuizId = qs.QuizId
   AND qa.StudentId = st.StudentId
  ORDER BY
    co.ClassName,
    st.FullName,
    st.StudentId;
END
GO
