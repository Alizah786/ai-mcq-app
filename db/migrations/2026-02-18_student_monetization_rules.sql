/*
  Migration: Student monetization rules
  Date: 2026-02-18

  Adds:
    - AppliesToRole, AnalyticsLevel to dbo.SubscriptionPlan
    - dbo.StudentSubscription
    - Seeds student plans (trial/basic/pro)

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.SubscriptionPlan', 'AppliesToRole') IS NULL
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
    ADD AppliesToRole NVARCHAR(20) NOT NULL
      CONSTRAINT DF_SubscriptionPlan_AppliesToRole DEFAULT ('Both');
  END;

  IF COL_LENGTH('dbo.SubscriptionPlan', 'AnalyticsLevel') IS NULL
  BEGIN
    ALTER TABLE dbo.SubscriptionPlan
    ADD AnalyticsLevel NVARCHAR(20) NOT NULL
      CONSTRAINT DF_SubscriptionPlan_AnalyticsLevel DEFAULT ('Basic');
  END;

  IF OBJECT_ID('dbo.StudentSubscription', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.StudentSubscription (
      StudentSubscriptionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StudentSubscription PRIMARY KEY,
      StudentId INT NOT NULL,
      PlanType NVARCHAR(20) NOT NULL, -- FREE / BASIC / PRO
      StartDate DATETIME2 NOT NULL,
      ExpiryDate DATETIME2 NOT NULL,
      AIPracticeUsed INT NOT NULL CONSTRAINT DF_StudentSubscription_AIPracticeUsed DEFAULT (0),
      IsActive BIT NOT NULL CONSTRAINT DF_StudentSubscription_IsActive DEFAULT (1)
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.StudentSubscription')
      AND name = 'IX_StudentSubscription_StudentActive'
  )
  BEGIN
    CREATE INDEX IX_StudentSubscription_StudentActive
      ON dbo.StudentSubscription (StudentId, IsActive, ExpiryDate DESC);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_StudentSubscription_Student'
      AND parent_object_id = OBJECT_ID('dbo.StudentSubscription')
  )
  BEGIN
    ALTER TABLE dbo.StudentSubscription
    ADD CONSTRAINT FK_StudentSubscription_Student
      FOREIGN KEY (StudentId) REFERENCES dbo.Student(StudentId);
  END;

  -- Normalize existing seeded plans to Teacher scope
  UPDATE dbo.SubscriptionPlan
  SET AppliesToRole = 'Teacher',
      AnalyticsLevel = 'Advanced'
  WHERE PlanName IN ('Free Trial', 'Basic Teacher Plan', 'Pro Teacher Plan');

  MERGE dbo.SubscriptionPlan AS target
  USING (
    SELECT
      CAST(N'Student Free Trial' AS NVARCHAR(150)) AS PlanName,
      CAST(0.00 AS DECIMAL(10,2)) AS Price,
      CAST(15 AS INT) AS DurationDays,
      CAST(25 AS INT) AS AIQuizLimit,
      CAST(0 AS INT) AS ManualQuizLimit,
      CAST(1 AS BIT) AS IsActive,
      CAST(N'Student' AS NVARCHAR(20)) AS AppliesToRole,
      CAST(N'Advanced' AS NVARCHAR(20)) AS AnalyticsLevel
    UNION ALL
    SELECT
      N'Student Basic',
      CAST(4.99 AS DECIMAL(10,2)),
      30,
      50,
      0,
      CAST(1 AS BIT),
      N'Student',
      N'Basic'
    UNION ALL
    SELECT
      N'Student Pro',
      CAST(7.99 AS DECIMAL(10,2)),
      30,
      200,
      0,
      CAST(1 AS BIT),
      N'Student',
      N'Advanced'
  ) AS source
  ON target.PlanName = source.PlanName
  WHEN MATCHED THEN
    UPDATE SET
      target.Price = source.Price,
      target.DurationDays = source.DurationDays,
      target.AIQuizLimit = source.AIQuizLimit,
      target.ManualQuizLimit = source.ManualQuizLimit,
      target.IsActive = source.IsActive,
      target.AppliesToRole = source.AppliesToRole,
      target.AnalyticsLevel = source.AnalyticsLevel
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive, AppliesToRole, AnalyticsLevel)
    VALUES (source.PlanName, source.Price, source.DurationDays, source.AIQuizLimit, source.ManualQuizLimit, source.IsActive, source.AppliesToRole, source.AnalyticsLevel);

  COMMIT;
  PRINT 'SUCCESS: Student monetization plans and StudentSubscription table ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

