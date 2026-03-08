SET NOCOUNT ON;

IF OBJECT_ID('dbo.StudyMaterialSet', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.StudyMaterialSet (
    StudyMaterialSetId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OwnerUserNameRegistryId INT NULL,
    OwnerUserId INT NULL,
    OwnerRole NVARCHAR(20) NULL,
    RoleContext NVARCHAR(20) NOT NULL,
    TeacherId INT NULL,
    StudentId INT NULL,
    ClassId INT NULL,
    CourseCode NVARCHAR(80) NULL,
    DocumentUploadId INT NULL,
    SourceType NVARCHAR(20) NOT NULL CONSTRAINT DF_StudyMaterialSet_SourceType DEFAULT ('Document'),
    PastedText NVARCHAR(MAX) NULL,
    Subject NVARCHAR(120) NOT NULL,
    Topic NVARCHAR(180) NOT NULL,
    OutputsJson NVARCHAR(MAX) NOT NULL,
    OptionsJson NVARCHAR(MAX) NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_StudyMaterialSet_Status DEFAULT ('Draft'),
    LatestVersionNo INT NOT NULL CONSTRAINT DF_StudyMaterialSet_LatestVersionNo DEFAULT (0),
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_StudyMaterialSet_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_StudyMaterialSet_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())
  );
END;

IF OBJECT_ID('dbo.StudyMaterialVersion', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.StudyMaterialVersion (
    StudyMaterialVersionId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    StudyMaterialSetId INT NOT NULL,
    VersionNo INT NOT NULL,
    Title NVARCHAR(200) NULL,
    SummaryText NVARCHAR(MAX) NULL,
    KeywordsJson NVARCHAR(MAX) NULL,
    NotesMarkdown NVARCHAR(MAX) NULL,
    FlashcardsJson NVARCHAR(MAX) NULL,
    IsUserEdited BIT NOT NULL CONSTRAINT DF_StudyMaterialVersion_IsUserEdited DEFAULT (0),
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_StudyMaterialVersion_CreatedAtUtc DEFAULT (SYSUTCDATETIME())
  );
END;

IF OBJECT_ID('dbo.StudyMaterialJob', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.StudyMaterialJob (
    StudyMaterialJobId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    StudyMaterialSetId INT NOT NULL,
    VersionNo INT NOT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_StudyMaterialJob_Status DEFAULT ('Queued'),
    AttemptCount INT NOT NULL CONSTRAINT DF_StudyMaterialJob_AttemptCount DEFAULT (0),
    MaxAttempts INT NOT NULL CONSTRAINT DF_StudyMaterialJob_MaxAttempts DEFAULT (3),
    NextRetryAtUtc DATETIME2(0) NULL,
    ErrorCode NVARCHAR(50) NULL,
    LastErrorSafe NVARCHAR(300) NULL,
    ProviderRequestId NVARCHAR(100) NULL,
    LockedUntilUtc DATETIME2(0) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_StudyMaterialJob_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_StudyMaterialJob_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())
  );
END;

IF COL_LENGTH('dbo.StudyMaterialSet', 'SourceType') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet ADD SourceType NVARCHAR(20) NOT NULL CONSTRAINT DF_StudyMaterialSet_SourceType_2 DEFAULT ('Document');
END;

IF COL_LENGTH('dbo.StudyMaterialSet', 'PastedText') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet ADD PastedText NVARCHAR(MAX) NULL;
END;

IF COL_LENGTH('dbo.StudyMaterialSet', 'OptionsJson') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet ADD OptionsJson NVARCHAR(MAX) NULL;
END;

IF OBJECT_ID('dbo.CK_StudyMaterialSet_Status', 'C') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet WITH CHECK
  ADD CONSTRAINT CK_StudyMaterialSet_Status
  CHECK (Status IN ('Draft','Queued','Processing','Completed','Failed'));
END;

IF OBJECT_ID('dbo.CK_StudyMaterialSet_SourceType', 'C') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet WITH CHECK
  ADD CONSTRAINT CK_StudyMaterialSet_SourceType
  CHECK (SourceType IN ('Document','PastedText'));
END;

IF OBJECT_ID('dbo.CK_StudyMaterialSet_SourceConsistency', 'C') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet WITH CHECK
  ADD CONSTRAINT CK_StudyMaterialSet_SourceConsistency
  CHECK (
    (SourceType = 'Document' AND DocumentUploadId IS NOT NULL AND PastedText IS NULL)
    OR
    (SourceType = 'PastedText' AND DocumentUploadId IS NULL AND PastedText IS NOT NULL)
  );
END;

IF OBJECT_ID('dbo.CK_StudyMaterialJob_Status', 'C') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialJob WITH CHECK
  ADD CONSTRAINT CK_StudyMaterialJob_Status
  CHECK (Status IN ('Queued','Processing','Succeeded','Retrying','Failed'));
END;

IF OBJECT_ID('dbo.UX_StudyMaterialVersion_Set_Version', 'UQ') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialVersion
  ADD CONSTRAINT UX_StudyMaterialVersion_Set_Version UNIQUE (StudyMaterialSetId, VersionNo);
END;

IF OBJECT_ID('dbo.UX_StudyMaterialJob_Set_Version', 'UQ') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialJob
  ADD CONSTRAINT UX_StudyMaterialJob_Set_Version UNIQUE (StudyMaterialSetId, VersionNo);
END;

IF OBJECT_ID('dbo.IX_StudyMaterialSet_Owner_CreatedAt', 'IX') IS NULL
BEGIN
  CREATE INDEX IX_StudyMaterialSet_Owner_CreatedAt
    ON dbo.StudyMaterialSet (OwnerUserNameRegistryId, CreatedAtUtc DESC);
END;

IF OBJECT_ID('dbo.IX_StudyMaterialSet_DocumentUploadId', 'IX') IS NULL
BEGIN
  CREATE INDEX IX_StudyMaterialSet_DocumentUploadId
    ON dbo.StudyMaterialSet (DocumentUploadId);
END;

IF OBJECT_ID('dbo.IX_StudyMaterialJob_Polling', 'IX') IS NULL
BEGIN
  CREATE INDEX IX_StudyMaterialJob_Polling
    ON dbo.StudyMaterialJob (Status, NextRetryAtUtc, LockedUntilUtc);
END;

IF OBJECT_ID('dbo.FK_StudyMaterialVersion_Set', 'F') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialVersion WITH CHECK
  ADD CONSTRAINT FK_StudyMaterialVersion_Set
  FOREIGN KEY (StudyMaterialSetId) REFERENCES dbo.StudyMaterialSet(StudyMaterialSetId);
END;

IF OBJECT_ID('dbo.FK_StudyMaterialJob_Set', 'F') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialJob WITH CHECK
  ADD CONSTRAINT FK_StudyMaterialJob_Set
  FOREIGN KEY (StudyMaterialSetId) REFERENCES dbo.StudyMaterialSet(StudyMaterialSetId);
END;

