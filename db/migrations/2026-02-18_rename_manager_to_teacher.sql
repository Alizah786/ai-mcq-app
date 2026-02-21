/*
  Migration: Rename Manager schema references to Teacher
  Date: 2026-02-18

  Purpose:
    - Rename dbo.Manager table -> dbo.Teacher
    - Rename ManagerId columns -> TeacherId across operational tables
    - Rename manager review flags on dbo.Quiz -> teacher review flags
    - Rename QuizChangeLog.ManagerId -> TeacherId

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  /* 1) Table rename */
  IF OBJECT_ID('dbo.Teacher', 'U') IS NULL AND OBJECT_ID('dbo.Manager', 'U') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.Manager', 'Teacher';
  END

  /* 2) Primary key column on dbo.Teacher */
  IF COL_LENGTH('dbo.Teacher', 'TeacherId') IS NULL
     AND COL_LENGTH('dbo.Teacher', 'ManagerId') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.Teacher.ManagerId', 'TeacherId', 'COLUMN';
  END

  /* 3) ManagerId -> TeacherId on operational tables */
  IF COL_LENGTH('dbo.Student', 'TeacherId') IS NULL AND COL_LENGTH('dbo.Student', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.Student.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.Class', 'TeacherId') IS NULL AND COL_LENGTH('dbo.Class', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.Class.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.Quiz', 'TeacherId') IS NULL AND COL_LENGTH('dbo.Quiz', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.Quiz.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.QuizQuestion', 'TeacherId') IS NULL AND COL_LENGTH('dbo.QuizQuestion', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.QuizQuestion.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.QuizChoice', 'TeacherId') IS NULL AND COL_LENGTH('dbo.QuizChoice', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.QuizChoice.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.QuizAttempt', 'TeacherId') IS NULL AND COL_LENGTH('dbo.QuizAttempt', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.QuizAttempt.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'TeacherId') IS NULL AND COL_LENGTH('dbo.QuizAttemptAnswer', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.QuizAttemptAnswer.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.DocumentUpload', 'TeacherId') IS NULL AND COL_LENGTH('dbo.DocumentUpload', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.DocumentUpload.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.AIGenerationJob', 'TeacherId') IS NULL AND COL_LENGTH('dbo.AIGenerationJob', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.AIGenerationJob.ManagerId', 'TeacherId', 'COLUMN';

  IF COL_LENGTH('dbo.QuizAssignment', 'TeacherId') IS NULL AND COL_LENGTH('dbo.QuizAssignment', 'ManagerId') IS NOT NULL
    EXEC sp_rename 'dbo.QuizAssignment.ManagerId', 'TeacherId', 'COLUMN';

  IF OBJECT_ID('dbo.QuizChangeLog', 'U') IS NOT NULL
     AND COL_LENGTH('dbo.QuizChangeLog', 'TeacherId') IS NULL
     AND COL_LENGTH('dbo.QuizChangeLog', 'ManagerId') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.QuizChangeLog.ManagerId', 'TeacherId', 'COLUMN';
  END

  /* 4) Review columns on dbo.Quiz */
  IF COL_LENGTH('dbo.Quiz', 'IsTeacherEdited') IS NULL
     AND COL_LENGTH('dbo.Quiz', 'IsManagerEdited') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.Quiz.IsManagerEdited', 'IsTeacherEdited', 'COLUMN';
  END

  IF COL_LENGTH('dbo.Quiz', 'RequiresTeacherReview') IS NULL
     AND COL_LENGTH('dbo.Quiz', 'RequiresManagerReview') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.Quiz.RequiresManagerReview', 'RequiresTeacherReview', 'COLUMN';
  END

  IF COL_LENGTH('dbo.Quiz', 'TeacherReviewed') IS NULL
     AND COL_LENGTH('dbo.Quiz', 'ManagerReviewed') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.Quiz.ManagerReviewed', 'TeacherReviewed', 'COLUMN';
  END

  IF COL_LENGTH('dbo.Quiz', 'TeacherReviewedByTeacherId') IS NULL
     AND COL_LENGTH('dbo.Quiz', 'ManagerReviewedByManagerId') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.Quiz.ManagerReviewedByManagerId', 'TeacherReviewedByTeacherId', 'COLUMN';
  END

  IF COL_LENGTH('dbo.Quiz', 'TeacherReviewedAtUtc') IS NULL
     AND COL_LENGTH('dbo.Quiz', 'ManagerReviewedAtUtc') IS NOT NULL
  BEGIN
    EXEC sp_rename 'dbo.Quiz.ManagerReviewedAtUtc', 'TeacherReviewedAtUtc', 'COLUMN';
  END

  COMMIT;
  PRINT 'SUCCESS: Manager references renamed to Teacher.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
