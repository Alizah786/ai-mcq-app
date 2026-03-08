SET NOCOUNT ON;

IF COL_LENGTH('dbo.SubscriptionPlan', 'PerQuizDocumentLimit') IS NULL
BEGIN
  ALTER TABLE dbo.SubscriptionPlan
    ADD PerQuizDocumentLimit INT NOT NULL
      CONSTRAINT DF_SubscriptionPlan_PerQuizDocumentLimit DEFAULT (1);
END;

IF COL_LENGTH('dbo.DocumentUpload', 'OwnerUserNameRegistryId') IS NULL
BEGIN
  ALTER TABLE dbo.DocumentUpload
    ADD OwnerUserNameRegistryId INT NULL;
END;

IF COL_LENGTH('dbo.DocumentUpload', 'FailureReasonSafe') IS NULL
BEGIN
  ALTER TABLE dbo.DocumentUpload
    ADD FailureReasonSafe NVARCHAR(300) NULL;
END;

IF COL_LENGTH('dbo.DocumentUpload', 'CreatedAtUtc') IS NULL
BEGIN
  ALTER TABLE dbo.DocumentUpload
    ADD CreatedAtUtc DATETIME2(0) NULL;
END;

IF COL_LENGTH('dbo.DocumentUpload', 'ExtractedCharCount') IS NULL
BEGIN
  ALTER TABLE dbo.DocumentUpload
    ADD ExtractedCharCount INT NOT NULL
      CONSTRAINT DF_DocumentUpload_ExtractedCharCount DEFAULT (0);
END;

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
    AND name = 'CreatedAtUtc'
)
BEGIN
  EXEC sp_executesql N'
    UPDATE dbo.DocumentUpload
    SET CreatedAtUtc = COALESCE(CreatedAtUtc, UploadedAtUtc, SYSUTCDATETIME())
    WHERE CreatedAtUtc IS NULL;
  ';

  EXEC sp_executesql N'
    ALTER TABLE dbo.DocumentUpload
      ALTER COLUMN CreatedAtUtc DATETIME2(0) NOT NULL;
  ';
END;

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
    AND name = 'OwnerUserNameRegistryId'
)
BEGIN
  EXEC sp_executesql N'
    UPDATE d
    SET OwnerUserNameRegistryId = u.UserNameRegistryId
    FROM dbo.DocumentUpload d
    INNER JOIN dbo.UserNameRegistry u
      ON (
        d.TeacherId IS NOT NULL
        AND u.UserType = ''TEACHER''
        AND u.UserId = d.TeacherId
      )
      OR (
        d.TeacherId IS NULL
        AND d.StudentId IS NOT NULL
        AND u.UserType = ''STUDENT''
        AND u.UserId = d.StudentId
      )
    WHERE d.OwnerUserNameRegistryId IS NULL;
  ';
END;

IF OBJECT_ID('dbo.QuizDocument', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.QuizDocument (
    QuizDocumentId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QuizDocument PRIMARY KEY,
    QuizId INT NOT NULL,
    DocumentId INT NOT NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QuizDocument_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CreatedByUserNameRegistryId INT NOT NULL
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.QuizDocument')
    AND name = 'UX_QuizDocument_QuizId_DocumentId'
)
BEGIN
  CREATE UNIQUE INDEX UX_QuizDocument_QuizId_DocumentId
    ON dbo.QuizDocument(QuizId, DocumentId);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.QuizDocument')
    AND name = 'IX_QuizDocument_QuizId'
)
BEGIN
  CREATE INDEX IX_QuizDocument_QuizId
    ON dbo.QuizDocument(QuizId)
    INCLUDE (DocumentId, CreatedAtUtc);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.QuizDocument')
    AND name = 'IX_QuizDocument_DocumentId'
)
BEGIN
  CREATE INDEX IX_QuizDocument_DocumentId
    ON dbo.QuizDocument(DocumentId);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.QuizDocument')
    AND name = 'FK_QuizDocument_DocumentUpload'
)
BEGIN
  ALTER TABLE dbo.QuizDocument
    ADD CONSTRAINT FK_QuizDocument_DocumentUpload
      FOREIGN KEY (DocumentId) REFERENCES dbo.DocumentUpload(DocumentId);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.QuizDocument')
    AND name = 'FK_QuizDocument_Quiz'
)
BEGIN
  ALTER TABLE dbo.QuizDocument
    ADD CONSTRAINT FK_QuizDocument_Quiz
      FOREIGN KEY (QuizId) REFERENCES dbo.Quiz(QuizId);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.QuizDocument')
    AND name = 'FK_QuizDocument_UserNameRegistry'
)
BEGIN
  ALTER TABLE dbo.QuizDocument
    ADD CONSTRAINT FK_QuizDocument_UserNameRegistry
      FOREIGN KEY (CreatedByUserNameRegistryId) REFERENCES dbo.UserNameRegistry(UserNameRegistryId);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
    AND name = 'IX_DocumentUpload_Owner_Period_Status'
)
BEGIN
  EXEC sp_executesql N'
    CREATE INDEX IX_DocumentUpload_Owner_Period_Status
      ON dbo.DocumentUpload(OwnerUserNameRegistryId, CreatedAtUtc, Status);
  ';
END;

