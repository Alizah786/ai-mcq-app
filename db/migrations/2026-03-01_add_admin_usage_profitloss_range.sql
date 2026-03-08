SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.UsageEvent', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.UsageEvent (
    UsageEventId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UsageEvent PRIMARY KEY,
    UserNameRegistryId INT NOT NULL,
    EventType NVARCHAR(50) NOT NULL,
    Quantity INT NOT NULL CONSTRAINT DF_UsageEvent_Quantity DEFAULT (1),
    CostUsd DECIMAL(10,4) NULL,
    CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_UsageEvent_CreatedAtUtc DEFAULT (SYSUTCDATETIME())
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_UsageEvent_UserNameRegistry'
    AND parent_object_id = OBJECT_ID('dbo.UsageEvent')
)
BEGIN
  ALTER TABLE dbo.UsageEvent
    ADD CONSTRAINT FK_UsageEvent_UserNameRegistry
    FOREIGN KEY (UserNameRegistryId) REFERENCES dbo.UserNameRegistry(UserNameRegistryId);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.UsageEvent')
    AND name = 'IX_UsageEvent_Date'
)
BEGIN
  CREATE INDEX IX_UsageEvent_Date
    ON dbo.UsageEvent(CreatedAtUtc);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.UsageEvent')
    AND name = 'IX_UsageEvent_User_Date'
)
BEGIN
  CREATE INDEX IX_UsageEvent_User_Date
    ON dbo.UsageEvent(UserNameRegistryId, CreatedAtUtc DESC);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.UsageEvent')
    AND name = 'IX_UsageEvent_Type_Date'
)
BEGIN
  CREATE INDEX IX_UsageEvent_Type_Date
    ON dbo.UsageEvent(EventType, CreatedAtUtc);
END;
GO

IF OBJECT_ID('dbo.ProfitLossSnapshot', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProfitLossSnapshot (
    ProfitLossSnapshotId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProfitLossSnapshot PRIMARY KEY,
    FromDate DATE NOT NULL,
    ToDate DATE NOT NULL,
    ActivePaidUsers INT NOT NULL CONSTRAINT DF_ProfitLossSnapshot_ActivePaidUsers DEFAULT (0),
    ActiveFreeUsers INT NOT NULL CONSTRAINT DF_ProfitLossSnapshot_ActiveFreeUsers DEFAULT (0),
    RevenueUsd DECIMAL(12,2) NOT NULL CONSTRAINT DF_ProfitLossSnapshot_RevenueUsd DEFAULT (0),
    AiCostUsd DECIMAL(12,2) NOT NULL CONSTRAINT DF_ProfitLossSnapshot_AiCostUsd DEFAULT (0),
    MonthlyOverheadUsd DECIMAL(12,2) NOT NULL CONSTRAINT DF_ProfitLossSnapshot_MonthlyOverheadUsd DEFAULT (0),
    OverageCostUsd DECIMAL(12,2) NOT NULL CONSTRAINT DF_ProfitLossSnapshot_OverageCostUsd DEFAULT (0),
    PotentialChurnLossUsd DECIMAL(12,2) NOT NULL CONSTRAINT DF_ProfitLossSnapshot_PotentialChurnLossUsd DEFAULT (0),
    NetUsd AS (RevenueUsd - AiCostUsd - MonthlyOverheadUsd - OverageCostUsd - PotentialChurnLossUsd) PERSISTED,
    CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_ProfitLossSnapshot_CreatedAtUtc DEFAULT (SYSUTCDATETIME())
  );
END;
GO

IF COL_LENGTH('dbo.ProfitLossSnapshot', 'MonthlyOverheadUsd') IS NULL
BEGIN
  ALTER TABLE dbo.ProfitLossSnapshot
    ADD MonthlyOverheadUsd DECIMAL(12,2) NOT NULL
      CONSTRAINT DF_ProfitLossSnapshot_MonthlyOverheadUsd DEFAULT (0);
END;
GO

IF OBJECT_ID('dbo.AdminAnalyticsSettings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AdminAnalyticsSettings (
    SettingsId INT NOT NULL CONSTRAINT PK_AdminAnalyticsSettings PRIMARY KEY,
    MonthlyOverheadUsd DECIMAL(12,2) NOT NULL CONSTRAINT DF_AdminAnalyticsSettings_MonthlyOverheadUsd DEFAULT (0),
    CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_AdminAnalyticsSettings_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    LastModifiedUtc DATETIME2 NULL
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AdminAnalyticsSettings WHERE SettingsId = 1)
BEGIN
  INSERT INTO dbo.AdminAnalyticsSettings (SettingsId, MonthlyOverheadUsd, CreatedAtUtc, LastModifiedUtc)
  VALUES (1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
END;
GO

IF EXISTS (
  SELECT 1
  FROM sys.computed_columns
  WHERE object_id = OBJECT_ID('dbo.ProfitLossSnapshot')
    AND name = 'NetUsd'
    AND definition NOT LIKE '%MonthlyOverheadUsd%'
)
BEGIN
  ALTER TABLE dbo.ProfitLossSnapshot DROP COLUMN NetUsd;
  ALTER TABLE dbo.ProfitLossSnapshot
    ADD NetUsd AS (RevenueUsd - AiCostUsd - MonthlyOverheadUsd - OverageCostUsd - PotentialChurnLossUsd) PERSISTED;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.ProfitLossSnapshot')
    AND name = 'UX_ProfitLossSnapshot_From_To'
)
BEGIN
  CREATE UNIQUE INDEX UX_ProfitLossSnapshot_From_To
    ON dbo.ProfitLossSnapshot(FromDate, ToDate);
END;
GO

CREATE OR ALTER PROCEDURE dbo.Admin_GetUsageSummaryByRange
  @FromDate DATE,
  @ToDate DATE
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @ToDateExclusive DATETIME2 = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME2));

  ;WITH RangedEvents AS (
    SELECT ue.UserNameRegistryId, ue.EventType, ue.Quantity, ue.CostUsd, ue.CreatedAtUtc
    FROM dbo.UsageEvent ue
    WHERE ue.CreatedAtUtc >= CAST(@FromDate AS DATETIME2)
      AND ue.CreatedAtUtc < @ToDateExclusive
  ),
  LatestPlan AS (
    SELECT
      u.UserRole,
      u.UserId,
      sp.AIQuizLimit,
      ROW_NUMBER() OVER (PARTITION BY u.UserRole, u.UserId ORDER BY u.UserSubscriptionId DESC) AS rn
    FROM dbo.UserSubscription u
    JOIN dbo.SubscriptionPlan sp
      ON sp.PlanId = u.PlanId
    WHERE u.IsActive = 1
  ),
  UserAgg AS (
    SELECT
      re.UserNameRegistryId,
      SUM(CASE WHEN re.EventType IN ('AI_QUESTION','AI_JOB') THEN re.Quantity ELSE 0 END) AS AiUsage,
      SUM(re.Quantity) AS TotalUsage,
      MAX(re.CreatedAtUtc) AS LastActivityUtc
    FROM RangedEvents re
    GROUP BY re.UserNameRegistryId
  )
  SELECT
    @FromDate AS FromDate,
    @ToDate AS ToDate,
    (SELECT COUNT(DISTINCT UserNameRegistryId) FROM RangedEvents) AS DistinctActiveUsers,
    ISNULL((SELECT SUM(Quantity) FROM RangedEvents), 0) AS TotalQuantity,
    ISNULL((SELECT SUM(ISNULL(CostUsd, 0)) FROM RangedEvents), 0) AS TotalTrackedCostUsd,
    (
      SELECT
        re.EventType AS eventType,
        SUM(re.Quantity) AS totalQuantity,
        COUNT(1) AS eventCount,
        CAST(SUM(ISNULL(re.CostUsd, 0)) AS DECIMAL(12,4)) AS totalCostUsd
      FROM RangedEvents re
      GROUP BY re.EventType
      ORDER BY SUM(re.Quantity) DESC, re.EventType
      FOR JSON PATH
    ) AS TotalsByEventTypeJson,
    (
      SELECT TOP (50)
        ua.UserNameRegistryId AS userNameRegistryId,
        ur.UserName AS userName,
        ur.UserType AS userType,
        ua.AiUsage AS aiUsage,
        ua.TotalUsage AS totalUsage,
        lp.AIQuizLimit AS aiLimit,
        CAST(CASE
          WHEN ISNULL(lp.AIQuizLimit, 0) > 0 THEN CAST(ua.AiUsage AS DECIMAL(12,4)) / NULLIF(lp.AIQuizLimit, 0)
          ELSE NULL
        END AS DECIMAL(12,4)) AS usagePctOfLimit,
        ua.LastActivityUtc AS lastActivityUtc
      FROM UserAgg ua
      JOIN dbo.UserNameRegistry ur
        ON ur.UserNameRegistryId = ua.UserNameRegistryId
      LEFT JOIN LatestPlan lp
        ON lp.UserRole = CASE WHEN ur.UserType = 'TEACHER' THEN 'Teacher' WHEN ur.UserType = 'STUDENT' THEN 'Student' ELSE ur.UserType END
       AND lp.UserId = ur.UserId
       AND lp.rn = 1
      ORDER BY ua.AiUsage DESC, ua.TotalUsage DESC, ur.UserName
      FOR JSON PATH
    ) AS TopUsersJson;
END;
GO

CREATE OR ALTER PROCEDURE dbo.Admin_GetProfitLossByRange
  @FromDate DATE,
  @ToDate DATE,
  @UnitCostPerAiQuestion DECIMAL(10,4) = 0.0200,
  @MonthlyOverheadUsd DECIMAL(12,2) = 0.00
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @ToDateExclusive DATETIME2 = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME2));
  DECLARE @RangeDays INT = DATEDIFF(DAY, @FromDate, @ToDate) + 1;

  ;WITH PaidOverlap AS (
    SELECT
      p.UserNameRegistryId,
      p.PlanCode,
      p.Amount,
      CAST(p.PlanStartUtc AS DATE) AS PlanStartDate,
      CAST(COALESCE(p.PlanEndUtc, @ToDate) AS DATE) AS PlanEndDate,
      ISNULL(sp.AIQuizLimit, 0) AS AiLimit,
      ISNULL(sp.Price, 0) AS PlanPrice
    FROM dbo.Payments p
    LEFT JOIN dbo.SubscriptionPlan sp
      ON sp.PlanName = CASE p.PlanCode
        WHEN 'FREE_TRIAL' THEN 'Free Trial'
        WHEN 'BASIC_TEACHER' THEN 'Basic Teacher Plan'
        WHEN 'PRO_TEACHER' THEN 'Pro Teacher Plan'
        WHEN 'FREE_STUDENT' THEN 'Student Free Trial'
        WHEN 'STUDENT_BASIC' THEN 'Student Basic'
        WHEN 'STUDENT_PRO' THEN 'Student Pro'
        ELSE NULL
      END
    WHERE p.PaymentStatus = 'ACTIVE'
      AND p.IsActive = 1
      AND NULLIF(LTRIM(RTRIM(ISNULL(p.StripeInvoiceId, ''))), '') IS NOT NULL
      AND ISNULL(p.PlanCode, '') NOT IN ('FREE_TRIAL', 'FREE_STUDENT')
      AND CAST(COALESCE(p.PlanEndUtc, @ToDate) AS DATE) >= @FromDate
      AND CAST(COALESCE(p.PlanStartUtc, @FromDate) AS DATE) <= @ToDate
  ),
  PaidRevenue AS (
    SELECT
      po.UserNameRegistryId,
      po.AiLimit,
      CAST(
        (COALESCE(NULLIF(po.Amount, 0), po.PlanPrice, 0) / 30.0) *
        CASE
          WHEN DATEDIFF(DAY,
            CASE WHEN po.PlanStartDate > @FromDate THEN po.PlanStartDate ELSE @FromDate END,
            CASE WHEN po.PlanEndDate < @ToDate THEN po.PlanEndDate ELSE @ToDate END
          ) + 1 > 0
          THEN DATEDIFF(DAY,
            CASE WHEN po.PlanStartDate > @FromDate THEN po.PlanStartDate ELSE @FromDate END,
            CASE WHEN po.PlanEndDate < @ToDate THEN po.PlanEndDate ELSE @ToDate END
          ) + 1
          ELSE 0
        END
      AS DECIMAL(12,4)) AS ProRatedRevenueUsd
    FROM PaidOverlap po
  ),
  RangedEvents AS (
    SELECT ue.UserNameRegistryId, ue.EventType, ue.Quantity, ue.CostUsd, ue.CreatedAtUtc
    FROM dbo.UsageEvent ue
    WHERE ue.CreatedAtUtc >= CAST(@FromDate AS DATETIME2)
      AND ue.CreatedAtUtc < @ToDateExclusive
  ),
  AiUsage AS (
    SELECT
      re.UserNameRegistryId,
      SUM(CASE WHEN re.EventType IN ('AI_QUESTION','AI_JOB') THEN re.Quantity ELSE 0 END) AS AiUsed,
      SUM(CASE WHEN re.EventType IN ('AI_QUESTION','AI_JOB') AND re.CostUsd IS NULL THEN re.Quantity ELSE 0 END) AS AiUnitsWithoutCost,
      SUM(CASE WHEN re.EventType IN ('AI_QUESTION','AI_JOB') THEN ISNULL(re.CostUsd, 0) ELSE 0 END) AS KnownAiCostUsd
    FROM RangedEvents re
    GROUP BY re.UserNameRegistryId
  ),
  LastActivity AS (
    SELECT
      ue.UserNameRegistryId,
      MAX(ue.CreatedAtUtc) AS LastActivityUtc
    FROM dbo.UsageEvent ue
    WHERE ue.CreatedAtUtc < @ToDateExclusive
    GROUP BY ue.UserNameRegistryId
  ),
  PaidUserRisk AS (
    SELECT
      pr.UserNameRegistryId,
      pr.ProRatedRevenueUsd,
      pr.AiLimit,
      ISNULL(au.AiUsed, 0) AS AiUsed,
      la.LastActivityUtc,
      CASE
        WHEN la.LastActivityUtc IS NULL THEN 0.60
        WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @ToDate) >= 10 THEN 0.60
        WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @ToDate) >= 7 THEN 0.40
        WHEN ISNULL(pr.AiLimit, 0) > 0 AND (CAST(ISNULL(au.AiUsed, 0) AS DECIMAL(12,4)) / NULLIF(pr.AiLimit, 0)) < 0.20 THEN 0.25
        ELSE 0.10
      END AS ChurnProbability
    FROM PaidRevenue pr
    LEFT JOIN AiUsage au
      ON au.UserNameRegistryId = pr.UserNameRegistryId
    LEFT JOIN LastActivity la
      ON la.UserNameRegistryId = pr.UserNameRegistryId
  )
  SELECT
    @FromDate AS FromDate,
    @ToDate AS ToDate,
    (SELECT COUNT(DISTINCT UserNameRegistryId) FROM PaidRevenue WHERE ProRatedRevenueUsd > 0) AS ActivePaidUsers,
    (
      SELECT COUNT(DISTINCT re.UserNameRegistryId)
      FROM RangedEvents re
      WHERE NOT EXISTS (
        SELECT 1
        FROM PaidRevenue pr
        WHERE pr.UserNameRegistryId = re.UserNameRegistryId
          AND pr.ProRatedRevenueUsd > 0
      )
    ) AS ActiveFreeUsers,
    CAST(ISNULL((SELECT SUM(ProRatedRevenueUsd) FROM PaidRevenue), 0) AS DECIMAL(12,2)) AS RevenueUsd,
    CAST(ISNULL((
      SELECT SUM(ISNULL(KnownAiCostUsd, 0) + (ISNULL(AiUnitsWithoutCost, 0) * @UnitCostPerAiQuestion))
      FROM AiUsage
    ), 0) AS DECIMAL(12,2)) AS AiCostUsd,
    CAST(ISNULL((
      SELECT SUM(CASE WHEN ISNULL(au.AiUsed, 0) > ISNULL(pr.AiLimit, 0)
        THEN (ISNULL(au.AiUsed, 0) - ISNULL(pr.AiLimit, 0)) * @UnitCostPerAiQuestion
        ELSE 0 END)
      FROM PaidRevenue pr
      LEFT JOIN AiUsage au
        ON au.UserNameRegistryId = pr.UserNameRegistryId
    ), 0) AS DECIMAL(12,2)) AS OverageCostUsd,
    CAST((@MonthlyOverheadUsd / 30.0) * CASE WHEN @RangeDays > 0 THEN @RangeDays ELSE 0 END AS DECIMAL(12,2)) AS MonthlyOverheadUsd,
    CAST(ISNULL((
      SELECT SUM(ProRatedRevenueUsd * ChurnProbability)
      FROM PaidUserRisk
    ), 0) AS DECIMAL(12,2)) AS PotentialChurnLossUsd;
END;
GO
