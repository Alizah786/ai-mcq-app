/*
  Migration: Seed default Student subscription plans
  Date: 2026-02-22

  Adds (if missing):
    - Student Free Trial
    - Student Basic
    - Student Pro

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  DECLARE @HasAppliesToRole BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'AppliesToRole') IS NULL THEN 0 ELSE 1 END;
  DECLARE @HasAnalyticsLevel BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'AnalyticsLevel') IS NULL THEN 0 ELSE 1 END;
  DECLARE @sql NVARCHAR(MAX);

  IF @HasAppliesToRole = 1 AND @HasAnalyticsLevel = 1
  BEGIN
    SET @sql = N'
      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Free Trial'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive, AppliesToRole, AnalyticsLevel)
        VALUES
          (''Student Free Trial'', 0, 15, 25, 0, 1, ''Student'', ''Advanced'');
      END;

      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Basic'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive, AppliesToRole, AnalyticsLevel)
        VALUES
          (''Student Basic'', 4.99, 30, 50, 0, 1, ''Student'', ''Basic'');
      END;

      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Pro'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive, AppliesToRole, AnalyticsLevel)
        VALUES
          (''Student Pro'', 7.99, 30, 200, 0, 1, ''Student'', ''Advanced'');
      END;
    ';
    EXEC sp_executesql @sql;
  END
  ELSE IF @HasAppliesToRole = 1
  BEGIN
    SET @sql = N'
      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Free Trial'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive, AppliesToRole)
        VALUES
          (''Student Free Trial'', 0, 15, 25, 0, 1, ''Student'');
      END;

      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Basic'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive, AppliesToRole)
        VALUES
          (''Student Basic'', 4.99, 30, 50, 0, 1, ''Student'');
      END;

      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Pro'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive, AppliesToRole)
        VALUES
          (''Student Pro'', 7.99, 30, 200, 0, 1, ''Student'');
      END;
    ';
    EXEC sp_executesql @sql;
  END
  ELSE
  BEGIN
    SET @sql = N'
      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Free Trial'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive)
        VALUES
          (''Student Free Trial'', 0, 15, 25, 0, 1);
      END;

      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Basic'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive)
        VALUES
          (''Student Basic'', 4.99, 30, 50, 0, 1);
      END;

      IF NOT EXISTS (SELECT 1 FROM dbo.SubscriptionPlan WHERE PlanName = ''Student Pro'')
      BEGIN
        INSERT INTO dbo.SubscriptionPlan
          (PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive)
        VALUES
          (''Student Pro'', 7.99, 30, 200, 0, 1);
      END;
    ';
    EXEC sp_executesql @sql;
  END;

  COMMIT;
  PRINT 'SUCCESS: Student subscription plans ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO
