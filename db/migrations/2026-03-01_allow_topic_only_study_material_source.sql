SET NOCOUNT ON;

IF OBJECT_ID('dbo.CK_StudyMaterialSet_SourceType', 'C') IS NOT NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet DROP CONSTRAINT CK_StudyMaterialSet_SourceType;
END;

ALTER TABLE dbo.StudyMaterialSet WITH CHECK
ADD CONSTRAINT CK_StudyMaterialSet_SourceType
CHECK (SourceType IN ('Document','PastedText','Image','TopicOnly'));

IF OBJECT_ID('dbo.CK_StudyMaterialSet_SourceConsistency', 'C') IS NOT NULL
BEGIN
  ALTER TABLE dbo.StudyMaterialSet DROP CONSTRAINT CK_StudyMaterialSet_SourceConsistency;
END;

ALTER TABLE dbo.StudyMaterialSet WITH CHECK
ADD CONSTRAINT CK_StudyMaterialSet_SourceConsistency
CHECK (
  (SourceType = 'Document' AND DocumentUploadId IS NOT NULL AND PastedText IS NULL)
  OR
  (SourceType = 'PastedText' AND DocumentUploadId IS NULL AND PastedText IS NOT NULL)
  OR
  (SourceType = 'Image' AND DocumentUploadId IS NULL AND PastedText IS NOT NULL)
  OR
  (SourceType = 'TopicOnly' AND DocumentUploadId IS NULL AND PastedText IS NOT NULL)
);
