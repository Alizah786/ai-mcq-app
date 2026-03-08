/*
  Migration: Add class export visibility flags
  Date: 2026-03-04

  Adds:
    - Class.ShowClassNameOnExport
    - Class.ShowSubjectOnExport
    - Class.ShowGradeLevelOnExport
    - Class.ShowCourseCodeOnExport
    - Class.ShowTermOnExport
*/

USE AiMcqApp;

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.Class', 'ShowClassNameOnExport') IS NULL
  BEGIN
    ALTER TABLE dbo.Class ADD ShowClassNameOnExport BIT NOT NULL CONSTRAINT DF_Class_ShowClassNameOnExport DEFAULT (1);
  END

  IF COL_LENGTH('dbo.Class', 'ShowSubjectOnExport') IS NULL
  BEGIN
    ALTER TABLE dbo.Class ADD ShowSubjectOnExport BIT NOT NULL CONSTRAINT DF_Class_ShowSubjectOnExport DEFAULT (0);
  END

  IF COL_LENGTH('dbo.Class', 'ShowGradeLevelOnExport') IS NULL
  BEGIN
    ALTER TABLE dbo.Class ADD ShowGradeLevelOnExport BIT NOT NULL CONSTRAINT DF_Class_ShowGradeLevelOnExport DEFAULT (0);
  END

  IF COL_LENGTH('dbo.Class', 'ShowCourseCodeOnExport') IS NULL
  BEGIN
    ALTER TABLE dbo.Class ADD ShowCourseCodeOnExport BIT NOT NULL CONSTRAINT DF_Class_ShowCourseCodeOnExport DEFAULT (1);
  END

  IF COL_LENGTH('dbo.Class', 'ShowTermOnExport') IS NULL
  BEGIN
    ALTER TABLE dbo.Class ADD ShowTermOnExport BIT NOT NULL CONSTRAINT DF_Class_ShowTermOnExport DEFAULT (1);
  END

  COMMIT;
  PRINT 'SUCCESS: Class export visibility flags ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
