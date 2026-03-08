/*
  Migration: Add global username registry for uniqueness across Teacher/Student/Principal
  Date: 2026-02-22

  Purpose:
    - Create dbo.UserNameRegistry
    - Backfill from existing Teacher/Student/Principal rows
    - Enforce global uniqueness on normalized username (active rows)
    - Keep registry synced via triggers

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.UserNameRegistry', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.UserNameRegistry (
      UserNameRegistryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserNameRegistry PRIMARY KEY,
      UserName NVARCHAR(256) NOT NULL,
      NormalizedUserName AS LOWER(LTRIM(RTRIM(UserName))) PERSISTED,
      UserType NVARCHAR(20) NOT NULL,
      UserId INT NOT NULL,
      IsActive BIT NOT NULL CONSTRAINT DF_UserNameRegistry_IsActive DEFAULT (1),
      CreateDate DATETIME2(0) NOT NULL CONSTRAINT DF_UserNameRegistry_CreateDate DEFAULT (SYSUTCDATETIME()),
      LastModifiedDate DATETIME2(0) NOT NULL CONSTRAINT DF_UserNameRegistry_LastModifiedDate DEFAULT (SYSUTCDATETIME())
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_UserNameRegistry_UserType'
      AND parent_object_id = OBJECT_ID('dbo.UserNameRegistry')
  )
  BEGIN
    ALTER TABLE dbo.UserNameRegistry
    ADD CONSTRAINT CK_UserNameRegistry_UserType
      CHECK (UserType IN ('TEACHER', 'STUDENT', 'PRINCIPAL'));
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.UserNameRegistry')
      AND name = 'UX_UserNameRegistry_NormalizedUserName'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_UserNameRegistry_NormalizedUserName
      ON dbo.UserNameRegistry(NormalizedUserName)
      WHERE IsActive = 1;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.UserNameRegistry')
      AND name = 'UX_UserNameRegistry_UserType_UserId'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_UserNameRegistry_UserType_UserId
      ON dbo.UserNameRegistry(UserType, UserId);
  END;

  IF OBJECT_ID('tempdb..#UserNameConflicts') IS NOT NULL
    DROP TABLE #UserNameConflicts;

  CREATE TABLE #UserNameConflicts (
    UserName NVARCHAR(256) NOT NULL,
    UserType NVARCHAR(20) NOT NULL,
    UserId INT NOT NULL
  );

  ;WITH AllUsers AS (
    SELECT
      CAST(t.Email AS NVARCHAR(256)) AS UserName,
      CAST('TEACHER' AS NVARCHAR(20)) AS UserType,
      t.TeacherId AS UserId,
      CAST(ISNULL(t.IsActive, 1) AS BIT) AS IsActive,
      1 AS Priority
    FROM dbo.Teacher t
    WHERE NULLIF(LTRIM(RTRIM(t.Email)), '') IS NOT NULL
    UNION ALL
    SELECT
      CAST(s.Email AS NVARCHAR(256)) AS UserName,
      CAST('STUDENT' AS NVARCHAR(20)) AS UserType,
      s.StudentId AS UserId,
      CAST(ISNULL(s.IsActive, 1) AS BIT) AS IsActive,
      2 AS Priority
    FROM dbo.Student s
    WHERE NULLIF(LTRIM(RTRIM(s.Email)), '') IS NOT NULL
    UNION ALL
    SELECT
      CAST(p.Email AS NVARCHAR(256)) AS UserName,
      CAST('PRINCIPAL' AS NVARCHAR(20)) AS UserType,
      p.PrincipalId AS UserId,
      CAST(ISNULL(p.IsActive, 1) AS BIT) AS IsActive,
      3 AS Priority
    FROM dbo.Principal p
    WHERE NULLIF(LTRIM(RTRIM(p.Email)), '') IS NOT NULL
  ),
  Ranked AS (
    SELECT
      UserName,
      UserType,
      UserId,
      IsActive,
      ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(UserName))) ORDER BY Priority, UserId) AS rn
    FROM AllUsers
  )
  INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
  SELECT r.UserName, r.UserType, r.UserId, r.IsActive
  FROM Ranked r
  WHERE r.rn = 1
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.UserNameRegistry u
      WHERE u.UserType = r.UserType
        AND u.UserId = r.UserId
    );

  ;WITH AllUsers AS (
    SELECT
      CAST(t.Email AS NVARCHAR(256)) AS UserName,
      CAST('TEACHER' AS NVARCHAR(20)) AS UserType,
      t.TeacherId AS UserId,
      1 AS Priority
    FROM dbo.Teacher t
    WHERE NULLIF(LTRIM(RTRIM(t.Email)), '') IS NOT NULL
    UNION ALL
    SELECT
      CAST(s.Email AS NVARCHAR(256)) AS UserName,
      CAST('STUDENT' AS NVARCHAR(20)) AS UserType,
      s.StudentId AS UserId,
      2 AS Priority
    FROM dbo.Student s
    WHERE NULLIF(LTRIM(RTRIM(s.Email)), '') IS NOT NULL
    UNION ALL
    SELECT
      CAST(p.Email AS NVARCHAR(256)) AS UserName,
      CAST('PRINCIPAL' AS NVARCHAR(20)) AS UserType,
      p.PrincipalId AS UserId,
      3 AS Priority
    FROM dbo.Principal p
    WHERE NULLIF(LTRIM(RTRIM(p.Email)), '') IS NOT NULL
  ),
  Ranked AS (
    SELECT
      UserName,
      UserType,
      UserId,
      ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(UserName))) ORDER BY Priority, UserId) AS rn
    FROM AllUsers
  )
  INSERT INTO #UserNameConflicts (UserName, UserType, UserId)
  SELECT UserName, UserType, UserId
  FROM Ranked
  WHERE rn > 1;

  EXEC('
    CREATE OR ALTER TRIGGER dbo.tr_Teacher_UserNameRegistry_Upsert
    ON dbo.Teacher
    AFTER INSERT, UPDATE
    AS
    BEGIN
      SET NOCOUNT ON;

      DELETE u
      FROM dbo.UserNameRegistry u
      INNER JOIN inserted i ON u.UserType = ''TEACHER'' AND u.UserId = i.TeacherId;

      INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
      SELECT i.Email, ''TEACHER'', i.TeacherId, ISNULL(i.IsActive, 1)
      FROM inserted i
      WHERE NULLIF(LTRIM(RTRIM(i.Email)), '''') IS NOT NULL;
    END;
  ');

  EXEC('
    CREATE OR ALTER TRIGGER dbo.tr_Teacher_UserNameRegistry_Delete
    ON dbo.Teacher
    AFTER DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      DELETE u
      FROM dbo.UserNameRegistry u
      INNER JOIN deleted d ON u.UserType = ''TEACHER'' AND u.UserId = d.TeacherId;
    END;
  ');

  EXEC('
    CREATE OR ALTER TRIGGER dbo.tr_Student_UserNameRegistry_Upsert
    ON dbo.Student
    AFTER INSERT, UPDATE
    AS
    BEGIN
      SET NOCOUNT ON;

      DELETE u
      FROM dbo.UserNameRegistry u
      INNER JOIN inserted i ON u.UserType = ''STUDENT'' AND u.UserId = i.StudentId;

      INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
      SELECT i.Email, ''STUDENT'', i.StudentId, ISNULL(i.IsActive, 1)
      FROM inserted i
      WHERE NULLIF(LTRIM(RTRIM(i.Email)), '''') IS NOT NULL;
    END;
  ');

  EXEC('
    CREATE OR ALTER TRIGGER dbo.tr_Student_UserNameRegistry_Delete
    ON dbo.Student
    AFTER DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      DELETE u
      FROM dbo.UserNameRegistry u
      INNER JOIN deleted d ON u.UserType = ''STUDENT'' AND u.UserId = d.StudentId;
    END;
  ');

  EXEC('
    CREATE OR ALTER TRIGGER dbo.tr_Principal_UserNameRegistry_Upsert
    ON dbo.Principal
    AFTER INSERT, UPDATE
    AS
    BEGIN
      SET NOCOUNT ON;

      DELETE u
      FROM dbo.UserNameRegistry u
      INNER JOIN inserted i ON u.UserType = ''PRINCIPAL'' AND u.UserId = i.PrincipalId;

      INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
      SELECT i.Email, ''PRINCIPAL'', i.PrincipalId, ISNULL(i.IsActive, 1)
      FROM inserted i
      WHERE NULLIF(LTRIM(RTRIM(i.Email)), '''') IS NOT NULL;
    END;
  ');

  EXEC('
    CREATE OR ALTER TRIGGER dbo.tr_Principal_UserNameRegistry_Delete
    ON dbo.Principal
    AFTER DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      DELETE u
      FROM dbo.UserNameRegistry u
      INNER JOIN deleted d ON u.UserType = ''PRINCIPAL'' AND u.UserId = d.PrincipalId;
    END;
  ');

  COMMIT;
  PRINT 'SUCCESS: UserNameRegistry created, backfilled, and synced with triggers.';
  SELECT COUNT(1) AS ExistingDuplicateUserNames FROM #UserNameConflicts;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
