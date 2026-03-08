SET NOCOUNT ON;

IF COL_LENGTH('dbo.SubscriptionPlan', 'DocumentUploadLimit') IS NULL
BEGIN
  ALTER TABLE dbo.SubscriptionPlan
  ADD DocumentUploadLimit INT NULL;
END
GO

IF OBJECT_ID('DF_SubscriptionPlan_DocumentUploadLimit', 'D') IS NULL
BEGIN
  ALTER TABLE dbo.SubscriptionPlan
  ADD CONSTRAINT DF_SubscriptionPlan_DocumentUploadLimit DEFAULT (0) FOR DocumentUploadLimit;
END
GO

UPDATE dbo.SubscriptionPlan
SET DocumentUploadLimit = CASE
  WHEN DocumentUploadLimit IS NULL THEN 0
  WHEN DocumentUploadLimit < 0 THEN 0
  WHEN DocumentUploadLimit > 5 THEN 5
  ELSE DocumentUploadLimit
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = 'CK_SubscriptionPlan_DocumentUploadLimit_0_5'
    AND parent_object_id = OBJECT_ID('dbo.SubscriptionPlan')
)
BEGIN
  ALTER TABLE dbo.SubscriptionPlan
  ADD CONSTRAINT CK_SubscriptionPlan_DocumentUploadLimit_0_5
  CHECK (DocumentUploadLimit >= 0 AND DocumentUploadLimit <= 5);
END
GO
