/*
  Migration: Add CreateDate + LastModifiedDate to all core tables
  Date: 2026-02-16

  Adds to each table (if missing):
    - CreateDate       DATETIME2(0) NOT NULL (default SYSUTCDATETIME())
    - LastModifiedDate DATETIME2(0) NOT NULL (default SYSUTCDATETIME())

  Also creates/updates AFTER UPDATE triggers so LastModifiedDate is refreshed
  automatically on every update.

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  DECLARE @Tables TABLE (TableName SYSNAME, SeedCreatedCol SYSNAME NULL);
  INSERT INTO @Tables (TableName, SeedCreatedCol)
  VALUES
    ('Manager', 'CreatedAtUtc'),
    ('Student', 'CreatedAtUtc'),
    ('Class', 'CreatedAtUtc'),
    ('Quiz', 'CreatedAtUtc'),
    ('QuizQuestion', NULL),
    ('QuizChoice', NULL),
    ('QuizAttempt', 'StartedAtUtc'),
    ('QuizAttemptAnswer', 'AnsweredAtUtc'),
    ('DocumentUpload', 'UploadedAtUtc'),
    ('AIGenerationJob', 'CreatedAtUtc'),
    ('QuizAssignment', 'AssignedAtUtc');

  DECLARE @TableName SYSNAME;
  DECLARE @SeedCreatedCol SYSNAME;
  DECLARE @Sql NVARCHAR(MAX);
  DECLARE @PkCol SYSNAME;
  DECLARE @TriggerName SYSNAME;

  DECLARE cur CURSOR FAST_FORWARD FOR
    SELECT t.TableName, t.SeedCreatedCol
    FROM @Tables t
    WHERE OBJECT_ID('dbo.' + t.TableName, 'U') IS NOT NULL;

  OPEN cur;
  FETCH NEXT FROM cur INTO @TableName, @SeedCreatedCol;

  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF COL_LENGTH('dbo.' + @TableName, 'CreateDate') IS NULL
    BEGIN
      SET @Sql = N'ALTER TABLE dbo.' + QUOTENAME(@TableName) + N' ADD CreateDate DATETIME2(0) NULL;';
      EXEC sp_executesql @Sql;

      IF @SeedCreatedCol IS NOT NULL AND COL_LENGTH('dbo.' + @TableName, @SeedCreatedCol) IS NOT NULL
      BEGIN
        SET @Sql = N'UPDATE dbo.' + QUOTENAME(@TableName) + N'
                    SET CreateDate = COALESCE(CreateDate, ' + QUOTENAME(@SeedCreatedCol) + N', SYSUTCDATETIME())
                    WHERE CreateDate IS NULL;';
      END
      ELSE
      BEGIN
        SET @Sql = N'UPDATE dbo.' + QUOTENAME(@TableName) + N'
                    SET CreateDate = COALESCE(CreateDate, SYSUTCDATETIME())
                    WHERE CreateDate IS NULL;';
      END
      EXEC sp_executesql @Sql;

      SET @Sql = N'ALTER TABLE dbo.' + QUOTENAME(@TableName) + N' ALTER COLUMN CreateDate DATETIME2(0) NOT NULL;';
      EXEC sp_executesql @Sql;
    END

    IF COL_LENGTH('dbo.' + @TableName, 'LastModifiedDate') IS NULL
    BEGIN
      SET @Sql = N'ALTER TABLE dbo.' + QUOTENAME(@TableName) + N' ADD LastModifiedDate DATETIME2(0) NULL;';
      EXEC sp_executesql @Sql;

      SET @Sql = N'UPDATE dbo.' + QUOTENAME(@TableName) + N'
                  SET LastModifiedDate = COALESCE(LastModifiedDate, CreateDate, SYSUTCDATETIME())
                  WHERE LastModifiedDate IS NULL;';
      EXEC sp_executesql @Sql;

      SET @Sql = N'ALTER TABLE dbo.' + QUOTENAME(@TableName) + N' ALTER COLUMN LastModifiedDate DATETIME2(0) NOT NULL;';
      EXEC sp_executesql @Sql;
    END

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID('dbo.' + @TableName)
        AND c.name = 'CreateDate'
    )
    BEGIN
      SET @Sql = N'ALTER TABLE dbo.' + QUOTENAME(@TableName) + N'
                  ADD CONSTRAINT DF_' + @TableName + N'_CreateDate DEFAULT (SYSUTCDATETIME()) FOR CreateDate;';
      EXEC sp_executesql @Sql;
    END

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID('dbo.' + @TableName)
        AND c.name = 'LastModifiedDate'
    )
    BEGIN
      SET @Sql = N'ALTER TABLE dbo.' + QUOTENAME(@TableName) + N'
                  ADD CONSTRAINT DF_' + @TableName + N'_LastModifiedDate DEFAULT (SYSUTCDATETIME()) FOR LastModifiedDate;';
      EXEC sp_executesql @Sql;
    END

    SELECT TOP 1 @PkCol = c.name
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID('dbo.' + @TableName)
      AND i.is_primary_key = 1
    ORDER BY ic.key_ordinal;

    IF @PkCol IS NOT NULL
    BEGIN
      SET @TriggerName = N'tr_' + @TableName + N'_SetLastModifiedDate';
      SET @Sql = N'
CREATE OR ALTER TRIGGER dbo.' + QUOTENAME(@TriggerName) + N'
ON dbo.' + QUOTENAME(@TableName) + N'
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL() > 1 RETURN;

  UPDATE t
  SET LastModifiedDate = SYSUTCDATETIME()
  FROM dbo.' + QUOTENAME(@TableName) + N' t
  INNER JOIN inserted i ON t.' + QUOTENAME(@PkCol) + N' = i.' + QUOTENAME(@PkCol) + N';
END;';
      EXEC sp_executesql @Sql;
    END

    FETCH NEXT FROM cur INTO @TableName, @SeedCreatedCol;
  END

  CLOSE cur;
  DEALLOCATE cur;

  COMMIT;
  PRINT 'SUCCESS: CreateDate and LastModifiedDate ensured across core tables.';
END TRY
BEGIN CATCH
  IF CURSOR_STATUS('local', 'cur') >= -1
  BEGIN
    CLOSE cur;
    DEALLOCATE cur;
  END
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
