/*
  Migration: Add AIQuizDictionary and link Quiz -> AIQuizDictionary
  Date: 2026-02-22

  Purpose:
    - Persist original, unedited AI generated quiz payloads
    - Allow creating new quizzes from AI history
    - Link Quiz rows back to source AI dictionary entry

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.AIQuizDictionary', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.AIQuizDictionary (
      AIQuizDictionaryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIQuizDictionary PRIMARY KEY,
      TeacherId INT NULL,
      PrincipalId INT NULL,
      StudentId INT NULL,
      ClassId INT NULL,
      Topic NVARCHAR(200) NULL,
      Difficulty NVARCHAR(20) NULL,
      QuestionCount INT NOT NULL CONSTRAINT DF_AIQuizDictionary_QuestionCount DEFAULT (0),
      SourceProvider NVARCHAR(50) NULL,
      ModelName NVARCHAR(120) NULL,
      PromptHash NVARCHAR(128) NULL,
      DictionaryPayloadJson NVARCHAR(MAX) NOT NULL,
      IsActive BIT NOT NULL CONSTRAINT DF_AIQuizDictionary_IsActive DEFAULT (1),
      CreateDate DATETIME2(0) NOT NULL CONSTRAINT DF_AIQuizDictionary_CreateDate DEFAULT (SYSUTCDATETIME()),
      LastModifiedDate DATETIME2(0) NOT NULL CONSTRAINT DF_AIQuizDictionary_LastModifiedDate DEFAULT (SYSUTCDATETIME())
    );
  END;

  IF COL_LENGTH('dbo.Quiz', 'AIQuizDictionaryId') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz ADD AIQuizDictionaryId INT NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Quiz_AIQuizDictionary'
      AND parent_object_id = OBJECT_ID('dbo.Quiz')
  )
  BEGIN
    ALTER TABLE dbo.Quiz
      ADD CONSTRAINT FK_Quiz_AIQuizDictionary
      FOREIGN KEY (AIQuizDictionaryId) REFERENCES dbo.AIQuizDictionary(AIQuizDictionaryId);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Quiz')
      AND name = 'IX_Quiz_AIQuizDictionaryId'
  )
  BEGIN
    CREATE INDEX IX_Quiz_AIQuizDictionaryId ON dbo.Quiz(AIQuizDictionaryId);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.AIQuizDictionary')
      AND name = 'IX_AIQuizDictionary_Teacher_Class'
  )
  BEGIN
    CREATE INDEX IX_AIQuizDictionary_Teacher_Class
      ON dbo.AIQuizDictionary(TeacherId, ClassId, CreateDate DESC);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.AIQuizDictionary')
      AND name = 'IX_AIQuizDictionary_Student_Class'
  )
  BEGIN
    CREATE INDEX IX_AIQuizDictionary_Student_Class
      ON dbo.AIQuizDictionary(StudentId, ClassId, CreateDate DESC);
  END;

  COMMIT;
  PRINT 'SUCCESS: AIQuizDictionary ensured and Quiz linked.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

