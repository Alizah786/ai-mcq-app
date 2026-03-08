/*
  Migration: Add short-question support (text + numeric) alongside MCQ
  Date: 2026-02-24

  Adds to dbo.QuizQuestion:
    - QuestionType NVARCHAR(20) NOT NULL DEFAULT('MCQ')
    - ExpectedAnswerText NVARCHAR(500) NULL
    - AnswerMatchMode NVARCHAR(20) NULL
    - ExpectedAnswerNumber DECIMAL(18,6) NULL
    - NumericTolerance DECIMAL(18,6) NULL

  Adds to dbo.QuizAttemptAnswer:
    - TextAnswer NVARCHAR(1000) NULL
    - NumberAnswer DECIMAL(18,6) NULL
    - IsAutoEvaluated BIT NOT NULL DEFAULT(0)
    - AwardedMarks DECIMAL(8,2) NULL

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.QuizQuestion', 'QuestionType') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD QuestionType NVARCHAR(20) NOT NULL
      CONSTRAINT DF_QuizQuestion_QuestionType DEFAULT ('MCQ');
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'ExpectedAnswerText') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD ExpectedAnswerText NVARCHAR(500) NULL;
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'AnswerMatchMode') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD AnswerMatchMode NVARCHAR(20) NULL;
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'ExpectedAnswerNumber') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD ExpectedAnswerNumber DECIMAL(18,6) NULL;
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'NumericTolerance') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD NumericTolerance DECIMAL(18,6) NULL;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_QuizQuestion_QuestionType'
      AND parent_object_id = OBJECT_ID('dbo.QuizQuestion')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.QuizQuestion
        ADD CONSTRAINT CK_QuizQuestion_QuestionType
        CHECK (QuestionType IN (''MCQ'', ''SHORT_TEXT'', ''NUMERIC''));
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_QuizQuestion_AnswerMatchMode'
      AND parent_object_id = OBJECT_ID('dbo.QuizQuestion')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.QuizQuestion
        ADD CONSTRAINT CK_QuizQuestion_AnswerMatchMode
        CHECK (
          AnswerMatchMode IS NULL
          OR AnswerMatchMode IN (''EXACT'', ''CONTAINS'', ''KEYWORDS'')
        );
    ';
  END

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'TextAnswer') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizAttemptAnswer
      ADD TextAnswer NVARCHAR(1000) NULL;
  END

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'NumberAnswer') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizAttemptAnswer
      ADD NumberAnswer DECIMAL(18,6) NULL;
  END

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'IsAutoEvaluated') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizAttemptAnswer
      ADD IsAutoEvaluated BIT NOT NULL
      CONSTRAINT DF_QuizAttemptAnswer_IsAutoEvaluated DEFAULT (0);
  END

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'AwardedMarks') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizAttemptAnswer
      ADD AwardedMarks DECIMAL(8,2) NULL;
  END

  COMMIT;
  PRINT 'SUCCESS: short-question support columns ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
