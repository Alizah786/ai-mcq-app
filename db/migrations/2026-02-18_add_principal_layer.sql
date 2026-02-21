/*
  Migration: Add Principal layer above Teacher
  Date: 2026-02-18

  Purpose:
    - Add dbo.Principal table
    - Add PrincipalId to dbo.Teacher and dbo.Student
    - Backfill principal links for existing rows
    - Add foreign keys and indexes

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.Principal', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.Principal (
      PrincipalId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Principal PRIMARY KEY,
      Email NVARCHAR(255) NOT NULL,
      FullName NVARCHAR(120) NOT NULL,
      PasswordHash NVARCHAR(255) NULL,
      IsActive BIT NOT NULL CONSTRAINT DF_Principal_IsActive DEFAULT (1),
      CreateDate DATETIME2(0) NOT NULL CONSTRAINT DF_Principal_CreateDate DEFAULT (SYSUTCDATETIME()),
      LastModifiedDate DATETIME2(0) NOT NULL CONSTRAINT DF_Principal_LastModifiedDate DEFAULT (SYSUTCDATETIME())
    );
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Principal')
      AND name = 'UX_Principal_Email'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_Principal_Email ON dbo.Principal(Email);
  END

  IF COL_LENGTH('dbo.Teacher', 'PrincipalId') IS NULL
  BEGIN
    ALTER TABLE dbo.Teacher ADD PrincipalId INT NULL;
  END

  IF COL_LENGTH('dbo.Student', 'PrincipalId') IS NULL
  BEGIN
    ALTER TABLE dbo.Student ADD PrincipalId INT NULL;
  END

  EXEC sp_executesql N'
    ;WITH TeacherNeedsPrincipal AS (
      SELECT t.TeacherId, t.Email, t.FullName
      FROM dbo.Teacher t
      WHERE t.PrincipalId IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM dbo.Principal p WHERE p.Email = t.Email
        )
    )
    INSERT INTO dbo.Principal (Email, FullName, IsActive)
    SELECT Email, FullName, 1
    FROM TeacherNeedsPrincipal;

    UPDATE t
    SET t.PrincipalId = p.PrincipalId
    FROM dbo.Teacher t
    JOIN dbo.Principal p ON p.Email = t.Email
    WHERE t.PrincipalId IS NULL;

    ;WITH StudentNeedsPrincipal AS (
      SELECT s.StudentId, s.Email, s.FullName
      FROM dbo.Student s
      WHERE s.PrincipalId IS NULL
        AND s.TeacherId IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM dbo.Principal p WHERE p.Email = s.Email
        )
    )
    INSERT INTO dbo.Principal (Email, FullName, IsActive)
    SELECT Email, FullName, 1
    FROM StudentNeedsPrincipal;

    UPDATE s
    SET s.PrincipalId = t.PrincipalId
    FROM dbo.Student s
    JOIN dbo.Teacher t ON t.TeacherId = s.TeacherId
    WHERE s.PrincipalId IS NULL
      AND t.PrincipalId IS NOT NULL;

    UPDATE s
    SET s.PrincipalId = p.PrincipalId
    FROM dbo.Student s
    JOIN dbo.Principal p ON p.Email = s.Email
    WHERE s.PrincipalId IS NULL;
  ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_Teacher_Principal'
      AND parent_object_id = OBJECT_ID('dbo.Teacher')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.Teacher
      ADD CONSTRAINT FK_Teacher_Principal
        FOREIGN KEY (PrincipalId) REFERENCES dbo.Principal(PrincipalId);
    ';
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_Student_Principal'
      AND parent_object_id = OBJECT_ID('dbo.Student')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.Student
      ADD CONSTRAINT FK_Student_Principal
        FOREIGN KEY (PrincipalId) REFERENCES dbo.Principal(PrincipalId);
    ';
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Teacher')
      AND name = 'IX_Teacher_PrincipalId'
  )
  BEGIN
    EXEC sp_executesql N'CREATE INDEX IX_Teacher_PrincipalId ON dbo.Teacher(PrincipalId);';
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Student')
      AND name = 'IX_Student_PrincipalId'
  )
  BEGIN
    EXEC sp_executesql N'CREATE INDEX IX_Student_PrincipalId ON dbo.Student(PrincipalId);';
  END

  COMMIT;
  PRINT 'SUCCESS: Principal layer ensured and linked.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
