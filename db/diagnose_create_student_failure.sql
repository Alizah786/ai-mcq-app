/*
Diagnostic script: find why create-student insert is failing.

How to use:
1) Set the variables in the INPUT section.
2) Run in SSMS against your app database.
3) Share the output blocks, especially:
   - "DUPLICATE CHECKS"
   - "STUDENT REQUIRED COLUMNS WITHOUT DEFAULT"
   - "DRY RUN INSERT RESULT"
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* =========================
   INPUT
   ========================= */
DECLARE @TeacherId INT = 23; -- set teacher id from logged-in account
DECLARE @UserName NVARCHAR(256) = N'1001'; -- same value you entered in UserName
DECLARE @StudentCode NVARCHAR(120) = N'1001'; -- same value you entered in Student code
DECLARE @PasswordHash NVARCHAR(255) = N'$2b$10$0v6xQ5qL9p4m7TQ0xq2Gse8rM2uL8QCCW2yN9G4n2x0Qf7P4aVf2K'; -- test bcrypt hash

PRINT '=== INPUT ===';
SELECT @TeacherId AS TeacherId, @UserName AS UserNameInput, @StudentCode AS StudentCodeInput;

/* =========================
   BASIC OBJECT CHECKS
   ========================= */
PRINT '=== OBJECT CHECKS ===';
SELECT
  OBJECT_ID('dbo.Student', 'U') AS StudentTableId,
  OBJECT_ID('dbo.Teacher', 'U') AS TeacherTableId,
  OBJECT_ID('dbo.UserNameRegistry', 'U') AS UserNameRegistryTableId,
  OBJECT_ID('dbo.Principal', 'U') AS PrincipalTableId;

/* =========================
   TEACHER ROW CHECK
   ========================= */
PRINT '=== TEACHER ROW CHECK ===';
IF OBJECT_ID('dbo.Teacher', 'U') IS NOT NULL
BEGIN
  DECLARE @TeacherSql NVARCHAR(MAX) = N'
    SELECT TOP 1 *
    FROM dbo.Teacher
    WHERE ' + CASE
      WHEN COL_LENGTH('dbo.Teacher', 'TeacherId') IS NOT NULL THEN N'TeacherId = @tid'
      WHEN COL_LENGTH('dbo.Teacher', 'ManagerId') IS NOT NULL THEN N'ManagerId = @tid'
      ELSE N'1 = 0'
    END + N';';

  EXEC sp_executesql @TeacherSql, N'@tid INT', @tid=@TeacherId;
END
ELSE
BEGIN
  PRINT 'dbo.Teacher missing.';
END

/* =========================
   DUPLICATE CHECKS
   ========================= */
PRINT '=== DUPLICATE CHECKS ===';

IF OBJECT_ID('dbo.UserNameRegistry', 'U') IS NOT NULL
BEGIN
  SELECT TOP 20 'UserNameRegistry' AS SourceTable, *
  FROM dbo.UserNameRegistry
  WHERE LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@UserName)));
END

IF OBJECT_ID('dbo.Student', 'U') IS NOT NULL AND COL_LENGTH('dbo.Student', 'Email') IS NOT NULL
BEGIN
  SELECT TOP 20 'Student' AS SourceTable, *
  FROM dbo.Student
  WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@UserName)));
END

IF OBJECT_ID('dbo.Teacher', 'U') IS NOT NULL AND COL_LENGTH('dbo.Teacher', 'Email') IS NOT NULL
BEGIN
  SELECT TOP 20 'Teacher' AS SourceTable, *
  FROM dbo.Teacher
  WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@UserName)));
END

IF OBJECT_ID('dbo.Principal', 'U') IS NOT NULL AND COL_LENGTH('dbo.Principal', 'Email') IS NOT NULL
BEGIN
  SELECT TOP 20 'Principal' AS SourceTable, *
  FROM dbo.Principal
  WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@UserName)));
END

IF OBJECT_ID('dbo.AppAdmin', 'U') IS NOT NULL AND COL_LENGTH('dbo.AppAdmin', 'UserName') IS NOT NULL
BEGIN
  SELECT TOP 20 'AppAdmin' AS SourceTable, *
  FROM dbo.AppAdmin
  WHERE LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@UserName)));
END

/* =========================
   STUDENT SHAPE + REQUIRED COLUMNS
   ========================= */
PRINT '=== STUDENT COLUMN SHAPE ===';
SELECT
  c.column_id,
  c.name AS ColumnName,
  t.name AS TypeName,
  c.max_length,
  c.precision,
  c.scale,
  c.is_nullable,
  c.is_identity,
  dc.definition AS DefaultDefinition
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
WHERE c.object_id = OBJECT_ID('dbo.Student')
ORDER BY c.column_id;

PRINT '=== STUDENT REQUIRED COLUMNS WITHOUT DEFAULT ===';
SELECT
  c.name AS RequiredColumnWithoutDefault
FROM sys.columns c
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
WHERE c.object_id = OBJECT_ID('dbo.Student')
  AND c.is_identity = 0
  AND c.is_nullable = 0
  AND dc.object_id IS NULL
  AND c.name NOT IN ('Email','FullName','PasswordHash','IsActive','TeacherId','ManagerId','PrincipalId','QuizLimit');

/* =========================
   UNIQUE INDEXES / CONSTRAINTS
   ========================= */
PRINT '=== UNIQUE INDEXES ON STUDENT / USERNAMEREGISTRY ===';
SELECT
  OBJECT_NAME(i.object_id) AS TableName,
  i.name AS IndexName,
  i.is_unique,
  i.filter_definition
FROM sys.indexes i
WHERE i.object_id IN (OBJECT_ID('dbo.Student'), OBJECT_ID('dbo.UserNameRegistry'))
  AND i.is_unique = 1
ORDER BY TableName, IndexName;

/* =========================
   TRIGGERS
   ========================= */
PRINT '=== TRIGGERS ON STUDENT / TEACHER / PRINCIPAL ===';
SELECT
  OBJECT_NAME(t.parent_id) AS TableName,
  t.name AS TriggerName,
  t.is_disabled,
  m.definition AS TriggerDefinition
FROM sys.triggers t
LEFT JOIN sys.sql_modules m ON t.object_id = m.object_id
WHERE t.parent_id IN (OBJECT_ID('dbo.Student'), OBJECT_ID('dbo.Teacher'), OBJECT_ID('dbo.Principal'))
ORDER BY TableName, TriggerName;

/* =========================
   DRY RUN INSERT RESULT (ROLLBACK)
   ========================= */
PRINT '=== DRY RUN INSERT RESULT ===';
BEGIN TRY
  BEGIN TRAN;

  DECLARE @HasTeacherId BIT = CASE WHEN COL_LENGTH('dbo.Student','TeacherId') IS NULL THEN 0 ELSE 1 END;
  DECLARE @HasManagerId BIT = CASE WHEN COL_LENGTH('dbo.Student','ManagerId') IS NULL THEN 0 ELSE 1 END;
  DECLARE @HasPrincipalId BIT = CASE WHEN COL_LENGTH('dbo.Student','PrincipalId') IS NULL THEN 0 ELSE 1 END;
  DECLARE @HasQuizLimit BIT = CASE WHEN COL_LENGTH('dbo.Student','QuizLimit') IS NULL THEN 0 ELSE 1 END;

  DECLARE @PrincipalId INT = NULL;
  IF @HasPrincipalId = 1 AND OBJECT_ID('dbo.Teacher', 'U') IS NOT NULL
  BEGIN
    DECLARE @PrincipalLookupSql NVARCHAR(MAX) = N'
      SELECT TOP 1 @pid = PrincipalId
      FROM dbo.Teacher
      WHERE ' + CASE
        WHEN COL_LENGTH('dbo.Teacher', 'TeacherId') IS NOT NULL THEN N'TeacherId = @tid'
        WHEN COL_LENGTH('dbo.Teacher', 'ManagerId') IS NOT NULL THEN N'ManagerId = @tid'
        ELSE N'1 = 0'
      END + N';';
    EXEC sp_executesql @PrincipalLookupSql, N'@tid INT, @pid INT OUTPUT', @tid=@TeacherId, @pid=@PrincipalId OUTPUT;
  END

  DECLARE @Cols NVARCHAR(MAX) = N'Email, FullName, PasswordHash, IsActive';
  DECLARE @Vals NVARCHAR(MAX) = N'@Email, @FullName, @PasswordHash, 1';

  IF @HasPrincipalId = 1
  BEGIN
    SET @Cols = N'PrincipalId, ' + @Cols;
    SET @Vals = N'@PrincipalId, ' + @Vals;
  END

  IF @HasTeacherId = 1
  BEGIN
    SET @Cols = N'TeacherId, ' + @Cols;
    SET @Vals = N'@TeacherId, ' + @Vals;
  END
  ELSE IF @HasManagerId = 1
  BEGIN
    SET @Cols = N'ManagerId, ' + @Cols;
    SET @Vals = N'@TeacherId, ' + @Vals;
  END

  IF @HasQuizLimit = 1
  BEGIN
    SET @Cols = @Cols + N', QuizLimit';
    SET @Vals = @Vals + N', 40';
  END

  DECLARE @InsertSql NVARCHAR(MAX) = N'
    INSERT INTO dbo.Student (' + @Cols + N')
    OUTPUT INSERTED.StudentId, INSERTED.Email, INSERTED.FullName
    VALUES (' + @Vals + N');';

  PRINT 'Insert SQL (shape): ' + @InsertSql;

  EXEC sp_executesql
    @InsertSql,
    N'@TeacherId INT, @PrincipalId INT, @Email NVARCHAR(256), @FullName NVARCHAR(120), @PasswordHash NVARCHAR(255)',
    @TeacherId=@TeacherId,
    @PrincipalId=@PrincipalId,
    @Email=@UserName,
    @FullName=@StudentCode,
    @PasswordHash=@PasswordHash;

  PRINT 'Dry-run insert succeeded. Rolling back by design.';
  ROLLBACK;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  SELECT
    ERROR_NUMBER() AS ErrorNumber,
    ERROR_SEVERITY() AS ErrorSeverity,
    ERROR_STATE() AS ErrorState,
    ERROR_LINE() AS ErrorLine,
    ERROR_PROCEDURE() AS ErrorProcedure,
    ERROR_MESSAGE() AS ErrorMessage;
END CATCH;

PRINT '=== END OF DIAGNOSTIC ===';

