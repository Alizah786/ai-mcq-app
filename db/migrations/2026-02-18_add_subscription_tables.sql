/*
  Migration: Add subscription plans and user subscriptions
  Date: 2026-02-18

  Adds:
    - dbo.SubscriptionPlan
    - dbo.UserSubscription
    - Seed plans: Free Trial, Basic Teacher Plan, Pro Teacher Plan

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.SubscriptionPlan', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.SubscriptionPlan (
      PlanId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SubscriptionPlan PRIMARY KEY,
      PlanName NVARCHAR(150) NOT NULL,
      Price DECIMAL(10,2) NOT NULL,
      DurationDays INT NOT NULL,
      AIQuizLimit INT NOT NULL,
      ManualQuizLimit INT NOT NULL,
      IsActive BIT NOT NULL CONSTRAINT DF_SubscriptionPlan_IsActive DEFAULT (1)
    );
  END;

  IF OBJECT_ID('dbo.UserSubscription', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.UserSubscription (
      UserSubscriptionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserSubscription PRIMARY KEY,
      UserId INT NOT NULL,
      UserRole NVARCHAR(20) NOT NULL CONSTRAINT DF_UserSubscription_UserRole DEFAULT ('Student'),
      PlanId INT NOT NULL,
      StartDate DATETIME2 NOT NULL,
      ExpiryDate DATETIME2 NOT NULL,
      AIQuizUsed INT NOT NULL CONSTRAINT DF_UserSubscription_AIQuizUsed DEFAULT (0),
      ManualQuizUsed INT NOT NULL CONSTRAINT DF_UserSubscription_ManualQuizUsed DEFAULT (0),
      IsTrial BIT NOT NULL CONSTRAINT DF_UserSubscription_IsTrial DEFAULT (0),
      IsActive BIT NOT NULL CONSTRAINT DF_UserSubscription_IsActive DEFAULT (1)
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_UserSubscription_Plan'
      AND parent_object_id = OBJECT_ID('dbo.UserSubscription')
  )
  BEGIN
    ALTER TABLE dbo.UserSubscription
    ADD CONSTRAINT FK_UserSubscription_Plan
      FOREIGN KEY (PlanId) REFERENCES dbo.SubscriptionPlan(PlanId);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.UserSubscription')
      AND name = 'IX_UserSubscription_UserActive'
  )
  BEGIN
    CREATE INDEX IX_UserSubscription_UserActive
      ON dbo.UserSubscription (UserRole, UserId, IsActive, ExpiryDate DESC);
  END;

  MERGE dbo.SubscriptionPlan AS target
  USING (
    SELECT
      CAST(N'Free Trial' AS NVARCHAR(150)) AS PlanName,
      CAST(0.00 AS DECIMAL(10,2)) AS Price,
      CAST(15 AS INT) AS DurationDays,
      CAST(30 AS INT) AS AIQuizLimit,
      CAST(30 AS INT) AS ManualQuizLimit,
      CAST(1 AS BIT) AS IsActive
    UNION ALL
    SELECT
      N'Basic Teacher Plan',
      CAST(14.99 AS DECIMAL(10,2)),
      30,
      250,
      250,
      CAST(1 AS BIT)
    UNION ALL
    SELECT
      N'Pro Teacher Plan',
      CAST(24.99 AS DECIMAL(10,2)),
      30,
      500,
      500,
      CAST(1 AS BIT)
  ) AS source
  ON target.PlanName = source.PlanName
  WHEN MATCHED THEN
    UPDATE SET
      target.Price = source.Price,
      target.DurationDays = source.DurationDays,
      target.AIQuizLimit = source.AIQuizLimit,
      target.ManualQuizLimit = source.ManualQuizLimit,
      target.IsActive = source.IsActive
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive)
    VALUES (source.PlanName, source.Price, source.DurationDays, source.AIQuizLimit, source.ManualQuizLimit, source.IsActive);

  COMMIT;
  PRINT 'SUCCESS: Subscription tables and plans ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

