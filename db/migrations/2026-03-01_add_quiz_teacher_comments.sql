/*
  Migration: Add teacher comment field to quiz
  Date: 2026-03-01

  Adds:
    - Quiz.TeacherComments

  Notes:
    - Intended for teacher-authored quiz-level notes/comments that may be shown
      in manual review, PDF generation, or email distribution later.
*/

USE AiMcqApp;

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Quiz', 'TeacherComments') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD TeacherComments NVARCHAR(1000) NULL;
  END

  COMMIT;
  PRINT 'SUCCESS: Quiz teacher comment field ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
