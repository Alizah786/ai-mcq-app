/*
  Migration: Add LocalePreference to principal user tables
  Notes:
    - App uses role tables (Teacher/Student/Principal/AppAdmin), not a single Users table.
    - Allowed values: auto, en-US, en-CA, en-GB, en-AU
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @allowed NVARCHAR(200) = '''auto'',''en-US'',''en-CA'',''en-GB'',''en-AU''';

IF COL_LENGTH('dbo.Teacher', 'LocalePreference') IS NULL
BEGIN
  ALTER TABLE dbo.Teacher ADD LocalePreference NVARCHAR(10) NULL;
END;
IF COL_LENGTH('dbo.Student', 'LocalePreference') IS NULL
BEGIN
  ALTER TABLE dbo.Student ADD LocalePreference NVARCHAR(10) NULL;
END;
IF COL_LENGTH('dbo.Principal', 'LocalePreference') IS NULL
BEGIN
  ALTER TABLE dbo.Principal ADD LocalePreference NVARCHAR(10) NULL;
END;
IF COL_LENGTH('dbo.AppAdmin', 'LocalePreference') IS NULL
BEGIN
  ALTER TABLE dbo.AppAdmin ADD LocalePreference NVARCHAR(10) NULL;
END;

UPDATE dbo.Teacher SET LocalePreference = 'auto' WHERE LocalePreference IS NULL;
UPDATE dbo.Student SET LocalePreference = 'auto' WHERE LocalePreference IS NULL;
UPDATE dbo.Principal SET LocalePreference = 'auto' WHERE LocalePreference IS NULL;
UPDATE dbo.AppAdmin SET LocalePreference = 'auto' WHERE LocalePreference IS NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Teacher_LocalePreference_Allowed'
)
BEGIN
  EXEC('ALTER TABLE dbo.Teacher WITH NOCHECK ADD CONSTRAINT CK_Teacher_LocalePreference_Allowed CHECK (LocalePreference IN (' + @allowed + '))');
END;
IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Student_LocalePreference_Allowed'
)
BEGIN
  EXEC('ALTER TABLE dbo.Student WITH NOCHECK ADD CONSTRAINT CK_Student_LocalePreference_Allowed CHECK (LocalePreference IN (' + @allowed + '))');
END;
IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Principal_LocalePreference_Allowed'
)
BEGIN
  EXEC('ALTER TABLE dbo.Principal WITH NOCHECK ADD CONSTRAINT CK_Principal_LocalePreference_Allowed CHECK (LocalePreference IN (' + @allowed + '))');
END;
IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AppAdmin_LocalePreference_Allowed'
)
BEGIN
  EXEC('ALTER TABLE dbo.AppAdmin WITH NOCHECK ADD CONSTRAINT CK_AppAdmin_LocalePreference_Allowed CHECK (LocalePreference IN (' + @allowed + '))');
END;

COMMIT TRANSACTION;
