SET NOCOUNT ON;

IF OBJECT_ID('dbo.StudyMaterialProcessingTiming', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.StudyMaterialProcessingTiming (
    StudyMaterialProcessingTimingId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    StudyMaterialSetId INT NULL,
    StudyMaterialJobId INT NULL,
    VersionNo INT NULL,
    Stage NVARCHAR(100) NOT NULL,
    ElapsedMs INT NULL,
    StageElapsedMs INT NULL,
    StatusValue NVARCHAR(50) NULL,
    ErrorCode NVARCHAR(50) NULL,
    MetaJson NVARCHAR(4000) NULL,
    CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_StudyMaterialProcessingTiming_CreatedAtUtc DEFAULT (SYSUTCDATETIME())
  );
END;

IF OBJECT_ID('dbo.IX_StudyMaterialProcessingTiming_SetId_CreatedAtUtc', 'IX') IS NULL
BEGIN
  CREATE INDEX IX_StudyMaterialProcessingTiming_SetId_CreatedAtUtc
    ON dbo.StudyMaterialProcessingTiming (StudyMaterialSetId, CreatedAtUtc ASC, StudyMaterialProcessingTimingId ASC);
END;

IF OBJECT_ID('dbo.IX_StudyMaterialProcessingTiming_JobId_CreatedAtUtc', 'IX') IS NULL
BEGIN
  CREATE INDEX IX_StudyMaterialProcessingTiming_JobId_CreatedAtUtc
    ON dbo.StudyMaterialProcessingTiming (StudyMaterialJobId, CreatedAtUtc ASC, StudyMaterialProcessingTimingId ASC);
END;

IF OBJECT_ID('dbo.FK_StudyMaterialProcessingTiming_Set', 'F') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialProcessingTiming WITH CHECK
  ADD CONSTRAINT FK_StudyMaterialProcessingTiming_Set
  FOREIGN KEY (StudyMaterialSetId) REFERENCES dbo.StudyMaterialSet(StudyMaterialSetId);
END;

IF OBJECT_ID('dbo.FK_StudyMaterialProcessingTiming_Job', 'F') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialProcessingTiming WITH CHECK
  ADD CONSTRAINT FK_StudyMaterialProcessingTiming_Job
  FOREIGN KEY (StudyMaterialJobId) REFERENCES dbo.StudyMaterialJob(StudyMaterialJobId);
END;
