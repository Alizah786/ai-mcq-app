/*
  Migration: Make UserNameRegistry sync triggers FK-safe
  Problem:
    Existing triggers delete + insert registry rows on Teacher/Student/Principal updates.
    This breaks FK references (e.g., dbo.UsageEvent -> dbo.UserNameRegistry).
  Fix:
    - Upsert in-place (UPDATE existing row, INSERT only when missing)
    - On DELETE of source user, mark registry row inactive and move username to a tombstone value
      so original email can be reused without deleting referenced registry rows.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

EXEC('
CREATE OR ALTER TRIGGER dbo.tr_Teacher_UserNameRegistry_Upsert
ON dbo.Teacher
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @src TABLE (UserId INT NOT NULL, UserName NVARCHAR(320) NOT NULL, IsActive BIT NOT NULL);
  INSERT INTO @src (UserId, UserName, IsActive)
  SELECT
    i.TeacherId AS UserId,
    LTRIM(RTRIM(i.Email)) AS UserName,
    ISNULL(i.IsActive, 1) AS IsActive
  FROM inserted i
  WHERE NULLIF(LTRIM(RTRIM(i.Email)), '''') IS NOT NULL;

  UPDATE u
    SET u.UserName = s.UserName,
        u.IsActive = s.IsActive,
        u.LastModifiedDate = SYSUTCDATETIME()
  FROM dbo.UserNameRegistry u
  INNER JOIN @src s
    ON u.UserType = ''TEACHER''
   AND u.UserId = s.UserId;

  INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
  SELECT s.UserName, ''TEACHER'', s.UserId, s.IsActive
  FROM @src s
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.UserNameRegistry u
    WHERE u.UserType = ''TEACHER'' AND u.UserId = s.UserId
  );
END;
');

EXEC('
CREATE OR ALTER TRIGGER dbo.tr_Student_UserNameRegistry_Upsert
ON dbo.Student
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @src TABLE (UserId INT NOT NULL, UserName NVARCHAR(320) NOT NULL, IsActive BIT NOT NULL);
  INSERT INTO @src (UserId, UserName, IsActive)
  SELECT
    i.StudentId AS UserId,
    LTRIM(RTRIM(i.Email)) AS UserName,
    ISNULL(i.IsActive, 1) AS IsActive
  FROM inserted i
  WHERE NULLIF(LTRIM(RTRIM(i.Email)), '''') IS NOT NULL;

  UPDATE u
    SET u.UserName = s.UserName,
        u.IsActive = s.IsActive,
        u.LastModifiedDate = SYSUTCDATETIME()
  FROM dbo.UserNameRegistry u
  INNER JOIN @src s
    ON u.UserType = ''STUDENT''
   AND u.UserId = s.UserId;

  INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
  SELECT s.UserName, ''STUDENT'', s.UserId, s.IsActive
  FROM @src s
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.UserNameRegistry u
    WHERE u.UserType = ''STUDENT'' AND u.UserId = s.UserId
  );
END;
');

EXEC('
CREATE OR ALTER TRIGGER dbo.tr_Principal_UserNameRegistry_Upsert
ON dbo.Principal
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @src TABLE (UserId INT NOT NULL, UserName NVARCHAR(320) NOT NULL, IsActive BIT NOT NULL);
  INSERT INTO @src (UserId, UserName, IsActive)
  SELECT
    i.PrincipalId AS UserId,
    LTRIM(RTRIM(i.Email)) AS UserName,
    ISNULL(i.IsActive, 1) AS IsActive
  FROM inserted i
  WHERE NULLIF(LTRIM(RTRIM(i.Email)), '''') IS NOT NULL;

  UPDATE u
    SET u.UserName = s.UserName,
        u.IsActive = s.IsActive,
        u.LastModifiedDate = SYSUTCDATETIME()
  FROM dbo.UserNameRegistry u
  INNER JOIN @src s
    ON u.UserType = ''PRINCIPAL''
   AND u.UserId = s.UserId;

  INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
  SELECT s.UserName, ''PRINCIPAL'', s.UserId, s.IsActive
  FROM @src s
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.UserNameRegistry u
    WHERE u.UserType = ''PRINCIPAL'' AND u.UserId = s.UserId
  );
END;
');

EXEC('
CREATE OR ALTER TRIGGER dbo.tr_Teacher_UserNameRegistry_Delete
ON dbo.Teacher
AFTER DELETE
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE u
    SET u.IsActive = 0,
        u.UserName = CONCAT(''deleted.teacher.'', CAST(d.TeacherId AS NVARCHAR(20)), ''@local''),
        u.LastModifiedDate = SYSUTCDATETIME()
  FROM dbo.UserNameRegistry u
  INNER JOIN deleted d
    ON u.UserType = ''TEACHER''
   AND u.UserId = d.TeacherId;
END;
');

EXEC('
CREATE OR ALTER TRIGGER dbo.tr_Student_UserNameRegistry_Delete
ON dbo.Student
AFTER DELETE
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE u
    SET u.IsActive = 0,
        u.UserName = CONCAT(''deleted.student.'', CAST(d.StudentId AS NVARCHAR(20)), ''@local''),
        u.LastModifiedDate = SYSUTCDATETIME()
  FROM dbo.UserNameRegistry u
  INNER JOIN deleted d
    ON u.UserType = ''STUDENT''
   AND u.UserId = d.StudentId;
END;
');

EXEC('
CREATE OR ALTER TRIGGER dbo.tr_Principal_UserNameRegistry_Delete
ON dbo.Principal
AFTER DELETE
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE u
    SET u.IsActive = 0,
        u.UserName = CONCAT(''deleted.principal.'', CAST(d.PrincipalId AS NVARCHAR(20)), ''@local''),
        u.LastModifiedDate = SYSUTCDATETIME()
  FROM dbo.UserNameRegistry u
  INNER JOIN deleted d
    ON u.UserType = ''PRINCIPAL''
   AND u.UserId = d.PrincipalId;
END;
');

COMMIT TRANSACTION;
