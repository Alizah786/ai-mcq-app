/*
  Migration: Add hide-for-student flag on quiz questions
  Date: 2026-02-16

  Adds:
    - dbo.QuizQuestion.IsHiddenForStudent BIT NOT NULL DEFAULT(0)

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.QuizQuestion', 'IsHiddenForStudent') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
    ADD IsHiddenForStudent BIT NOT NULL
      CONSTRAINT DF_QuizQuestion_IsHiddenForStudent DEFAULT (0);
  END

  COMMIT;
  PRINT 'SUCCESS: IsHiddenForStudent ensured on dbo.QuizQuestion.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

