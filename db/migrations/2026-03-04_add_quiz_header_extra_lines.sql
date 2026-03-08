/*
  Migration: Add quiz header extra lines JSON storage
  Date: 2026-03-04

  Adds:
    - Quiz.HeaderExtraLinesJson
*/

USE AiMcqApp;

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Quiz', 'HeaderExtraLinesJson') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD HeaderExtraLinesJson NVARCHAR(MAX) NULL;
  END

  COMMIT;
  PRINT 'SUCCESS: Quiz header extra lines column ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
