/*
  Migration: Teacher review + edit system for AI quizzes
  Date: 2026-02-17

  Adds:
    - Quiz.ParentQuizId
    - Quiz.IsTeacherEdited
    - Quiz.RequiresTeacherReview
    - Quiz.TeacherReviewed
    - Quiz.TeacherReviewedByTeacherId
    - Quiz.TeacherReviewedAtUtc
    - dbo.QuizChangeLog

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Quiz', 'ParentQuizId') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD ParentQuizId INT NULL;
  END

  IF COL_LENGTH('dbo.Quiz', 'IsTeacherEdited') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD IsTeacherEdited BIT NOT NULL
      CONSTRAINT DF_Quiz_IsTeacherEdited DEFAULT (0);
  END

  IF COL_LENGTH('dbo.Quiz', 'RequiresTeacherReview') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD RequiresTeacherReview BIT NOT NULL
      CONSTRAINT DF_Quiz_RequiresTeacherReview DEFAULT (0);
  END

  IF COL_LENGTH('dbo.Quiz', 'TeacherReviewed') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD TeacherReviewed BIT NOT NULL
      CONSTRAINT DF_Quiz_TeacherReviewed DEFAULT (0);
  END

  IF COL_LENGTH('dbo.Quiz', 'TeacherReviewedByTeacherId') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD TeacherReviewedByTeacherId INT NULL;
  END

  IF COL_LENGTH('dbo.Quiz', 'TeacherReviewedAtUtc') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD TeacherReviewedAtUtc DATETIME2(0) NULL;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Quiz_ParentQuiz'
      AND parent_object_id = OBJECT_ID('dbo.Quiz')
  )
  BEGIN
    ALTER TABLE dbo.Quiz
    ADD CONSTRAINT FK_Quiz_ParentQuiz
      FOREIGN KEY (ParentQuizId) REFERENCES dbo.Quiz(QuizId);
  END

  IF OBJECT_ID('dbo.QuizChangeLog', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.QuizChangeLog (
      LogId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      TeacherId INT NOT NULL,
      QuizId INT NOT NULL,
      QuestionId INT NULL,
      FieldName NVARCHAR(120) NULL,
      OldValue NVARCHAR(MAX) NULL,
      NewValue NVARCHAR(MAX) NULL,
      ActionType NVARCHAR(40) NOT NULL,
      LoggedAtUtc DATETIME2(0) NOT NULL
        CONSTRAINT DF_QuizChangeLog_LoggedAtUtc DEFAULT (SYSUTCDATETIME())
    );
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name IN ('FK_QuizChangeLog_Teacher', 'FK_QuizChangeLog_Manager')
      AND parent_object_id = OBJECT_ID('dbo.QuizChangeLog')
  )
  BEGIN
    ALTER TABLE dbo.QuizChangeLog
    ADD CONSTRAINT FK_QuizChangeLog_Teacher
      FOREIGN KEY (TeacherId) REFERENCES dbo.Teacher(TeacherId);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_QuizChangeLog_Quiz'
      AND parent_object_id = OBJECT_ID('dbo.QuizChangeLog')
  )
  BEGIN
    ALTER TABLE dbo.QuizChangeLog
    ADD CONSTRAINT FK_QuizChangeLog_Quiz
      FOREIGN KEY (QuizId) REFERENCES dbo.Quiz(QuizId);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.QuizChangeLog')
      AND name = 'IX_QuizChangeLog_QuizId_LoggedAtUtc'
  )
  BEGIN
    CREATE INDEX IX_QuizChangeLog_QuizId_LoggedAtUtc
      ON dbo.QuizChangeLog(QuizId, LoggedAtUtc DESC);
  END

  -- Existing AI quizzes should require teacher review.
  EXEC sp_executesql N'
    UPDATE dbo.Quiz
    SET RequiresTeacherReview = 1
    WHERE RequiresTeacherReview = 0
      AND ISNULL(IsTeacherEdited, 0) = 0
      AND (
        ISNULL(SourceType, '''') LIKE ''AI%''
        OR ISNULL(SourceType, '''') IN (''AI_Topic'')
      );
  ';

  COMMIT;
  PRINT 'SUCCESS: Teacher review/edit schema ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

