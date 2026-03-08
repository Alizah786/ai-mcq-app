SET NOCOUNT ON;

IF OBJECT_ID('dbo.DocumentProcessingTiming', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DocumentProcessingTiming (
    DocumentProcessingTimingId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    DocumentId INT NULL,
    Stage NVARCHAR(100) NOT NULL,
    ElapsedMs INT NULL,
    StageElapsedMs INT NULL,
    StatusValue NVARCHAR(50) NULL,
    ErrorCode NVARCHAR(50) NULL,
    MetaJson NVARCHAR(4000) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DocumentProcessingTiming_CreatedAtUtc DEFAULT (SYSUTCDATETIME())
  );
END;

IF OBJECT_ID('dbo.IX_DocumentProcessingTiming_DocumentId_CreatedAtUtc', 'IX') IS NULL
BEGIN
  CREATE INDEX IX_DocumentProcessingTiming_DocumentId_CreatedAtUtc
    ON dbo.DocumentProcessingTiming (DocumentId, CreatedAtUtc ASC, DocumentProcessingTimingId ASC);
END;

IF OBJECT_ID('dbo.FK_DocumentProcessingTiming_DocumentUpload', 'F') IS NULL
BEGIN
  ALTER TABLE dbo.DocumentProcessingTiming WITH CHECK
  ADD CONSTRAINT FK_DocumentProcessingTiming_DocumentUpload
  FOREIGN KEY (DocumentId) REFERENCES dbo.DocumentUpload(DocumentId);
END;
