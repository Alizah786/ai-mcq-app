/*
  Migration: Add quiz limit + billing columns to dbo.Manager
  Date: 2026-02-15

  Adds:
    - QuizLimit INT NOT NULL DEFAULT(40)
    - IsPaid BIT NOT NULL DEFAULT(0)
    - PlanCode NVARCHAR(30) NULL
    - StripeCustomerId NVARCHAR(100) NULL

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Manager', 'QuizLimit') IS NULL
  BEGIN
    ALTER TABLE dbo.Manager
    ADD QuizLimit INT NOT NULL
      CONSTRAINT DF_Manager_QuizLimit DEFAULT (40);
  END

  IF COL_LENGTH('dbo.Manager', 'IsPaid') IS NULL
  BEGIN
    ALTER TABLE dbo.Manager
    ADD IsPaid BIT NOT NULL
      CONSTRAINT DF_Manager_IsPaid DEFAULT (0);
  END

  IF COL_LENGTH('dbo.Manager', 'PlanCode') IS NULL
  BEGIN
    ALTER TABLE dbo.Manager
    ADD PlanCode NVARCHAR(30) NULL;
  END

  IF COL_LENGTH('dbo.Manager', 'StripeCustomerId') IS NULL
  BEGIN
    ALTER TABLE dbo.Manager
    ADD StripeCustomerId NVARCHAR(100) NULL;
  END

  COMMIT;
  PRINT 'SUCCESS: Manager quiz/billing columns ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();
  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO

