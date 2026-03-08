/*
  Migration: Add Teacher.ShortName for compact export/profile display
  Date: 2026-03-04
*/

USE AiMcqApp;

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Teacher', 'ShortName') IS NULL
  BEGIN
    ALTER TABLE dbo.Teacher ADD ShortName NVARCHAR(120) NULL;
  END

  COMMIT;
  PRINT 'SUCCESS: Teacher.ShortName ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
