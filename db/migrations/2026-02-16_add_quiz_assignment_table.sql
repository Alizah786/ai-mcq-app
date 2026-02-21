/*
  Migration: Add manager quiz assignment table
  Date: 2026-02-16

  Purpose:
    - Allow managers to assign a quiz to one or more of their students.
    - One row per (QuizId, StudentId).
    - Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.QuizAssignment', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.QuizAssignment (
      AssignmentId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuizAssignment PRIMARY KEY,
      ManagerId INT NOT NULL,
      QuizId INT NOT NULL,
      StudentId INT NOT NULL,
      AssignedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QuizAssignment_AssignedAt DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT FK_QuizAssignment_Manager FOREIGN KEY (ManagerId) REFERENCES dbo.Manager(ManagerId),
      CONSTRAINT FK_QuizAssignment_Quiz FOREIGN KEY (QuizId) REFERENCES dbo.Quiz(QuizId) ON DELETE CASCADE,
      CONSTRAINT FK_QuizAssignment_Student FOREIGN KEY (StudentId) REFERENCES dbo.Student(StudentId) ON DELETE NO ACTION
    );
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'UX_QuizAssignment_Quiz_Student' AND object_id = OBJECT_ID('dbo.QuizAssignment')
  )
  BEGIN
    CREATE UNIQUE INDEX UX_QuizAssignment_Quiz_Student ON dbo.QuizAssignment(QuizId, StudentId);
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_QuizAssignment_ManagerId' AND object_id = OBJECT_ID('dbo.QuizAssignment')
  )
  BEGIN
    CREATE INDEX IX_QuizAssignment_ManagerId ON dbo.QuizAssignment(ManagerId);
  END

  COMMIT;
  PRINT 'SUCCESS: dbo.QuizAssignment ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
