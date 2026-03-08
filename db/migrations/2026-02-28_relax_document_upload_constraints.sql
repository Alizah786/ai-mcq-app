SET NOCOUNT ON;

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID('dbo.SubscriptionPlan')
    AND name = 'CK_SubscriptionPlan_DocumentUploadLimit_0_5'
)
BEGIN
  ALTER TABLE dbo.SubscriptionPlan
    DROP CONSTRAINT CK_SubscriptionPlan_DocumentUploadLimit_0_5;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID('dbo.SubscriptionPlan')
    AND name = 'CK_SubscriptionPlan_DocumentUploadLimit_0_1000'
)
BEGIN
  ALTER TABLE dbo.SubscriptionPlan
    ADD CONSTRAINT CK_SubscriptionPlan_DocumentUploadLimit_0_1000
      CHECK (DocumentUploadLimit >= 0 AND DocumentUploadLimit <= 1000);
END;

IF EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
    AND name = 'UX_DocumentUpload_TeacherContext_Active'
)
BEGIN
  DROP INDEX UX_DocumentUpload_TeacherContext_Active ON dbo.DocumentUpload;
END;

IF EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.DocumentUpload')
    AND name = 'UX_DocumentUpload_StudentContext_Active'
)
BEGIN
  DROP INDEX UX_DocumentUpload_StudentContext_Active ON dbo.DocumentUpload;
END;
