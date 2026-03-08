/*
  Migration: Add document upload quota fields
  Date: 2026-02-26

  Purpose:
    - Add per-plan document upload limit
    - Add per-user document upload usage counter
    - Seed conservative defaults by plan family

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.SubscriptionPlan', 'U') IS NULL
    THROW 50000, 'Table dbo.SubscriptionPlan does not exist.', 1;

  IF OBJECT_ID('dbo.UserSubscription', 'U') IS NULL
    THROW 50001, 'Table dbo.UserSubscription does not exist.', 1;

  IF COL_LENGTH('dbo.SubscriptionPlan', 'DocumentUploadLimit') IS NULL
    ALTER TABLE dbo.SubscriptionPlan ADD DocumentUploadLimit INT NULL;

  IF COL_LENGTH('dbo.UserSubscription', 'DocumentUploadUsed') IS NULL
    ALTER TABLE dbo.UserSubscription ADD DocumentUploadUsed INT NOT NULL CONSTRAINT DF_UserSubscription_DocumentUploadUsed DEFAULT (0);

  EXEC sp_executesql N'
    UPDATE dbo.SubscriptionPlan
    SET DocumentUploadLimit = CASE
        WHEN LOWER(ISNULL(PlanName, '''')) LIKE ''%pro%'' THEN 1200
        WHEN LOWER(ISNULL(PlanName, '''')) LIKE ''%basic%'' OR LOWER(ISNULL(PlanName, '''')) LIKE ''%paid%'' THEN 300
        WHEN LOWER(ISNULL(PlanName, '''')) LIKE ''%trial%'' OR LOWER(ISNULL(PlanName, '''')) LIKE ''%free%'' THEN 20
        ELSE ISNULL(DocumentUploadLimit, 20)
      END
    WHERE DocumentUploadLimit IS NULL OR DocumentUploadLimit <= 0;
  ';

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.UserSubscription')
      AND name = 'IX_UserSubscription_DocumentQuota'
  )
  BEGIN
    CREATE INDEX IX_UserSubscription_DocumentQuota
      ON dbo.UserSubscription(UserRole, UserId, IsActive, ExpiryDate DESC)
      INCLUDE (DocumentUploadUsed, PlanId);
  END

  COMMIT;
  PRINT 'SUCCESS: Document upload quota fields ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
