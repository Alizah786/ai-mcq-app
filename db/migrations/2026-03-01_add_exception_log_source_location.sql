SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.ExceptionLog', 'SourceFile') IS NULL
  BEGIN
    ALTER TABLE dbo.ExceptionLog ADD SourceFile NVARCHAR(400) NULL;
  END;

  IF COL_LENGTH('dbo.ExceptionLog', 'SourceLine') IS NULL
  BEGIN
    ALTER TABLE dbo.ExceptionLog ADD SourceLine INT NULL;
  END;

  IF COL_LENGTH('dbo.ExceptionLog', 'SourceColumn') IS NULL
  BEGIN
    ALTER TABLE dbo.ExceptionLog ADD SourceColumn INT NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.ExceptionLog')
      AND name = 'IX_ExceptionLog_SourceFile_CreatedAtUtc'
  )
  BEGIN
    CREATE INDEX IX_ExceptionLog_SourceFile_CreatedAtUtc
      ON dbo.ExceptionLog(SourceFile, CreatedAtUtc DESC);
  END;

  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
