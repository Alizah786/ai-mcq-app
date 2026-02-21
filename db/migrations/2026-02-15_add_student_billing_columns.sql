/*
  Migration: Add billing tracking columns to dbo.Student
  Date: 2026-02-15

  Adds:
    - IsPaid BIT NOT NULL DEFAULT(0)
    - PlanCode NVARCHAR(30) NULL
    - StripeCustomerId NVARCHAR(100) NULL

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Student', 'IsPaid') IS NULL
  BEGIN
    ALTER TABLE dbo.Student
    ADD IsPaid BIT NOT NULL
      CONSTRAINT DF_Student_IsPaid DEFAULT (0);
  END

  IF COL_LENGTH('dbo.Student', 'PlanCode') IS NULL
  BEGIN
    ALTER TABLE dbo.Student
    ADD PlanCode NVARCHAR(30) NULL;
  END

  IF COL_LENGTH('dbo.Student', 'StripeCustomerId') IS NULL
  BEGIN
    ALTER TABLE dbo.Student
    ADD StripeCustomerId NVARCHAR(100) NULL;
  END

  COMMIT;
  PRINT 'SUCCESS: Student billing columns ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();
  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO

