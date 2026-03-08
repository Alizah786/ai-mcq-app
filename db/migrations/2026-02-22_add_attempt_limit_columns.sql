/*
  Migration: Add attempt limit support for quizzes
  Date: 2026-02-22

  Adds:
    - dbo.Quiz.AttemptLimit (INT, NOT NULL, default 1, range 1..5)
    - dbo.AIGenerationJob.AttemptLimit (INT, NOT NULL, default 1, range 1..5)

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Quiz', 'AttemptLimit') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz
    ADD AttemptLimit INT NULL;
  END

  EXEC sp_executesql N'
    UPDATE dbo.Quiz
    SET AttemptLimit = 1
    WHERE AttemptLimit IS NULL
       OR AttemptLimit < 1
       OR AttemptLimit > 5;
  ';

  IF NOT EXISTS (
    SELECT 1
    FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.Quiz')
      AND name = 'DF_Quiz_AttemptLimit'
  )
  BEGIN
    ALTER TABLE dbo.Quiz
      ADD CONSTRAINT DF_Quiz_AttemptLimit DEFAULT (1) FOR AttemptLimit;
  END

  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Quiz')
      AND name = 'AttemptLimit'
      AND is_nullable = 1
  )
  BEGIN
    EXEC sp_executesql N'ALTER TABLE dbo.Quiz ALTER COLUMN AttemptLimit INT NOT NULL;';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.Quiz')
      AND name = 'CK_Quiz_AttemptLimit'
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.Quiz
      ADD CONSTRAINT CK_Quiz_AttemptLimit CHECK (AttemptLimit BETWEEN 1 AND 5);
    ';
  END

  IF OBJECT_ID('dbo.AIGenerationJob', 'U') IS NOT NULL
  BEGIN
    IF COL_LENGTH('dbo.AIGenerationJob', 'AttemptLimit') IS NULL
    BEGIN
      ALTER TABLE dbo.AIGenerationJob
      ADD AttemptLimit INT NULL;
    END

    EXEC sp_executesql N'
      UPDATE dbo.AIGenerationJob
      SET AttemptLimit = 1
      WHERE AttemptLimit IS NULL
         OR AttemptLimit < 1
         OR AttemptLimit > 5;
    ';

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints
      WHERE parent_object_id = OBJECT_ID('dbo.AIGenerationJob')
        AND name = 'DF_AIGenerationJob_AttemptLimit'
    )
    BEGIN
      ALTER TABLE dbo.AIGenerationJob
        ADD CONSTRAINT DF_AIGenerationJob_AttemptLimit DEFAULT (1) FOR AttemptLimit;
    END

    IF EXISTS (
      SELECT 1
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.AIGenerationJob')
        AND name = 'AttemptLimit'
        AND is_nullable = 1
    )
    BEGIN
      EXEC sp_executesql N'ALTER TABLE dbo.AIGenerationJob ALTER COLUMN AttemptLimit INT NOT NULL;';
    END

    IF NOT EXISTS (
      SELECT 1
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('dbo.AIGenerationJob')
        AND name = 'CK_AIGenerationJob_AttemptLimit'
    )
    BEGIN
      EXEC sp_executesql N'
        ALTER TABLE dbo.AIGenerationJob
        ADD CONSTRAINT CK_AIGenerationJob_AttemptLimit CHECK (AttemptLimit BETWEEN 1 AND 5);
      ';
    END
  END

  COMMIT;
  PRINT 'SUCCESS: AttemptLimit columns ensured on Quiz and AIGenerationJob.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
