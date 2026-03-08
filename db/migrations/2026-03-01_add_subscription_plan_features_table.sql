IF OBJECT_ID('dbo.SubscriptionPlanFeature', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SubscriptionPlanFeature
  (
    SubscriptionPlanFeatureId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    PlanId INT NOT NULL,
    DisplayOrder INT NOT NULL,
    FeatureText NVARCHAR(200) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_SubscriptionPlanFeature_IsActive DEFAULT (1),
    CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_SubscriptionPlanFeature_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_SubscriptionPlanFeature_UpdatedAtUtc DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_SubscriptionPlanFeature_SubscriptionPlan'
)
BEGIN
  ALTER TABLE dbo.SubscriptionPlanFeature
    ADD CONSTRAINT FK_SubscriptionPlanFeature_SubscriptionPlan
    FOREIGN KEY (PlanId) REFERENCES dbo.SubscriptionPlan(PlanId);
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_SubscriptionPlanFeature_Plan_DisplayOrder'
    AND object_id = OBJECT_ID('dbo.SubscriptionPlanFeature')
)
BEGIN
  CREATE UNIQUE INDEX UX_SubscriptionPlanFeature_Plan_DisplayOrder
    ON dbo.SubscriptionPlanFeature(PlanId, DisplayOrder);
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_SubscriptionPlanFeature_Plan_IsActive'
    AND object_id = OBJECT_ID('dbo.SubscriptionPlanFeature')
)
BEGIN
  CREATE INDEX IX_SubscriptionPlanFeature_Plan_IsActive
    ON dbo.SubscriptionPlanFeature(PlanId, IsActive, DisplayOrder);
END;
GO
