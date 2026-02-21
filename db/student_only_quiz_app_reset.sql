/*
  AI Quiz App (Student-only) - FULL RESET + SCHEMA + TRIGGERS + SEED DATA
  SQL Server script (.sql)

  What this script does:
   1) Drops ALL existing foreign keys & tables in current DB
   2) Creates the Student-only schema:
        Student -> Class -> Quiz -> QuizQuestion -> QuizChoice
        QuizAttempt -> QuizAttemptAnswer
        DocumentUpload -> AIGenerationJob (background AI jobs)
   3) FIXES SQL Server "multiple cascade paths" by:
        - Keeping CASCADE on the main ownership chain:
            Student -> Class -> Quiz -> QuizAttempt -> QuizAttemptAnswer
            Class -> DocumentUpload
            Class -> AIGenerationJob
        - Using NO ACTION on:
            QuizAttempt.StudentId
            DocumentUpload.StudentId
            AIGenerationJob.StudentId
            AIGenerationJob.DocumentId
            AIGenerationJob.ResultQuizId
   4) Adds triggers to emulate SET NULL behavior for:
        - AIGenerationJob.DocumentId when DocumentUpload is deleted
        - AIGenerationJob.ResultQuizId when Quiz is deleted
   5) Adds idempotent seed data (safe to run multiple times)

  IMPORTANT:
   - Run when your app is stopped.
   - This is a hard reset: all old data will be deleted.
*/

-- Change DB name if needed
-- USE AiMcqApp;
-- GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  ------------------------------------------------------------
  -- 1) DROP ALL TABLES (safe for unknown FK order)
  ------------------------------------------------------------
  DECLARE @dropSql NVARCHAR(MAX) = N'';

  -- Drop all foreign keys first
  SELECT @dropSql += N'ALTER TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name)
                  + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';' + CHAR(10)
  FROM sys.foreign_keys fk
  JOIN sys.tables t ON fk.parent_object_id = t.object_id
  JOIN sys.schemas s ON t.schema_id = s.schema_id;

  -- Drop all tables
  SELECT @dropSql += N'DROP TABLE ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N';' + CHAR(10)
  FROM sys.tables t
  JOIN sys.schemas s ON t.schema_id = s.schema_id;

  IF (@dropSql <> N'')
    EXEC sp_executesql @dropSql;

  ------------------------------------------------------------
  -- 2) CREATE TABLES
  ------------------------------------------------------------

  -- 2.1 Student (only user type)
  CREATE TABLE dbo.Student (
      StudentId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Student PRIMARY KEY,
      Email             NVARCHAR(256)      NOT NULL,
      FullName          NVARCHAR(120)      NOT NULL,
      PasswordHash      NVARCHAR(400)      NOT NULL,
      IsActive          BIT                NOT NULL CONSTRAINT DF_Student_IsActive DEFAULT (1),
      CreatedAtUtc      DATETIME2(0)       NOT NULL CONSTRAINT DF_Student_CreatedAt DEFAULT (SYSUTCDATETIME())
  );
  CREATE UNIQUE INDEX UX_Student_Email ON dbo.Student(Email);

  -- 2.2 Class (created/owned by student)
  CREATE TABLE dbo.Class (
      ClassId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Class PRIMARY KEY,
      StudentId         INT               NOT NULL,
      ClassName         NVARCHAR(120)     NOT NULL,
      Subject           NVARCHAR(120)     NULL,
      GradeLevel        NVARCHAR(30)      NULL,
      JoinCode          NVARCHAR(12)      NULL, -- optional
      IsArchived        BIT               NOT NULL CONSTRAINT DF_Class_IsArchived DEFAULT (0),
      CreatedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_Class_CreatedAt DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT FK_Class_Student FOREIGN KEY (StudentId)
          REFERENCES dbo.Student(StudentId) ON DELETE CASCADE
  );
  CREATE INDEX IX_Class_StudentId ON dbo.Class(StudentId);
  CREATE UNIQUE INDEX UX_Class_JoinCode ON dbo.Class(JoinCode) WHERE JoinCode IS NOT NULL;

  -- 2.3 Quiz
  CREATE TABLE dbo.Quiz (
      QuizId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Quiz PRIMARY KEY,
      ClassId           INT               NOT NULL,
      Title             NVARCHAR(200)     NOT NULL,
      Topic             NVARCHAR(200)     NULL,
      Difficulty        NVARCHAR(20)      NULL,   -- Easy/Medium/Hard
      SourceType        NVARCHAR(30)      NOT NULL, -- Manual/AI_Topic/AI_Document
      Status            NVARCHAR(20)      NOT NULL CONSTRAINT DF_Quiz_Status DEFAULT ('Draft'), -- Draft/Ready/Archived
      CreatedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_Quiz_CreatedAt DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT FK_Quiz_Class FOREIGN KEY (ClassId)
          REFERENCES dbo.Class(ClassId) ON DELETE CASCADE
  );
  CREATE INDEX IX_Quiz_ClassId ON dbo.Quiz(ClassId);

  -- 2.4 QuizQuestion
  CREATE TABLE dbo.QuizQuestion (
      QuestionId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuizQuestion PRIMARY KEY,
      QuizId            INT               NOT NULL,
      QuestionText      NVARCHAR(2000)    NOT NULL,
      Explanation       NVARCHAR(2000)    NULL,
      Points            INT               NOT NULL CONSTRAINT DF_QuizQuestion_Points DEFAULT (1),
      DisplayOrder      INT               NOT NULL CONSTRAINT DF_QuizQuestion_DisplayOrder DEFAULT (0),
      CONSTRAINT FK_QuizQuestion_Quiz FOREIGN KEY (QuizId)
          REFERENCES dbo.Quiz(QuizId) ON DELETE CASCADE
  );
  CREATE INDEX IX_QuizQuestion_QuizId ON dbo.QuizQuestion(QuizId);

  -- 2.5 QuizChoice
  CREATE TABLE dbo.QuizChoice (
      ChoiceId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuizChoice PRIMARY KEY,
      QuestionId        INT               NOT NULL,
      ChoiceText        NVARCHAR(1000)    NOT NULL,
      IsCorrect         BIT               NOT NULL CONSTRAINT DF_QuizChoice_IsCorrect DEFAULT (0),
      DisplayOrder      INT               NOT NULL CONSTRAINT DF_QuizChoice_DisplayOrder DEFAULT (0),
      CONSTRAINT FK_QuizChoice_Question FOREIGN KEY (QuestionId)
          REFERENCES dbo.QuizQuestion(QuestionId) ON DELETE CASCADE
  );
  CREATE INDEX IX_QuizChoice_QuestionId ON dbo.QuizChoice(QuestionId);

  -- 2.6 QuizAttempt
  CREATE TABLE dbo.QuizAttempt (
      AttemptId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuizAttempt PRIMARY KEY,
      QuizId            INT               NOT NULL,
      StudentId         INT               NOT NULL,
      StartedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_QuizAttempt_Started DEFAULT (SYSUTCDATETIME()),
      SubmittedAtUtc    DATETIME2(0)      NULL,
      Score             INT               NULL,
      TotalPoints       INT               NULL,
      CONSTRAINT FK_QuizAttempt_Quiz FOREIGN KEY (QuizId)
          REFERENCES dbo.Quiz(QuizId) ON DELETE CASCADE,
      CONSTRAINT FK_QuizAttempt_Student FOREIGN KEY (StudentId)
          REFERENCES dbo.Student(StudentId) ON DELETE NO ACTION
  );
  CREATE INDEX IX_QuizAttempt_Quiz_Student ON dbo.QuizAttempt(QuizId, StudentId);

  -- 2.7 QuizAttemptAnswer
  CREATE TABLE dbo.QuizAttemptAnswer (
      AttemptAnswerId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuizAttemptAnswer PRIMARY KEY,
      AttemptId         INT               NOT NULL,
      QuestionId        INT               NOT NULL,
      SelectedChoiceId  INT               NULL,
      IsCorrect         BIT               NULL,
      AnsweredAtUtc     DATETIME2(0)      NOT NULL CONSTRAINT DF_QAA_Answered DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT FK_QAA_Attempt FOREIGN KEY (AttemptId)
          REFERENCES dbo.QuizAttempt(AttemptId) ON DELETE CASCADE,
      CONSTRAINT FK_QAA_Question FOREIGN KEY (QuestionId)
          REFERENCES dbo.QuizQuestion(QuestionId) ON DELETE NO ACTION,
      CONSTRAINT FK_QAA_Choice FOREIGN KEY (SelectedChoiceId)
          REFERENCES dbo.QuizChoice(ChoiceId) ON DELETE NO ACTION
  );
  CREATE UNIQUE INDEX UX_QAA_Attempt_Question ON dbo.QuizAttemptAnswer(AttemptId, QuestionId);

  -- 2.8 DocumentUpload
  CREATE TABLE dbo.DocumentUpload (
      DocumentId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DocumentUpload PRIMARY KEY,
      StudentId         INT               NOT NULL,
      ClassId           INT               NOT NULL,
      OriginalFileName  NVARCHAR(260)     NOT NULL,
      StoragePath       NVARCHAR(400)     NOT NULL,
      FileType          NVARCHAR(20)      NULL,
      UploadedAtUtc     DATETIME2(0)      NOT NULL CONSTRAINT DF_DocumentUpload_Uploaded DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT FK_DocumentUpload_Class FOREIGN KEY (ClassId)
          REFERENCES dbo.Class(ClassId) ON DELETE CASCADE,
      CONSTRAINT FK_DocumentUpload_Student FOREIGN KEY (StudentId)
          REFERENCES dbo.Student(StudentId) ON DELETE NO ACTION
  );
  CREATE INDEX IX_DocumentUpload_Student_Class ON dbo.DocumentUpload(StudentId, ClassId);

  -- 2.9 AIGenerationJob (LATEST FIXED VERSION)
  CREATE TABLE dbo.AIGenerationJob (
      JobId             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIGenerationJob PRIMARY KEY,
      StudentId         INT               NOT NULL,
      ClassId           INT               NOT NULL,
      DocumentId        INT               NULL,
      Topic             NVARCHAR(200)     NULL,
      Prompt            NVARCHAR(2000)    NULL,
      NumQuestions      INT               NULL,
      Difficulty        NVARCHAR(20)      NULL,
      Status            NVARCHAR(20)      NOT NULL CONSTRAINT DF_AIJob_Status DEFAULT ('Queued'),
      ResultQuizId      INT               NULL,
      ErrorMessage      NVARCHAR(2000)    NULL,
      CreatedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_AIJob_Created DEFAULT (SYSUTCDATETIME()),
      CompletedAtUtc    DATETIME2(0)      NULL,

      CONSTRAINT FK_AIJob_Class FOREIGN KEY (ClassId)
          REFERENCES dbo.Class(ClassId) ON DELETE CASCADE,

      CONSTRAINT FK_AIJob_Student FOREIGN KEY (StudentId)
          REFERENCES dbo.Student(StudentId) ON DELETE NO ACTION,

      CONSTRAINT FK_AIJob_Document FOREIGN KEY (DocumentId)
          REFERENCES dbo.DocumentUpload(DocumentId) ON DELETE NO ACTION,

      CONSTRAINT FK_AIJob_ResultQuiz FOREIGN KEY (ResultQuizId)
          REFERENCES dbo.Quiz(QuizId) ON DELETE NO ACTION
  );
  CREATE INDEX IX_AIJob_Student_Status ON dbo.AIGenerationJob(StudentId, Status);

  ------------------------------------------------------------
  -- 3) TRIGGERS (emulate SET NULL without cascade-path conflicts)
  ------------------------------------------------------------

  -- When a document is deleted, null out DocumentId in AIGenerationJob
  EXEC ('CREATE TRIGGER dbo.tr_DocumentUpload_NullAIJobDocumentId
  ON dbo.DocumentUpload
  AFTER DELETE
  AS
  BEGIN
      SET NOCOUNT ON;

      UPDATE j
      SET j.DocumentId = NULL
      FROM dbo.AIGenerationJob j
      INNER JOIN deleted d ON d.DocumentId = j.DocumentId;
  END');

  -- When a quiz is deleted, null out ResultQuizId in AIGenerationJob
  EXEC ('CREATE TRIGGER dbo.tr_Quiz_NullAIJobResultQuizId
  ON dbo.Quiz
  AFTER DELETE
  AS
  BEGIN
      SET NOCOUNT ON;

      UPDATE j
      SET j.ResultQuizId = NULL
      FROM dbo.AIGenerationJob j
      INNER JOIN deleted d ON d.QuizId = j.ResultQuizId;
  END');

  ------------------------------------------------------------
  -- 4) SEED DATA (IDEMPOTENT)
  ------------------------------------------------------------

  IF NOT EXISTS (SELECT 1 FROM dbo.Student WHERE Email = ''student1@test.com'')
  BEGIN
      INSERT INTO dbo.Student (Email, FullName, PasswordHash)
      VALUES (''student1@test.com'', ''Student One'', ''HASH1'');
  END

  DECLARE @StudentId INT = (SELECT StudentId FROM dbo.Student WHERE Email=''student1@test.com'');

  IF NOT EXISTS (SELECT 1 FROM dbo.Class WHERE StudentId=@StudentId AND ClassName=''Grade 12 Economics'')
  BEGIN
      INSERT INTO dbo.Class (StudentId, ClassName, Subject, GradeLevel, JoinCode)
      VALUES (@StudentId, ''Grade 12 Economics'', ''Economics'', ''12'', ''ECO12A'');
  END

  DECLARE @ClassId INT = (
      SELECT TOP 1 ClassId FROM dbo.Class
      WHERE StudentId=@StudentId AND ClassName=''Grade 12 Economics''
      ORDER BY ClassId DESC
  );

  IF NOT EXISTS (SELECT 1 FROM dbo.Quiz WHERE ClassId=@ClassId AND Title=''Unit 1 Practice Quiz'')
  BEGIN
      INSERT INTO dbo.Quiz (ClassId, Title, Topic, Difficulty, SourceType, Status)
      VALUES (@ClassId, ''Unit 1 Practice Quiz'', ''Scarcity & Choice'', ''Easy'', ''Manual'', ''Ready'');
  END

  DECLARE @QuizId INT = (
      SELECT TOP 1 QuizId FROM dbo.Quiz
      WHERE ClassId=@ClassId AND Title=''Unit 1 Practice Quiz''
      ORDER BY QuizId DESC
  );

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizQuestion WHERE QuizId=@QuizId AND DisplayOrder=1)
  BEGIN
      INSERT INTO dbo.QuizQuestion (QuizId, QuestionText, Explanation, DisplayOrder)
      VALUES (@QuizId, ''Economics is mainly the study of…'', ''Economics studies choices under scarcity.'', 1);
  END

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizQuestion WHERE QuizId=@QuizId AND DisplayOrder=2)
  BEGIN
      INSERT INTO dbo.QuizQuestion (QuizId, QuestionText, Explanation, DisplayOrder)
      VALUES (@QuizId, ''Opportunity cost means…'', ''The value of the next best alternative.'', 2);
  END

  DECLARE @Q1 INT = (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId=@QuizId AND DisplayOrder=1);
  DECLARE @Q2 INT = (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId=@QuizId AND DisplayOrder=2);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q1 AND DisplayOrder=1)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q1, ''How to make money fast'', 0, 1);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q1 AND DisplayOrder=2)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q1, ''Choices under scarcity'', 1, 2);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q1 AND DisplayOrder=3)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q1, ''Only stocks and bonds'', 0, 3);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q1 AND DisplayOrder=4)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q1, ''Government laws only'', 0, 4);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q2 AND DisplayOrder=1)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q2, ''The total money you spend'', 0, 1);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q2 AND DisplayOrder=2)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q2, ''The value of the next best option you give up'', 1, 2);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q2 AND DisplayOrder=3)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q2, ''A free benefit with no cost'', 0, 3);

  IF NOT EXISTS (SELECT 1 FROM dbo.QuizChoice WHERE QuestionId=@Q2 AND DisplayOrder=4)
    INSERT INTO dbo.QuizChoice (QuestionId, ChoiceText, IsCorrect, DisplayOrder)
    VALUES (@Q2, ''Your salary per hour'', 0, 4);

  COMMIT;
  PRINT 'SUCCESS: Schema created + triggers + seed data applied.';

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();

  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO
