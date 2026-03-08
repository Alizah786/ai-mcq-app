/*
  Migration: Add TRUE_FALSE support for dbo.QuizQuestion.QuestionType
  Date: 2026-02-26

  Purpose:
    - Ensure QuestionType check constraint allows: MCQ, SHORT_TEXT, TRUE_FALSE, NUMERIC

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.QuizQuestion', 'U') IS NULL
  BEGIN
    THROW 50000, 'Table dbo.QuizQuestion does not exist.', 1;
  END

  IF COL_LENGTH('dbo.QuizQuestion', 'QuestionType') IS NULL
  BEGIN
    THROW 50001, 'Column dbo.QuizQuestion.QuestionType does not exist.', 1;
  END

  DECLARE @constraintName SYSNAME = NULL;
  DECLARE @definition NVARCHAR(MAX) = NULL;

  SELECT TOP (1)
    @constraintName = cc.name,
    @definition = cc.definition
  FROM sys.check_constraints cc
  WHERE cc.parent_object_id = OBJECT_ID('dbo.QuizQuestion')
    AND cc.definition LIKE '%QuestionType%';

  IF @constraintName IS NOT NULL
     AND (
       @definition NOT LIKE '%TRUE_FALSE%'
       OR @definition NOT LIKE '%MCQ%'
       OR @definition NOT LIKE '%SHORT_TEXT%'
       OR @definition NOT LIKE '%NUMERIC%'
     )
  BEGIN
    EXEC('ALTER TABLE dbo.QuizQuestion DROP CONSTRAINT ' + QUOTENAME(@constraintName) + ';');
    SET @constraintName = NULL;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.QuizQuestion')
      AND definition LIKE '%QuestionType%'
      AND definition LIKE '%TRUE_FALSE%'
      AND definition LIKE '%MCQ%'
      AND definition LIKE '%SHORT_TEXT%'
      AND definition LIKE '%NUMERIC%'
  )
  BEGIN
    ALTER TABLE dbo.QuizQuestion
    ADD CONSTRAINT CK_QuizQuestion_QuestionType_Allowed
      CHECK (QuestionType IN ('MCQ', 'SHORT_TEXT', 'TRUE_FALSE', 'NUMERIC'));
  END

  COMMIT;
  PRINT 'SUCCESS: TRUE_FALSE question type support ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

