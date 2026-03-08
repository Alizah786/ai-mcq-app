/*
  Migration: Add FlashcardOtherGenerateLimit to dbo.SubscriptionPlan
  Date: 2026-03-01

  Adds:
    - FlashcardOtherGenerateLimit INT NOT NULL DEFAULT 0
    - check constraint range 0..1000

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.SubscriptionPlan', 'FlashcardOtherGenerateLimit') IS NULL
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
      ADD FlashcardOtherGenerateLimit INT NULL;
  END;

  UPDATE dbo.SubscriptionPlan
  SET FlashcardOtherGenerateLimit = ISNULL(FlashcardOtherGenerateLimit, 0)
  WHERE FlashcardOtherGenerateLimit IS NULL;

  IF OBJECT_ID('DF_SubscriptionPlan_FlashcardOtherGenerateLimit', 'D') IS NULL
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
      ADD CONSTRAINT DF_SubscriptionPlan_FlashcardOtherGenerateLimit
      DEFAULT (0) FOR FlashcardOtherGenerateLimit;
  END;

  IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.SubscriptionPlan')
      AND name = 'FlashcardOtherGenerateLimit'
      AND is_nullable = 1
  )
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
      ALTER COLUMN FlashcardOtherGenerateLimit INT NOT NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_SubscriptionPlan_FlashcardOtherGenerateLimit'
      AND parent_object_id = OBJECT_ID('dbo.SubscriptionPlan')
  )
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
      ADD CONSTRAINT CK_SubscriptionPlan_FlashcardOtherGenerateLimit
      CHECK (FlashcardOtherGenerateLimit >= 0 AND FlashcardOtherGenerateLimit <= 1000);
  END;

  COMMIT;
  PRINT 'SUCCESS: FlashcardOtherGenerateLimit ensured on dbo.SubscriptionPlan.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

