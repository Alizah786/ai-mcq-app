/*
  Migration: Add centralized exception log table
  Date: 2026-02-26

  Purpose:
    - Persist backend exceptions/failures for diagnostics and auditing
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.ExceptionLog', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ExceptionLog (
      ExceptionLogId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ExceptionLog PRIMARY KEY,
      CorrelationId NVARCHAR(64) NULL,
      Source NVARCHAR(120) NOT NULL,
      Route NVARCHAR(260) NULL,
      Method NVARCHAR(10) NULL,
      UserId INT NULL,
      UserRole NVARCHAR(40) NULL,
      Stage NVARCHAR(120) NULL,
      ErrorCode NVARCHAR(80) NULL,
      ErrorMessage NVARCHAR(2000) NOT NULL,
      StackTrace NVARCHAR(MAX) NULL,
      MetaJson NVARCHAR(MAX) NULL,
      CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_ExceptionLog_CreatedAtUtc DEFAULT (SYSUTCDATETIME())
    );
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.ExceptionLog')
      AND name = 'IX_ExceptionLog_CreatedAtUtc'
  )
  BEGIN
    CREATE INDEX IX_ExceptionLog_CreatedAtUtc ON dbo.ExceptionLog(CreatedAtUtc DESC);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.ExceptionLog')
      AND name = 'IX_ExceptionLog_CorrelationId'
  )
  BEGIN
    CREATE INDEX IX_ExceptionLog_CorrelationId ON dbo.ExceptionLog(CorrelationId);
  END

  COMMIT;
  PRINT 'SUCCESS: ExceptionLog table ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

