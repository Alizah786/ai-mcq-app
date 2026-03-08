/*
  Migration: Add LONG question support with async grading metadata
  Date: 2026-02-26

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.QuizQuestion', 'U') IS NULL
  BEGIN
    THROW 50000, 'Table dbo.QuizQuestion does not exist.', 1;
  END

  IF OBJECT_ID('dbo.QuizAttempt', 'U') IS NULL
  BEGIN
    THROW 50001, 'Table dbo.QuizAttempt does not exist.', 1;
  END

  IF OBJECT_ID('dbo.QuizAttemptAnswer', 'U') IS NULL
  BEGIN
    THROW 50002, 'Table dbo.QuizAttemptAnswer does not exist.', 1;
  END

  /* Ensure QuestionType check allows LONG */
  DECLARE @qtConstraint SYSNAME = NULL;
  DECLARE @qtDefinition NVARCHAR(MAX) = NULL;

  SELECT TOP (1)
    @qtConstraint = cc.name,
    @qtDefinition = cc.definition
  FROM sys.check_constraints cc
  WHERE cc.parent_object_id = OBJECT_ID('dbo.QuizQuestion')
    AND cc.definition LIKE '%QuestionType%';

  IF @qtConstraint IS NOT NULL
     AND @qtDefinition NOT LIKE '%LONG%'
  BEGIN
    DECLARE @dropQuestionTypeConstraintSql NVARCHAR(MAX);
    SET @dropQuestionTypeConstraintSql =
      N'ALTER TABLE dbo.QuizQuestion DROP CONSTRAINT ' + QUOTENAME(@qtConstraint) + N';';
    EXEC sp_executesql @dropQuestionTypeConstraintSql;
    SET @qtConstraint = NULL;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.QuizQuestion')
      AND definition LIKE '%QuestionType%'
      AND definition LIKE '%MCQ%'
      AND definition LIKE '%SHORT_TEXT%'
      AND definition LIKE '%TRUE_FALSE%'
      AND definition LIKE '%NUMERIC%'
      AND definition LIKE '%LONG%'
  )
  BEGIN
    ALTER TABLE dbo.QuizQuestion
    ADD CONSTRAINT CK_QuizQuestion_QuestionType_Allowed
      CHECK (QuestionType IN ('MCQ', 'SHORT_TEXT', 'TRUE_FALSE', 'NUMERIC', 'LONG'));
  END

  /* LONG scoring metadata on QuizAttemptAnswer */
  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'AutoScore') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD AutoScore DECIMAL(6,2) NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'AutoFeedback') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD AutoFeedback NVARCHAR(800) NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'FinalScore') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD FinalScore DECIMAL(6,2) NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'IsTeacherOverridden') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer
      ADD IsTeacherOverridden BIT NOT NULL
      CONSTRAINT DF_QuizAttemptAnswer_IsTeacherOverridden DEFAULT (0);

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'TeacherOverrideScore') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD TeacherOverrideScore DECIMAL(6,2) NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'TeacherOverrideFeedback') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD TeacherOverrideFeedback NVARCHAR(800) NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'EvaluatedAtUtc') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD EvaluatedAtUtc DATETIME2 NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'OverriddenAtUtc') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD OverriddenAtUtc DATETIME2 NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'OverriddenByTeacherId') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD OverriddenByTeacherId INT NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'TextAnswer') IS NOT NULL
     AND EXISTS (
      SELECT 1
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID('dbo.QuizAttemptAnswer')
        AND c.name = 'TextAnswer'
        AND c.max_length <> -1
     )
  BEGIN
    ALTER TABLE dbo.QuizAttemptAnswer ALTER COLUMN TextAnswer NVARCHAR(MAX) NULL;
  END

  /* Grading status on attempt */
  IF COL_LENGTH('dbo.QuizAttempt', 'GradingStatus') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizAttempt
      ADD GradingStatus NVARCHAR(20) NOT NULL
      CONSTRAINT DF_QuizAttempt_GradingStatus DEFAULT ('NotSubmitted');
  END

  /* Defensive re-check for partially applied schemas */
  IF COL_LENGTH('dbo.QuizAttempt', 'GradingStatus') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizAttempt
      ADD GradingStatus NVARCHAR(20) NULL;
    EXEC sp_executesql N'
      UPDATE dbo.QuizAttempt
      SET GradingStatus = ''NotSubmitted''
      WHERE GradingStatus IS NULL;
    ';
    ALTER TABLE dbo.QuizAttempt
      ALTER COLUMN GradingStatus NVARCHAR(20) NOT NULL;
    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID('dbo.QuizAttempt')
        AND c.name = 'GradingStatus'
    )
    BEGIN
      EXEC sp_executesql N'
        ALTER TABLE dbo.QuizAttempt
          ADD CONSTRAINT DF_QuizAttempt_GradingStatus DEFAULT (''NotSubmitted'') FOR GradingStatus;
      ';
    END
  END

  IF COL_LENGTH('dbo.QuizAttempt', 'GradedAtUtc') IS NULL
    ALTER TABLE dbo.QuizAttempt ADD GradedAtUtc DATETIME2 NULL;

  IF COL_LENGTH('dbo.QuizAttempt', 'GradingStatus') IS NOT NULL
     AND NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.QuizAttempt')
      AND name = 'CK_QuizAttempt_GradingStatus'
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.QuizAttempt
      ADD CONSTRAINT CK_QuizAttempt_GradingStatus
        CHECK (GradingStatus IN (''NotSubmitted'', ''Pending'', ''Processing'', ''Completed'', ''PartiallyFailed'', ''Failed''));
    ';
  END

  /* Long grading job queue */
  IF OBJECT_ID('dbo.LongGradingJob', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.LongGradingJob (
      LongGradingJobId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      QuizAttemptAnswerId INT NOT NULL,
      QuizAttemptId INT NOT NULL,
      QuizId INT NOT NULL,
      QuestionId INT NOT NULL,
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_LongGradingJob_Status DEFAULT ('Queued'),
      AttemptCount INT NOT NULL CONSTRAINT DF_LongGradingJob_AttemptCount DEFAULT (0),
      MaxAttempts INT NOT NULL CONSTRAINT DF_LongGradingJob_MaxAttempts DEFAULT (3),
      NextRetryAtUtc DATETIME2 NULL,
      ErrorCode NVARCHAR(80) NULL,
      LastErrorSafe NVARCHAR(300) NULL,
      ProviderRequestId NVARCHAR(120) NULL,
      LockedUntilUtc DATETIME2 NULL,
      CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_LongGradingJob_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
      UpdatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_LongGradingJob_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())
    );
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.LongGradingJob')
      AND name = 'CK_LongGradingJob_Status'
  )
  BEGIN
    ALTER TABLE dbo.LongGradingJob
      ADD CONSTRAINT CK_LongGradingJob_Status
      CHECK (Status IN ('Queued', 'Processing', 'Succeeded', 'Retrying', 'Failed'));
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.LongGradingJob')
      AND name = 'IX_LongGradingJob_Poll'
  )
  BEGIN
    CREATE INDEX IX_LongGradingJob_Poll
      ON dbo.LongGradingJob(Status, NextRetryAtUtc, LockedUntilUtc, LongGradingJobId);
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.LongGradingJob')
      AND name = 'IX_LongGradingJob_Attempt'
  )
  BEGIN
    CREATE INDEX IX_LongGradingJob_Attempt
      ON dbo.LongGradingJob(QuizAttemptId, QuizAttemptAnswerId);
  END

  COMMIT;
  PRINT 'SUCCESS: LONG question grading phase 1 migration applied.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
