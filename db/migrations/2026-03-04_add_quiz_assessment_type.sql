/*
  Migration: Add quiz assessment type
  Date: 2026-03-04

  Adds:
    - Quiz.AssessmentType (QUIZ | ASSIGNMENT)
*/

USE AiMcqApp;

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Quiz', 'AssessmentType') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD AssessmentType NVARCHAR(20) NOT NULL CONSTRAINT DF_Quiz_AssessmentType DEFAULT ('QUIZ');
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Quiz_AssessmentType_Allowed'
      AND parent_object_id = OBJECT_ID('dbo.Quiz')
  )
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.Quiz
      ADD CONSTRAINT CK_Quiz_AssessmentType_Allowed
      CHECK (AssessmentType IN (''QUIZ'', ''ASSIGNMENT''));
    ';
  END

  COMMIT;
  PRINT 'SUCCESS: Quiz assessment type ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
