/*
  Migration: Add MaxMcqsPerQuiz to dbo.SubscriptionPlan
  Date: 2026-02-23

  Purpose:
    - Add per-plan cap for maximum MCQs in a single quiz.
    - Default to 10 for existing and new rows.
    - Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.SubscriptionPlan', 'MaxMcqsPerQuiz') IS NULL
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
      ADD MaxMcqsPerQuiz INT NOT NULL
        CONSTRAINT DF_SubscriptionPlan_MaxMcqsPerQuiz DEFAULT (10);
  END

  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.SubscriptionPlan')
      AND name = 'MaxMcqsPerQuiz'
      AND is_nullable = 1
  )
  BEGIN
    EXEC sp_executesql N'
      UPDATE dbo.SubscriptionPlan
      SET MaxMcqsPerQuiz = ISNULL(MaxMcqsPerQuiz, 10)
      WHERE MaxMcqsPerQuiz IS NULL;
    ';

    EXEC sp_executesql N'
      ALTER TABLE dbo.SubscriptionPlan
      ALTER COLUMN MaxMcqsPerQuiz INT NOT NULL;
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_SubscriptionPlan_MaxMcqsPerQuiz'
      AND parent_object_id = OBJECT_ID('dbo.SubscriptionPlan')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.SubscriptionPlan
        ADD CONSTRAINT CK_SubscriptionPlan_MaxMcqsPerQuiz
        CHECK (MaxMcqsPerQuiz >= 1 AND MaxMcqsPerQuiz <= 500);
    ';
  END

  COMMIT;
  PRINT 'SUCCESS: MaxMcqsPerQuiz ensured on dbo.SubscriptionPlan.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
