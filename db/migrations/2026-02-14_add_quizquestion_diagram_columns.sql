/*
  Migration: Add diagram support columns to dbo.QuizQuestion
  Date: 2026-02-14

  Adds:
    - DiagramType NVARCHAR(20) NOT NULL DEFAULT('none')
    - DiagramData NVARCHAR(MAX) NULL
    - CHECK constraint for DiagramType values

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.QuizQuestion', 'DiagramType') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
    ADD DiagramType NVARCHAR(20) NOT NULL
      CONSTRAINT DF_QuizQuestion_DiagramType DEFAULT ('none');
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'DiagramData') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizQuestion
    ADD DiagramData NVARCHAR(MAX) NULL;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_QuizQuestion_DiagramType'
      AND parent_object_id = OBJECT_ID('dbo.QuizQuestion')
  )
  BEGIN
    ALTER TABLE dbo.QuizQuestion
    ADD CONSTRAINT CK_QuizQuestion_DiagramType
      CHECK (DiagramType IN ('none', 'svg', 'mermaid'));
  END

  COMMIT;
  PRINT 'SUCCESS: Diagram columns ensured on dbo.QuizQuestion.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();
  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO

