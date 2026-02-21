/*
  Migration: Add quiz limit to dbo.Student
  Date: 2026-02-15

  Adds:
    - QuizLimit INT NOT NULL DEFAULT(40)

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Student', 'QuizLimit') IS NULL
  BEGIN
    ALTER TABLE dbo.Student
    ADD QuizLimit INT NOT NULL
      CONSTRAINT DF_Student_QuizLimit DEFAULT (40);
  END

  COMMIT;
  PRINT 'SUCCESS: Student.QuizLimit ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();
  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO

