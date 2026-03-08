SET NOCOUNT ON;

IF COL_LENGTH('dbo.StudyMaterialVersion', 'AssignmentsJson') IS NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialVersion
    ADD AssignmentsJson NVARCHAR(MAX) NULL;
END;
