/*
  Migration: Add class + quiz academic fields for assessment metadata
  Date: 2026-03-01

  Adds:
    - Class.CourseCode
    - Class.Term
    - Quiz.DeadlineUtc
    - Quiz.TotalMarks
    - Quiz.WeightPercent
    - Quiz.InstructorLabel

  Notes:
    - Class-level academic context lives on dbo.Class.
    - Assessment-specific grading/export context lives on dbo.Quiz.
    - InstructorLabel is optional and only for quiz/export override wording.
*/

USE AiMcqApp;

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Class', 'CourseCode') IS NULL
  BEGIN
    ALTER TABLE dbo.Class ADD CourseCode NVARCHAR(50) NULL;
  END

  IF COL_LENGTH('dbo.Class', 'Term') IS NULL
  BEGIN
    ALTER TABLE dbo.Class ADD Term NVARCHAR(50) NULL;
  END

  IF COL_LENGTH('dbo.Quiz', 'DeadlineUtc') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD DeadlineUtc DATETIME2(0) NULL;
  END

  IF COL_LENGTH('dbo.Quiz', 'TotalMarks') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD TotalMarks INT NULL;
  END

  IF COL_LENGTH('dbo.Quiz', 'WeightPercent') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD WeightPercent DECIMAL(5,2) NULL;
  END

  IF COL_LENGTH('dbo.Quiz', 'InstructorLabel') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD InstructorLabel NVARCHAR(120) NULL;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Quiz_TotalMarks_NonNegative'
      AND parent_object_id = OBJECT_ID('dbo.Quiz')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.Quiz
      ADD CONSTRAINT CK_Quiz_TotalMarks_NonNegative
        CHECK (TotalMarks IS NULL OR TotalMarks >= 0);
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Quiz_WeightPercent_Range'
      AND parent_object_id = OBJECT_ID('dbo.Quiz')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.Quiz
      ADD CONSTRAINT CK_Quiz_WeightPercent_Range
        CHECK (WeightPercent IS NULL OR (WeightPercent >= 0 AND WeightPercent <= 100));
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Class')
      AND name = 'IX_Class_CourseCode'
  )
  BEGIN
    CREATE INDEX IX_Class_CourseCode
      ON dbo.Class(CourseCode);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Quiz')
      AND name = 'IX_Quiz_DeadlineUtc'
  )
  BEGIN
    CREATE INDEX IX_Quiz_DeadlineUtc
      ON dbo.Quiz(DeadlineUtc);
  END

  COMMIT;
  PRINT 'SUCCESS: Class and quiz academic fields ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
