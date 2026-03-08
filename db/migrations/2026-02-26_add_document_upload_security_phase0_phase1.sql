/*
  Migration: DocumentUpload security extensions + concurrency-safe uniqueness
  Date: 2026-02-26

  Purpose:
    - Extend dbo.DocumentUpload for secure course-outline upload processing
    - Add ContextKey computed column (teacher/student context)
    - Enforce one active document per context with filtered unique index
    - Add lookup indexes for context scans

  Notes:
    - Backward compatible: does not drop/rename legacy columns.
    - INT identity keys preserved.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.DocumentUpload', 'U') IS NULL
  BEGIN
    THROW 50000, 'Table dbo.DocumentUpload does not exist.', 1;
  END

  -- Ensure legacy context columns exist across schema variants.
  IF COL_LENGTH('dbo.DocumentUpload', 'StudentId') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD StudentId INT NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'ClassId') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD ClassId INT NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'TeacherId') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD TeacherId INT NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'CourseCode') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD CourseCode NVARCHAR(80) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'LastModifiedDate') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD LastModifiedDate DATETIME2(0) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'FileSizeBytes') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD FileSizeBytes BIGINT NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'MimeType') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD MimeType NVARCHAR(120) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'Sha256Hash') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD Sha256Hash CHAR(64) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'Status') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD Status NVARCHAR(40) NOT NULL CONSTRAINT DF_DocumentUpload_Status DEFAULT ('Uploaded');

  IF COL_LENGTH('dbo.DocumentUpload', 'ScanResult') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD ScanResult NVARCHAR(20) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'PageCount') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD PageCount INT NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'ExtractedText') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD ExtractedText NVARCHAR(MAX) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'ExtractedTextLength') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD ExtractedTextLength INT NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'WarningCodes') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD WarningCodes NVARCHAR(400) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'ErrorCode') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD ErrorCode NVARCHAR(80) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'DeletedAtUtc') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD DeletedAtUtc DATETIME2(0) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'ExpiresAtUtc') IS NULL
    ALTER TABLE dbo.DocumentUpload ADD ExpiresAtUtc DATETIME2(0) NULL;

  IF COL_LENGTH('dbo.DocumentUpload', 'ContextKey') IS NULL
  BEGIN
    EXEC sp_executesql N'
      ALTER TABLE dbo.DocumentUpload
      ADD ContextKey AS (
        CASE
          WHEN TeacherId IS NOT NULL
               AND ClassId IS NOT NULL
               AND NULLIF(UPPER(LTRIM(RTRIM(CourseCode))), '''') IS NOT NULL
            THEN CONCAT(
              ''T:'', CONVERT(VARCHAR(20), TeacherId),
              '':C:'', CONVERT(VARCHAR(20), ClassId),
              '':CC:'', UPPER(LTRIM(RTRIM(CourseCode)))
            )
          WHEN StudentId IS NOT NULL
               AND NULLIF(UPPER(LTRIM(RTRIM(CourseCode))), '''') IS NOT NULL
            THEN CONCAT(
              ''S:'', CONVERT(VARCHAR(20), StudentId),
              '':CC:'', UPPER(LTRIM(RTRIM(CourseCode)))
            )
          ELSE NULL
        END
      ) PERSISTED;
    ';
  END

  -- Previous attempts may have created a partially compatible index name.
  IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
      AND name = 'UX_DocumentUpload_ContextKey_Active'
  )
  BEGIN
    EXEC sp_executesql N'
      DROP INDEX UX_DocumentUpload_ContextKey_Active ON dbo.DocumentUpload;
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
      AND name = 'UX_DocumentUpload_TeacherContext_Active'
  )
  BEGIN
    EXEC sp_executesql N'
      CREATE UNIQUE INDEX UX_DocumentUpload_TeacherContext_Active
        ON dbo.DocumentUpload(TeacherId, ClassId, CourseCode)
        WHERE TeacherId IS NOT NULL
          AND ClassId IS NOT NULL
          AND CourseCode IS NOT NULL
          AND DeletedAtUtc IS NULL
          AND Status <> ''DeletedByUser'';
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
      AND name = 'UX_DocumentUpload_StudentContext_Active'
  )
  BEGIN
    EXEC sp_executesql N'
      CREATE UNIQUE INDEX UX_DocumentUpload_StudentContext_Active
        ON dbo.DocumentUpload(StudentId, CourseCode)
        WHERE StudentId IS NOT NULL
          AND CourseCode IS NOT NULL
          AND TeacherId IS NULL
          AND DeletedAtUtc IS NULL
          AND Status <> ''DeletedByUser'';
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
      AND name = 'IX_DocumentUpload_Teacher_Class_Course'
  )
  BEGIN
    EXEC sp_executesql N'
      CREATE INDEX IX_DocumentUpload_Teacher_Class_Course
        ON dbo.DocumentUpload(TeacherId, ClassId, CourseCode, UploadedAtUtc DESC);
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
      AND name = 'IX_DocumentUpload_Student_Course'
  )
  BEGIN
    EXEC sp_executesql N'
      CREATE INDEX IX_DocumentUpload_Student_Course
        ON dbo.DocumentUpload(StudentId, CourseCode, UploadedAtUtc DESC);
    ';
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
      AND name = 'IX_DocumentUpload_Status'
  )
  BEGIN
    EXEC sp_executesql N'
      CREATE INDEX IX_DocumentUpload_Status
        ON dbo.DocumentUpload(Status, UploadedAtUtc DESC);
    ';
  END

  COMMIT;
  PRINT 'SUCCESS: DocumentUpload Phase 0 + Phase 1 schema extensions ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
