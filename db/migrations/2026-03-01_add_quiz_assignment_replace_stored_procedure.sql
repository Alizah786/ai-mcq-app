IF OBJECT_ID('dbo.usp_QuizAssignment_ReplaceAssignments', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_QuizAssignment_ReplaceAssignments;
GO

CREATE PROCEDURE dbo.usp_QuizAssignment_ReplaceAssignments
  @QuizId INT,
  @ManagerId INT,
  @ClassName NVARCHAR(200),
  @Subject NVARCHAR(200) = NULL,
  @GradeLevel NVARCHAR(100) = NULL,
  @StudentIdsJson NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @StudentIds TABLE (
    StudentId INT PRIMARY KEY
  );

  INSERT INTO @StudentIds (StudentId)
  SELECT DISTINCT TRY_CAST([value] AS INT)
  FROM OPENJSON(@StudentIdsJson)
  WHERE TRY_CAST([value] AS INT) IS NOT NULL
    AND TRY_CAST([value] AS INT) > 0;

  DECLARE @createdClasses INT = 0;

  BEGIN TRAN;

  DELETE FROM dbo.QuizAssignment
  WHERE TeacherId = @ManagerId
    AND QuizId = @QuizId;

  DECLARE @MissingStudents TABLE (
    StudentId INT PRIMARY KEY
  );

  INSERT INTO @MissingStudents (StudentId)
  SELECT sid.StudentId
  FROM @StudentIds sid
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.Class c
    WHERE c.StudentId = sid.StudentId
      AND c.ClassName = @ClassName
  );

  DECLARE @studentId INT;
  DECLARE @joinCode NVARCHAR(8);

  WHILE EXISTS (SELECT 1 FROM @MissingStudents)
  BEGIN
    SELECT TOP 1 @studentId = StudentId
    FROM @MissingStudents
    ORDER BY StudentId;

    SET @joinCode = LEFT(REPLACE(UPPER(CONVERT(NVARCHAR(36), NEWID())), '-', ''), 8);
    WHILE EXISTS (SELECT 1 FROM dbo.Class WHERE JoinCode = @joinCode)
    BEGIN
      SET @joinCode = LEFT(REPLACE(UPPER(CONVERT(NVARCHAR(36), NEWID())), '-', ''), 8);
    END

    INSERT INTO dbo.Class (TeacherId, StudentId, ClassName, Subject, GradeLevel, JoinCode)
    VALUES (@ManagerId, @studentId, @ClassName, @Subject, @GradeLevel, @joinCode);

    SET @createdClasses = @createdClasses + 1;

    DELETE FROM @MissingStudents WHERE StudentId = @studentId;
  END

  INSERT INTO dbo.QuizAssignment (TeacherId, QuizId, StudentId)
  SELECT @ManagerId, @QuizId, sid.StudentId
  FROM @StudentIds sid;

  COMMIT;

  SELECT @createdClasses AS CreatedClasses;
END
GO
