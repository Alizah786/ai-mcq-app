/*
  Migration: Add ManagerId to operational tables + backfill
  Date: 2026-02-16

  Adds nullable ManagerId to:
    - dbo.Class
    - dbo.Quiz
    - dbo.QuizQuestion
    - dbo.QuizChoice
    - dbo.QuizAttempt
    - dbo.QuizAttemptAnswer
    - dbo.DocumentUpload
    - dbo.AIGenerationJob

  Then backfills existing rows from ownership chain:
    Student -> Class -> Quiz -> QuizQuestion -> QuizChoice
    Student -> QuizAttempt -> QuizAttemptAnswer
    Student -> DocumentUpload
    Student -> AIGenerationJob

  Adds FK constraints to dbo.Manager(ManagerId) and indexes on ManagerId columns.
  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.Manager', 'U') IS NULL
  BEGIN
    RAISERROR('dbo.Manager table is required before running this migration.', 16, 1);
  END

  IF COL_LENGTH('dbo.Class', 'ManagerId') IS NULL
    ALTER TABLE dbo.Class ADD ManagerId INT NULL;

  IF COL_LENGTH('dbo.Quiz', 'ManagerId') IS NULL
    ALTER TABLE dbo.Quiz ADD ManagerId INT NULL;

  IF COL_LENGTH('dbo.QuizQuestion', 'ManagerId') IS NULL
    ALTER TABLE dbo.QuizQuestion ADD ManagerId INT NULL;

  IF COL_LENGTH('dbo.QuizChoice', 'ManagerId') IS NULL
    ALTER TABLE dbo.QuizChoice ADD ManagerId INT NULL;

  IF COL_LENGTH('dbo.QuizAttempt', 'ManagerId') IS NULL
    ALTER TABLE dbo.QuizAttempt ADD ManagerId INT NULL;

  IF COL_LENGTH('dbo.QuizAttemptAnswer', 'ManagerId') IS NULL
    ALTER TABLE dbo.QuizAttemptAnswer ADD ManagerId INT NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'ManagerId') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD ManagerId INT NULL;

  IF COL_LENGTH('dbo.AIGenerationJob', 'ManagerId') IS NULL
    ALTER TABLE dbo.AIGenerationJob ADD ManagerId INT NULL;

  UPDATE c
  SET c.ManagerId = s.ManagerId
  FROM dbo.Class c
  INNER JOIN dbo.Student s ON s.StudentId = c.StudentId
  WHERE c.ManagerId IS NULL;

  UPDATE q
  SET q.ManagerId = c.ManagerId
  FROM dbo.Quiz q
  INNER JOIN dbo.Class c ON c.ClassId = q.ClassId
  WHERE q.ManagerId IS NULL;

  UPDATE qq
  SET qq.ManagerId = q.ManagerId
  FROM dbo.QuizQuestion qq
  INNER JOIN dbo.Quiz q ON q.QuizId = qq.QuizId
  WHERE qq.ManagerId IS NULL;

  UPDATE qc
  SET qc.ManagerId = qq.ManagerId
  FROM dbo.QuizChoice qc
  INNER JOIN dbo.QuizQuestion qq ON qq.QuestionId = qc.QuestionId
  WHERE qc.ManagerId IS NULL;

  UPDATE qa
  SET qa.ManagerId = s.ManagerId
  FROM dbo.QuizAttempt qa
  INNER JOIN dbo.Student s ON s.StudentId = qa.StudentId
  WHERE qa.ManagerId IS NULL;

  UPDATE qaa
  SET qaa.ManagerId = qa.ManagerId
  FROM dbo.QuizAttemptAnswer qaa
  INNER JOIN dbo.QuizAttempt qa ON qa.AttemptId = qaa.AttemptId
  WHERE qaa.ManagerId IS NULL;

  UPDATE du
  SET du.ManagerId = s.ManagerId
  FROM dbo.DocumentUpload du
  INNER JOIN dbo.Student s ON s.StudentId = du.StudentId
  WHERE du.ManagerId IS NULL;

  UPDATE aj
  SET aj.ManagerId = s.ManagerId
  FROM dbo.AIGenerationJob aj
  INNER JOIN dbo.Student s ON s.StudentId = aj.StudentId
  WHERE aj.ManagerId IS NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Class_Manager' AND parent_object_id = OBJECT_ID('dbo.Class'))
    ALTER TABLE dbo.Class ADD CONSTRAINT FK_Class_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Quiz_Manager' AND parent_object_id = OBJECT_ID('dbo.Quiz'))
    ALTER TABLE dbo.Quiz ADD CONSTRAINT FK_Quiz_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_QuizQuestion_Manager' AND parent_object_id = OBJECT_ID('dbo.QuizQuestion'))
    ALTER TABLE dbo.QuizQuestion ADD CONSTRAINT FK_QuizQuestion_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_QuizChoice_Manager' AND parent_object_id = OBJECT_ID('dbo.QuizChoice'))
    ALTER TABLE dbo.QuizChoice ADD CONSTRAINT FK_QuizChoice_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_QuizAttempt_Manager' AND parent_object_id = OBJECT_ID('dbo.QuizAttempt'))
    ALTER TABLE dbo.QuizAttempt ADD CONSTRAINT FK_QuizAttempt_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_QuizAttemptAnswer_Manager' AND parent_object_id = OBJECT_ID('dbo.QuizAttemptAnswer'))
    ALTER TABLE dbo.QuizAttemptAnswer ADD CONSTRAINT FK_QuizAttemptAnswer_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DocumentUpload_Manager' AND parent_object_id = OBJECT_ID('dbo.DocumentUpload'))
    ALTER TABLE dbo.DocumentUpload ADD CONSTRAINT FK_DocumentUpload_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AIGenerationJob_Manager' AND parent_object_id = OBJECT_ID('dbo.AIGenerationJob'))
    ALTER TABLE dbo.AIGenerationJob ADD CONSTRAINT FK_AIGenerationJob_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Class_ManagerId' AND object_id = OBJECT_ID('dbo.Class'))
    CREATE INDEX IX_Class_ManagerId ON dbo.Class(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Quiz_ManagerId' AND object_id = OBJECT_ID('dbo.Quiz'))
    CREATE INDEX IX_Quiz_ManagerId ON dbo.Quiz(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_QuizQuestion_ManagerId' AND object_id = OBJECT_ID('dbo.QuizQuestion'))
    CREATE INDEX IX_QuizQuestion_ManagerId ON dbo.QuizQuestion(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_QuizChoice_ManagerId' AND object_id = OBJECT_ID('dbo.QuizChoice'))
    CREATE INDEX IX_QuizChoice_ManagerId ON dbo.QuizChoice(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_QuizAttempt_ManagerId' AND object_id = OBJECT_ID('dbo.QuizAttempt'))
    CREATE INDEX IX_QuizAttempt_ManagerId ON dbo.QuizAttempt(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_QuizAttemptAnswer_ManagerId' AND object_id = OBJECT_ID('dbo.QuizAttemptAnswer'))
    CREATE INDEX IX_QuizAttemptAnswer_ManagerId ON dbo.QuizAttemptAnswer(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocumentUpload_ManagerId' AND object_id = OBJECT_ID('dbo.DocumentUpload'))
    CREATE INDEX IX_DocumentUpload_ManagerId ON dbo.DocumentUpload(ManagerId);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AIGenerationJob_ManagerId' AND object_id = OBJECT_ID('dbo.AIGenerationJob'))
    CREATE INDEX IX_AIGenerationJob_ManagerId ON dbo.AIGenerationJob(ManagerId);

  COMMIT;
  PRINT 'SUCCESS: ManagerId columns, backfill, FKs, and indexes ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();
  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO

