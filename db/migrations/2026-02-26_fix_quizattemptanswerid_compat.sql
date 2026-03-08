/*
  Migration: Compatibility alias for dbo.QuizAttemptAnswer primary key
  Date: 2026-02-26

  Purpose:
    - Ensure column dbo.QuizAttemptAnswer.QuizAttemptAnswerId exists for new LONG grading flow.
    - Keep backward compatibility with legacy key names (e.g., AttemptAnswerId, AnswerId).

  Strategy:
    - If QuizAttemptAnswerId already exists -> no-op.
    - Else detect existing PK/identity INT column and add:
        QuizAttemptAnswerId AS CAST([ExistingKeyColumn] AS INT) PERSISTED
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.QuizAttemptAnswer', 'U') IS NULL
  BEGIN
    THROW 50000, 'Table dbo.QuizAttemptAnswer does not exist.', 1;
  END

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'QuizAttemptAnswerId') IS NULL
  BEGIN
    DECLARE @baseColumn SYSNAME = NULL;

    /* Prefer PK column */
    SELECT TOP (1) @baseColumn = c.name
    FROM sys.key_constraints kc
    INNER JOIN sys.index_columns ic
      ON ic.object_id = kc.parent_object_id
     AND ic.index_id = kc.unique_index_id
    INNER JOIN sys.columns c
      ON c.object_id = ic.object_id
     AND c.column_id = ic.column_id
    INNER JOIN sys.types t
      ON t.user_type_id = c.user_type_id
    WHERE kc.parent_object_id = OBJECT_ID('dbo.QuizAttemptAnswer')
      AND kc.type = 'PK'
      AND t.name IN ('int', 'bigint', 'smallint', 'tinyint')
    ORDER BY ic.key_ordinal;

    /* Fallback: identity integer column */
    IF @baseColumn IS NULL
    BEGIN
      SELECT TOP (1) @baseColumn = c.name
      FROM sys.columns c
      INNER JOIN sys.types t
        ON t.user_type_id = c.user_type_id
      WHERE c.object_id = OBJECT_ID('dbo.QuizAttemptAnswer')
        AND c.is_identity = 1
        AND t.name IN ('int', 'bigint', 'smallint', 'tinyint')
      ORDER BY c.column_id;
    END

    /* Fallback: common naming patterns */
    IF @baseColumn IS NULL
    BEGIN
      SELECT TOP (1) @baseColumn = c.name
      FROM sys.columns c
      INNER JOIN sys.types t
        ON t.user_type_id = c.user_type_id
      WHERE c.object_id = OBJECT_ID('dbo.QuizAttemptAnswer')
        AND t.name IN ('int', 'bigint', 'smallint', 'tinyint')
        AND (
          c.name LIKE '%AnswerId%'
          OR c.name LIKE 'AttemptAnswerId'
          OR c.name LIKE 'AnswerId'
        )
      ORDER BY c.column_id;
    END

    IF @baseColumn IS NULL
    BEGIN
      THROW 50001, 'Could not determine base key column for dbo.QuizAttemptAnswer.', 1;
    END

    DECLARE @sql NVARCHAR(MAX);
    SET @sql = N'
      ALTER TABLE dbo.QuizAttemptAnswer
      ADD QuizAttemptAnswerId AS CAST(' + QUOTENAME(@baseColumn) + N' AS INT) PERSISTED;
    ';
    EXEC sp_executesql @sql;
  END

  COMMIT;
  PRINT 'SUCCESS: QuizAttemptAnswerId compatibility ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

