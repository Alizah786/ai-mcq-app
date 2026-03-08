/*
  Migration: Add MIX_MATCH_DRAG question type support
  Date: 2026-03-03

  Adds:
    - dbo.MatchPair
    - dbo.StudentMatchAnswer
    - dbo.QuizQuestion.ShuffleLeft
    - dbo.QuizQuestion.ShuffleRight
    - dbo.QuizQuestion.AllowPartialMarks
    - QuestionType constraint update for MIX_MATCH_DRAG
*/

USE AiMcqApp;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.QuizQuestion', 'ShuffleLeft') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD ShuffleLeft BIT NOT NULL
      CONSTRAINT DF_QuizQuestion_ShuffleLeft DEFAULT (0);
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'ShuffleRight') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD ShuffleRight BIT NOT NULL
      CONSTRAINT DF_QuizQuestion_ShuffleRight DEFAULT (1);
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'AllowPartialMarks') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
      ADD AllowPartialMarks BIT NOT NULL
      CONSTRAINT DF_QuizQuestion_AllowPartialMarks DEFAULT (1);
  END

  IF OBJECT_ID('dbo.MatchPair', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.MatchPair (
      MatchPairId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      QuestionId INT NOT NULL,
      LeftText NVARCHAR(500) NOT NULL,
      RightText NVARCHAR(500) NOT NULL,
      DisplayOrder INT NOT NULL CONSTRAINT DF_MatchPair_DisplayOrder DEFAULT (0),
      IsActive BIT NOT NULL CONSTRAINT DF_MatchPair_IsActive DEFAULT (1),
      CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_MatchPair_CreatedDate DEFAULT (SYSUTCDATETIME()),
      UpdatedDate DATETIME2 NULL,
      CONSTRAINT FK_MatchPair_Question FOREIGN KEY (QuestionId) REFERENCES dbo.QuizQuestion(QuestionId) ON DELETE CASCADE
    );
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.MatchPair')
      AND name = 'IX_MatchPair_Question_DisplayOrder'
  )
  BEGIN
    CREATE INDEX IX_MatchPair_Question_DisplayOrder
      ON dbo.MatchPair(QuestionId, DisplayOrder, MatchPairId);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.MatchPair')
      AND name = 'UX_MatchPair_Question_LeftText'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_MatchPair_Question_LeftText
      ON dbo.MatchPair(QuestionId, LeftText);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.MatchPair')
      AND name = 'UX_MatchPair_Question_RightText'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_MatchPair_Question_RightText
      ON dbo.MatchPair(QuestionId, RightText);
  END

  IF OBJECT_ID('dbo.StudentMatchAnswer', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.StudentMatchAnswer (
      StudentMatchAnswerId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      AttemptId INT NOT NULL,
      QuestionId INT NOT NULL,
      LeftMatchPairId INT NOT NULL,
      SelectedRightMatchPairId INT NOT NULL,
      SelectedRightText NVARCHAR(500) NULL,
      IsCorrect BIT NOT NULL,
      CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_StudentMatchAnswer_CreatedDate DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT FK_StudentMatchAnswer_Attempt FOREIGN KEY (AttemptId) REFERENCES dbo.QuizAttempt(AttemptId) ON DELETE CASCADE,
      CONSTRAINT FK_StudentMatchAnswer_Question FOREIGN KEY (QuestionId) REFERENCES dbo.QuizQuestion(QuestionId),
      CONSTRAINT FK_StudentMatchAnswer_LeftMatchPair FOREIGN KEY (LeftMatchPairId) REFERENCES dbo.MatchPair(MatchPairId),
      CONSTRAINT FK_StudentMatchAnswer_SelectedRightMatchPair FOREIGN KEY (SelectedRightMatchPairId) REFERENCES dbo.MatchPair(MatchPairId)
    );
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.StudentMatchAnswer')
      AND name = 'IX_StudentMatchAnswer_Attempt_Question'
  )
  BEGIN
    CREATE INDEX IX_StudentMatchAnswer_Attempt_Question
      ON dbo.StudentMatchAnswer(AttemptId, QuestionId);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.StudentMatchAnswer')
      AND name = 'UX_StudentMatchAnswer_Attempt_Question_LeftMatchPair'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_StudentMatchAnswer_Attempt_Question_LeftMatchPair
      ON dbo.StudentMatchAnswer(AttemptId, QuestionId, LeftMatchPairId);
  END

  DECLARE @constraintName SYSNAME;
  SELECT TOP 1 @constraintName = cc.name
  FROM sys.check_constraints cc
  WHERE cc.parent_object_id = OBJECT_ID('dbo.QuizQuestion')
    AND cc.definition LIKE '%QuestionType%';

  IF @constraintName IS NOT NULL
  BEGIN
    DECLARE @dropConstraintSql NVARCHAR(MAX);
    SET @dropConstraintSql = N'ALTER TABLE dbo.QuizQuestion DROP CONSTRAINT ' + QUOTENAME(@constraintName) + N';';
    EXEC sp_executesql @dropConstraintSql;
  END

  ALTER TABLE dbo.QuizQuestion
    ADD CONSTRAINT CK_QuizQuestion_QuestionType_Allowed
      CHECK (QuestionType IN ('MCQ', 'SHORT_TEXT', 'TRUE_FALSE', 'NUMERIC', 'LONG', 'MIX_MATCH_DRAG'));

  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
