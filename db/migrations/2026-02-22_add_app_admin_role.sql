/*
  Migration: Add AppAdmin role table and seed account
  Date: 2026-02-22

  Adds:
    - dbo.AppAdmin
    - Seed account:
        UserName: AppAdmin
        Password: Appadmin786

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.AppAdmin', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.AppAdmin (
      AppAdminId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppAdmin PRIMARY KEY,
      UserName NVARCHAR(120) NOT NULL,
      PasswordHash NVARCHAR(255) NOT NULL,
      IsActive BIT NOT NULL CONSTRAINT DF_AppAdmin_IsActive DEFAULT (1),
      CreateDate DATETIME2(0) NOT NULL CONSTRAINT DF_AppAdmin_CreateDate DEFAULT (SYSUTCDATETIME()),
      LastModifiedDate DATETIME2(0) NOT NULL CONSTRAINT DF_AppAdmin_LastModifiedDate DEFAULT (SYSUTCDATETIME())
    );
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.AppAdmin')
      AND name = 'UX_AppAdmin_UserName'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_AppAdmin_UserName ON dbo.AppAdmin(UserName);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM dbo.AppAdmin
    WHERE UserName = N'AppAdmin'
  )
  BEGIN
    INSERT INTO dbo.AppAdmin (UserName, PasswordHash, IsActive)
    VALUES (N'AppAdmin', N'$2b$10$f96ZB81AYHraGiutUVXdPOoLStWN3WOW/g//Dv3mp4PFXufRyxYOi', 1);
  END
  ELSE
  BEGIN
    UPDATE dbo.AppAdmin
    SET PasswordHash = N'$2b$10$f96ZB81AYHraGiutUVXdPOoLStWN3WOW/g//Dv3mp4PFXufRyxYOi',
        IsActive = 1,
        LastModifiedDate = SYSUTCDATETIME()
    WHERE UserName = N'AppAdmin';
  END

  COMMIT;
  PRINT 'SUCCESS: AppAdmin role ensured and default account seeded.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

