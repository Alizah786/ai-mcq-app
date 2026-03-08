/*
  Migration: Create dbo.Payments for Stripe-backed billing history
  Date: 2026-02-22

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.Payments', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.Payments (
      PaymentId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Payments PRIMARY KEY,
      UserNameRegistryId INT NOT NULL,
      PlanCode NVARCHAR(50) NOT NULL,
      UserType NVARCHAR(20) NOT NULL,
      StripeCustomerId NVARCHAR(50) NULL,
      StripeSubscriptionId NVARCHAR(50) NULL,
      StripeInvoiceId NVARCHAR(50) NULL,
      StripeEventId NVARCHAR(100) NULL,
      Amount DECIMAL(10,2) NULL,
      Currency NVARCHAR(10) NOT NULL CONSTRAINT DF_Payments_Currency DEFAULT ('CAD'),
      BillingCycle NVARCHAR(20) NOT NULL CONSTRAINT DF_Payments_BillingCycle DEFAULT ('MONTHLY'),
      PlanStartUtc DATETIME2 NULL,
      PlanEndUtc DATETIME2 NULL,
      PaymentStatus NVARCHAR(30) NOT NULL,
      IsActive BIT NOT NULL CONSTRAINT DF_Payments_IsActive DEFAULT (1),
      CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_Payments_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
      LastModifiedUtc DATETIME2 NULL
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Payments_UserNameRegistry'
      AND parent_object_id = OBJECT_ID('dbo.Payments')
  )
  BEGIN
    ALTER TABLE dbo.Payments
      ADD CONSTRAINT FK_Payments_UserNameRegistry
      FOREIGN KEY (UserNameRegistryId) REFERENCES dbo.UserNameRegistry(UserNameRegistryId);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Payments')
      AND name = 'IX_Payments_UserNameRegistryId'
  )
  BEGIN
    CREATE INDEX IX_Payments_UserNameRegistryId
      ON dbo.Payments(UserNameRegistryId, IsActive, CreatedAtUtc DESC);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Payments')
      AND name = 'IX_Payments_SubscriptionId'
  )
  BEGIN
    CREATE INDEX IX_Payments_SubscriptionId
      ON dbo.Payments(StripeSubscriptionId);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Payments')
      AND name = 'UX_Payments_StripeEventId'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_Payments_StripeEventId
      ON dbo.Payments(StripeEventId)
      WHERE StripeEventId IS NOT NULL;
  END;

  COMMIT;
  PRINT 'SUCCESS: dbo.Payments created/ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

