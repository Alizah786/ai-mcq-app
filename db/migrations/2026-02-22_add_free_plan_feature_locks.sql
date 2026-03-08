/*
  Migration: Add free-plan feature lock flags on SubscriptionPlan
  Date: 2026-02-22

  Adds:
    - LockHintForFreePlan BIT NOT NULL DEFAULT(0)
    - LockPdfForFreePlan BIT NOT NULL DEFAULT(0)

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.SubscriptionPlan', 'LockHintForFreePlan') IS NULL
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
      ADD LockHintForFreePlan BIT NOT NULL
        CONSTRAINT DF_SubscriptionPlan_LockHintForFreePlan DEFAULT (0);
  END;

  IF COL_LENGTH('dbo.SubscriptionPlan', 'LockPdfForFreePlan') IS NULL
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
      ADD LockPdfForFreePlan BIT NOT NULL
        CONSTRAINT DF_SubscriptionPlan_LockPdfForFreePlan DEFAULT (0);
  END;

  COMMIT;
  PRINT 'SUCCESS: Feature lock columns ensured on dbo.SubscriptionPlan.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

