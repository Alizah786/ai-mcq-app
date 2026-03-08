/*
  Migration: Password recovery fields and log table
  Date: 2026-02-19

  Adds to dbo.Teacher and dbo.Student:
    - RecoveryEmail NVARCHAR(150) NULL
    - EmailVerified BIT NOT NULL DEFAULT 0
    - ResetTokenHash NVARCHAR(256) NULL
    - ResetTokenExpiry DATETIME2 NULL
    - MustChangePassword BIT NOT NULL DEFAULT 0

  Creates:
    - dbo.PasswordResetLog

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Teacher', 'RecoveryEmail') IS NULL
    ALTER TABLE dbo.Teacher ADD RecoveryEmail NVARCHAR(150) NULL;

  IF COL_LENGTH('dbo.Teacher', 'EmailVerified') IS NULL
    ALTER TABLE dbo.Teacher ADD EmailVerified BIT NOT NULL CONSTRAINT DF_Teacher_EmailVerified DEFAULT (0);

  IF COL_LENGTH('dbo.Teacher', 'ResetTokenHash') IS NULL
    ALTER TABLE dbo.Teacher ADD ResetTokenHash NVARCHAR(256) NULL;

  IF COL_LENGTH('dbo.Teacher', 'ResetTokenExpiry') IS NULL
    ALTER TABLE dbo.Teacher ADD ResetTokenExpiry DATETIME2 NULL;

  IF COL_LENGTH('dbo.Teacher', 'MustChangePassword') IS NULL
    ALTER TABLE dbo.Teacher ADD MustChangePassword BIT NOT NULL CONSTRAINT DF_Teacher_MustChangePassword DEFAULT (0);

  IF COL_LENGTH('dbo.Student', 'RecoveryEmail') IS NULL
    ALTER TABLE dbo.Student ADD RecoveryEmail NVARCHAR(150) NULL;

  IF COL_LENGTH('dbo.Student', 'EmailVerified') IS NULL
    ALTER TABLE dbo.Student ADD EmailVerified BIT NOT NULL CONSTRAINT DF_Student_EmailVerified DEFAULT (0);

  IF COL_LENGTH('dbo.Student', 'ResetTokenHash') IS NULL
    ALTER TABLE dbo.Student ADD ResetTokenHash NVARCHAR(256) NULL;

  IF COL_LENGTH('dbo.Student', 'ResetTokenExpiry') IS NULL
    ALTER TABLE dbo.Student ADD ResetTokenExpiry DATETIME2 NULL;

  IF COL_LENGTH('dbo.Student', 'MustChangePassword') IS NULL
    ALTER TABLE dbo.Student ADD MustChangePassword BIT NOT NULL CONSTRAINT DF_Student_MustChangePassword DEFAULT (0);

  IF OBJECT_ID('dbo.PasswordResetLog', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PasswordResetLog (
      ResetLogId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PasswordResetLog PRIMARY KEY,
      UserType NVARCHAR(20) NOT NULL,
      UserId INT NOT NULL,
      RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_PasswordResetLog_RequestedAt DEFAULT (SYSUTCDATETIME()),
      RequestedIp NVARCHAR(50) NULL,
      RequestedUserAgent NVARCHAR(256) NULL,
      CompletedAt DATETIME2 NULL,
      IsSuccess BIT NOT NULL CONSTRAINT DF_PasswordResetLog_IsSuccess DEFAULT (0),
      FailureReason NVARCHAR(200) NULL
    );
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.PasswordResetLog')
      AND name = 'IX_PasswordResetLog_UserType_UserId_RequestedAt'
  )
  BEGIN
    CREATE INDEX IX_PasswordResetLog_UserType_UserId_RequestedAt
      ON dbo.PasswordResetLog (UserType, UserId, RequestedAt DESC);
  END

  COMMIT;
  PRINT 'SUCCESS: Password recovery fields and PasswordResetLog ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

