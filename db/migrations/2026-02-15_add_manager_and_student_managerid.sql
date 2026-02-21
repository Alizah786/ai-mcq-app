/*
  Migration: Add manager hierarchy support
  Date: 2026-02-15

  Adds:
    - dbo.Manager table
    - dbo.Student.ManagerId nullable FK -> dbo.Manager.ManagerId
    - index on dbo.Student(ManagerId)

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.Manager', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.Manager (
      ManagerId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Manager PRIMARY KEY,
      Email NVARCHAR(256) NOT NULL,
      FullName NVARCHAR(120) NOT NULL,
      PasswordHash NVARCHAR(255) NOT NULL,
      IsActive BIT NOT NULL CONSTRAINT DF_Manager_IsActive DEFAULT (1),
      CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Manager_CreatedAt DEFAULT (SYSUTCDATETIME())
    );

    CREATE UNIQUE INDEX UX_Manager_Email ON dbo.Manager(Email);
  END

  IF COL_LENGTH('dbo.Student', 'ManagerId') IS NULL
  BEGIN
    ALTER TABLE dbo.Student
    ADD ManagerId INT NULL;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Student_Manager'
      AND parent_object_id = OBJECT_ID('dbo.Student')
  )
  BEGIN
    ALTER TABLE dbo.Student
    ADD CONSTRAINT FK_Student_Manager
      FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_Student_ManagerId'
      AND object_id = OBJECT_ID('dbo.Student')
  )
  BEGIN
    CREATE INDEX IX_Student_ManagerId ON dbo.Student(ManagerId);
  END

  COMMIT;
  PRINT 'SUCCESS: Manager table and Student.ManagerId ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();
  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO

