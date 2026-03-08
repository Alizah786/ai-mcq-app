const { TYPES } = require("tedious");
const { execQuery } = require("../db");

const DEFAULT_AI_UNIT_COST = Number(process.env.ADMIN_AI_UNIT_COST_USD || 0.02);

function toSqlDate(dateString) {
  return new Date(`${String(dateString).trim()}T00:00:00.000Z`);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRegistryRoleToSubscriptionRole(userType) {
  const normalized = String(userType || "").toUpperCase();
  if (normalized === "TEACHER") return "Teacher";
  if (normalized === "STUDENT") return "Student";
  if (normalized === "PRINCIPAL") return "Principal";
  return normalized || "Teacher";
}

async function getMonthlyOverheadSetting() {
  try {
    const result = await execQuery(
      `SELECT TOP 1 MonthlyOverheadUsd
       FROM dbo.AdminAnalyticsSettings
       WHERE SettingsId = 1`
    );
    return Number(result.rows[0]?.MonthlyOverheadUsd || 0);
  } catch {
    return 0;
  }
}

async function setMonthlyOverheadSetting(monthlyOverheadUsd) {
  await execQuery(
    `MERGE dbo.AdminAnalyticsSettings AS target
     USING (SELECT CAST(1 AS INT) AS SettingsId) AS source
       ON target.SettingsId = source.SettingsId
     WHEN MATCHED THEN
       UPDATE SET MonthlyOverheadUsd = @monthlyOverheadUsd,
                  LastModifiedUtc = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN
       INSERT (SettingsId, MonthlyOverheadUsd, CreatedAtUtc, LastModifiedUtc)
       VALUES (1, @monthlyOverheadUsd, SYSUTCDATETIME(), SYSUTCDATETIME());`,
    [
      {
        name: "monthlyOverheadUsd",
        type: TYPES.Decimal,
        value: Number(monthlyOverheadUsd || 0),
        options: { precision: 12, scale: 2 },
      },
    ]
  );
  return { monthlyOverheadUsd: Number(monthlyOverheadUsd || 0) };
}

async function getProfitLossFallback(fromDateString, toDateString) {
  const fromDate = toSqlDate(fromDateString);
  const toDate = toSqlDate(toDateString);
  const monthlyOverheadUsd = await getMonthlyOverheadSetting();
  const result = await execQuery(
    `DECLARE @ToDateExclusive DATETIME2 = DATEADD(DAY, 1, CAST(@toDate AS DATETIME2));
     DECLARE @RangeDays INT = DATEDIFF(DAY, @fromDate, @toDate) + 1;
     WITH EligibleInvoiceUsers AS (
       SELECT DISTINCT p.UserNameRegistryId
       FROM dbo.Payments p
       WHERE p.PaymentStatus = 'ACTIVE'
         AND p.IsActive = 1
         AND NULLIF(LTRIM(RTRIM(ISNULL(p.StripeInvoiceId, ''))), '') IS NOT NULL
         AND CAST(COALESCE(p.PlanEndUtc, @toDate) AS DATE) >= @fromDate
         AND CAST(COALESCE(p.PlanStartUtc, @fromDate) AS DATE) <= @toDate
     ),
     LatestSubs AS (
       SELECT
         us.UserRole,
         us.UserId,
         us.StartDate,
         us.ExpiryDate,
         us.IsTrial,
         sp.Price,
         sp.AIQuizLimit,
         ROW_NUMBER() OVER (PARTITION BY us.UserRole, us.UserId ORDER BY us.UserSubscriptionId DESC) AS rn
       FROM dbo.UserSubscription us
       JOIN dbo.SubscriptionPlan sp
         ON sp.PlanId = us.PlanId
       WHERE us.IsActive = 1
         AND CAST(COALESCE(us.ExpiryDate, @toDate) AS DATE) >= @fromDate
         AND CAST(COALESCE(us.StartDate, @fromDate) AS DATE) <= @toDate
     ),
     ActiveSubs AS (
       SELECT
         ls.UserRole,
         ls.UserId,
         CAST(
           (ISNULL(ls.Price, 0) / 30.0) *
           CASE
             WHEN DATEDIFF(DAY,
               CASE WHEN CAST(COALESCE(ls.StartDate, @fromDate) AS DATE) > @fromDate THEN CAST(ls.StartDate AS DATE) ELSE @fromDate END,
               CASE WHEN CAST(COALESCE(ls.ExpiryDate, @toDate) AS DATE) < @toDate THEN CAST(ls.ExpiryDate AS DATE) ELSE @toDate END
             ) + 1 > 0
             THEN DATEDIFF(DAY,
               CASE WHEN CAST(COALESCE(ls.StartDate, @fromDate) AS DATE) > @fromDate THEN CAST(ls.StartDate AS DATE) ELSE @fromDate END,
               CASE WHEN CAST(COALESCE(ls.ExpiryDate, @toDate) AS DATE) < @toDate THEN CAST(ls.ExpiryDate AS DATE) ELSE @toDate END
             ) + 1
             ELSE 0
           END
         AS DECIMAL(12,4)) AS ProRatedRevenueUsd,
         ISNULL(ls.AIQuizLimit, 0) AS AiLimit,
         CAST(ISNULL(ls.IsTrial, 0) AS BIT) AS IsTrial
       FROM LatestSubs ls
       WHERE ls.rn = 1
     ),
     RegistrySubs AS (
       SELECT
         ur.UserNameRegistryId,
         ur.UserName,
         ur.UserType,
         CASE WHEN eiu.UserNameRegistryId IS NOT NULL THEN a.ProRatedRevenueUsd ELSE CAST(0 AS DECIMAL(12,4)) END AS ProRatedRevenueUsd,
         a.AiLimit,
         a.IsTrial,
         CASE WHEN eiu.UserNameRegistryId IS NOT NULL THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasRealInvoice
       FROM ActiveSubs a
       JOIN dbo.UserNameRegistry ur
         ON ur.UserType = CASE
           WHEN a.UserRole = 'Teacher' THEN 'TEACHER'
           WHEN a.UserRole = 'Student' THEN 'STUDENT'
           WHEN a.UserRole = 'Principal' THEN 'PRINCIPAL'
           ELSE UPPER(a.UserRole)
         END
        AND ur.UserId = a.UserId
        AND ur.IsActive = 1
       LEFT JOIN EligibleInvoiceUsers eiu
         ON eiu.UserNameRegistryId = ur.UserNameRegistryId
     ),
     RangedEvents AS (
       SELECT ue.UserNameRegistryId, ue.EventType, ue.Quantity, ue.CostUsd, ue.CreatedAtUtc
       FROM dbo.UsageEvent ue
       WHERE ue.CreatedAtUtc >= CAST(@fromDate AS DATETIME2)
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
       SELECT ue.UserNameRegistryId, MAX(ue.CreatedAtUtc) AS LastActivityUtc
       FROM dbo.UsageEvent ue
       WHERE ue.CreatedAtUtc < @ToDateExclusive
       GROUP BY ue.UserNameRegistryId
     ),
     PaidUserRisk AS (
       SELECT
         rs.UserNameRegistryId,
         rs.ProRatedRevenueUsd,
         rs.AiLimit,
         ISNULL(au.AiUsed, 0) AS AiUsed,
         la.LastActivityUtc,
         CASE
           WHEN la.LastActivityUtc IS NULL THEN 0.60
           WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @toDate) >= 10 THEN 0.60
           WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @toDate) >= 7 THEN 0.40
           WHEN ISNULL(rs.AiLimit, 0) > 0 AND (CAST(ISNULL(au.AiUsed, 0) AS DECIMAL(12,4)) / NULLIF(rs.AiLimit, 0)) < 0.20 THEN 0.25
           ELSE 0.10
         END AS ChurnProbability
       FROM RegistrySubs rs
       LEFT JOIN AiUsage au
         ON au.UserNameRegistryId = rs.UserNameRegistryId
       LEFT JOIN LastActivity la
         ON la.UserNameRegistryId = rs.UserNameRegistryId
       WHERE rs.IsTrial = 0
         AND rs.HasRealInvoice = 1
         AND rs.ProRatedRevenueUsd > 0
     )
     SELECT
       @fromDate AS FromDate,
       @toDate AS ToDate,
       (SELECT COUNT(1) FROM RegistrySubs WHERE IsTrial = 0 AND HasRealInvoice = 1 AND ProRatedRevenueUsd > 0) AS ActivePaidUsers,
       (SELECT COUNT(1) FROM RegistrySubs WHERE IsTrial = 1 OR HasRealInvoice = 0 OR ProRatedRevenueUsd <= 0) AS ActiveFreeUsers,
       CAST(ISNULL((SELECT SUM(ProRatedRevenueUsd) FROM RegistrySubs WHERE IsTrial = 0 AND HasRealInvoice = 1), 0) AS DECIMAL(12,2)) AS RevenueUsd,
       CAST(ISNULL((
         SELECT SUM(ISNULL(KnownAiCostUsd, 0) + (ISNULL(AiUnitsWithoutCost, 0) * @unitCostPerAiQuestion))
         FROM AiUsage
       ), 0) AS DECIMAL(12,2)) AS AiCostUsd,
       CAST(ISNULL((
         SELECT SUM(CASE WHEN ISNULL(au.AiUsed, 0) > ISNULL(rs.AiLimit, 0)
           THEN (ISNULL(au.AiUsed, 0) - ISNULL(rs.AiLimit, 0)) * @unitCostPerAiQuestion
           ELSE 0 END)
         FROM RegistrySubs rs
         LEFT JOIN AiUsage au
           ON au.UserNameRegistryId = rs.UserNameRegistryId
         WHERE rs.IsTrial = 0
           AND rs.HasRealInvoice = 1
       ), 0) AS DECIMAL(12,2)) AS OverageCostUsd,
       CAST((@monthlyOverheadUsd / 30.0) * CASE WHEN @RangeDays > 0 THEN @RangeDays ELSE 0 END AS DECIMAL(12,2)) AS MonthlyOverheadUsd,
       CAST(ISNULL((
         SELECT SUM(ProRatedRevenueUsd * ChurnProbability)
         FROM PaidUserRisk
       ), 0) AS DECIMAL(12,2)) AS PotentialChurnLossUsd;`,
    [
      { name: "fromDate", type: TYPES.Date, value: fromDate },
      { name: "toDate", type: TYPES.Date, value: toDate },
      {
        name: "monthlyOverheadUsd",
        type: TYPES.Decimal,
        value: monthlyOverheadUsd,
        options: { precision: 12, scale: 2 },
      },
      {
        name: "unitCostPerAiQuestion",
        type: TYPES.Decimal,
        value: DEFAULT_AI_UNIT_COST,
        options: { precision: 10, scale: 4 },
      },
    ]
  );
  return result.rows[0] || {};
}

async function getAtRiskUsersFallback(fromDateString, toDateString) {
  const fromDate = toSqlDate(fromDateString);
  const toDate = toSqlDate(toDateString);
  const result = await execQuery(
    `DECLARE @ToDateExclusive DATETIME2 = DATEADD(DAY, 1, CAST(@toDate AS DATETIME2));
     WITH EligibleInvoiceUsers AS (
       SELECT DISTINCT p.UserNameRegistryId
       FROM dbo.Payments p
       WHERE p.PaymentStatus = 'ACTIVE'
         AND p.IsActive = 1
         AND NULLIF(LTRIM(RTRIM(ISNULL(p.StripeInvoiceId, ''))), '') IS NOT NULL
         AND CAST(COALESCE(p.PlanEndUtc, @toDate) AS DATE) >= @fromDate
         AND CAST(COALESCE(p.PlanStartUtc, @fromDate) AS DATE) <= @toDate
     ),
     LatestSubs AS (
       SELECT
         us.UserRole,
         us.UserId,
         us.StartDate,
         us.ExpiryDate,
         us.IsTrial,
         sp.PlanName,
         sp.Price,
         sp.AIQuizLimit,
         ROW_NUMBER() OVER (PARTITION BY us.UserRole, us.UserId ORDER BY us.UserSubscriptionId DESC) AS rn
       FROM dbo.UserSubscription us
       JOIN dbo.SubscriptionPlan sp
         ON sp.PlanId = us.PlanId
       WHERE us.IsActive = 1
         AND CAST(COALESCE(us.ExpiryDate, @toDate) AS DATE) >= @fromDate
         AND CAST(COALESCE(us.StartDate, @fromDate) AS DATE) <= @toDate
     ),
     RegistrySubs AS (
       SELECT
         ur.UserNameRegistryId,
         ur.UserName,
         ur.UserType,
         ls.PlanName,
         CAST(
           (ISNULL(ls.Price, 0) / 30.0) *
           CASE
             WHEN DATEDIFF(DAY,
               CASE WHEN CAST(COALESCE(ls.StartDate, @fromDate) AS DATE) > @fromDate THEN CAST(ls.StartDate AS DATE) ELSE @fromDate END,
               CASE WHEN CAST(COALESCE(ls.ExpiryDate, @toDate) AS DATE) < @toDate THEN CAST(ls.ExpiryDate AS DATE) ELSE @toDate END
             ) + 1 > 0
             THEN DATEDIFF(DAY,
               CASE WHEN CAST(COALESCE(ls.StartDate, @fromDate) AS DATE) > @fromDate THEN CAST(ls.StartDate AS DATE) ELSE @fromDate END,
               CASE WHEN CAST(COALESCE(ls.ExpiryDate, @toDate) AS DATE) < @toDate THEN CAST(ls.ExpiryDate AS DATE) ELSE @toDate END
             ) + 1
             ELSE 0
           END
         AS DECIMAL(12,4)) AS ProRatedRevenueUsd,
         ISNULL(ls.AIQuizLimit, 0) AS AiLimit
       FROM LatestSubs ls
       JOIN dbo.UserNameRegistry ur
         ON ur.UserType = CASE
           WHEN ls.UserRole = 'Teacher' THEN 'TEACHER'
           WHEN ls.UserRole = 'Student' THEN 'STUDENT'
           WHEN ls.UserRole = 'Principal' THEN 'PRINCIPAL'
           ELSE UPPER(ls.UserRole)
         END
        AND ur.UserId = ls.UserId
        AND ur.IsActive = 1
       JOIN EligibleInvoiceUsers eiu
         ON eiu.UserNameRegistryId = ur.UserNameRegistryId
       WHERE ls.rn = 1
         AND ISNULL(ls.IsTrial, 0) = 0
     ),
     RangedUsage AS (
       SELECT UserNameRegistryId,
              SUM(CASE WHEN EventType IN ('AI_QUESTION','AI_JOB') THEN Quantity ELSE 0 END) AS AiUsed
       FROM dbo.UsageEvent
       WHERE CreatedAtUtc >= CAST(@fromDate AS DATETIME2)
         AND CreatedAtUtc < @ToDateExclusive
       GROUP BY UserNameRegistryId
     ),
     LastActivity AS (
       SELECT UserNameRegistryId, MAX(CreatedAtUtc) AS LastActivityUtc
       FROM dbo.UsageEvent
       WHERE CreatedAtUtc < @ToDateExclusive
       GROUP BY UserNameRegistryId
     )
     SELECT
       rs.UserNameRegistryId,
       rs.UserName,
       rs.UserType,
       rs.PlanName,
       rs.ProRatedRevenueUsd,
       rs.AiLimit,
       ISNULL(ru.AiUsed, 0) AS AiUsed,
       la.LastActivityUtc,
       CASE
         WHEN la.LastActivityUtc IS NULL THEN 0.60
         WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @toDate) >= 10 THEN 0.60
         WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @toDate) >= 7 THEN 0.40
         WHEN ISNULL(rs.AiLimit, 0) > 0 AND (CAST(ISNULL(ru.AiUsed, 0) AS DECIMAL(12,4)) / NULLIF(rs.AiLimit, 0)) < 0.20 THEN 0.25
         ELSE 0.10
       END AS ChurnProbability
     FROM RegistrySubs rs
     LEFT JOIN RangedUsage ru
       ON ru.UserNameRegistryId = rs.UserNameRegistryId
     LEFT JOIN LastActivity la
       ON la.UserNameRegistryId = rs.UserNameRegistryId
     ORDER BY ChurnProbability DESC, rs.ProRatedRevenueUsd DESC, rs.UserName;`,
    [
      { name: "fromDate", type: TYPES.Date, value: fromDate },
      { name: "toDate", type: TYPES.Date, value: toDate },
    ]
  );

  return result.rows;
}

async function getUsageSummaryByRange(fromDateString, toDateString) {
  const fromDate = toSqlDate(fromDateString);
  const toDate = toSqlDate(toDateString);
  const result = await execQuery(
    "EXEC dbo.Admin_GetUsageSummaryByRange @FromDate, @ToDate",
    [
      { name: "FromDate", type: TYPES.Date, value: fromDate },
      { name: "ToDate", type: TYPES.Date, value: toDate },
    ]
  );
  const row = result.rows[0] || {};
  return {
    fromDate: row.FromDate || fromDateString,
    toDate: row.ToDate || toDateString,
    distinctActiveUsers: Number(row.DistinctActiveUsers || 0),
    totalQuantity: Number(row.TotalQuantity || 0),
    totalTrackedCostUsd: Number(row.TotalTrackedCostUsd || 0),
    totalsByEventType: parseJsonArray(row.TotalsByEventTypeJson),
    topUsers: parseJsonArray(row.TopUsersJson),
  };
}

async function getProfitLossByRange(fromDateString, toDateString) {
  const fromDate = toSqlDate(fromDateString);
  const toDate = toSqlDate(toDateString);
  const monthlyOverheadUsdSetting = await getMonthlyOverheadSetting();
  let result;
  try {
    result = await execQuery(
      "EXEC dbo.Admin_GetProfitLossByRange @FromDate, @ToDate, @UnitCostPerAiQuestion, @MonthlyOverheadUsd",
      [
        { name: "FromDate", type: TYPES.Date, value: fromDate },
        { name: "ToDate", type: TYPES.Date, value: toDate },
        {
          name: "UnitCostPerAiQuestion",
          type: TYPES.Decimal,
          value: DEFAULT_AI_UNIT_COST,
          options: { precision: 10, scale: 4 },
        },
        {
          name: "MonthlyOverheadUsd",
          type: TYPES.Decimal,
          value: monthlyOverheadUsdSetting,
          options: { precision: 12, scale: 2 },
        },
      ]
    );
  } catch {
    result = { rows: [await getProfitLossFallback(fromDateString, toDateString)] };
  }
  const row = result.rows[0] || {};
  const pnl = {
    fromDate: row.FromDate || fromDateString,
    toDate: row.ToDate || toDateString,
    activePaidUsers: Number(row.ActivePaidUsers || 0),
    activeFreeUsers: Number(row.ActiveFreeUsers || 0),
    revenueUsd: Number(row.RevenueUsd || 0),
    aiCostUsd: Number(row.AiCostUsd || 0),
    monthlyOverheadUsd: Number(row.MonthlyOverheadUsd || 0),
    overageCostUsd: Number(row.OverageCostUsd || 0),
    potentialChurnLossUsd: Number(row.PotentialChurnLossUsd || 0),
  };
  pnl.netUsd =
    pnl.revenueUsd -
    pnl.aiCostUsd -
    pnl.monthlyOverheadUsd -
    pnl.overageCostUsd -
    pnl.potentialChurnLossUsd;

  try {
    await execQuery(
      `MERGE dbo.ProfitLossSnapshot AS target
       USING (SELECT @fromDate AS FromDate, @toDate AS ToDate) AS source
         ON target.FromDate = source.FromDate AND target.ToDate = source.ToDate
       WHEN MATCHED THEN
         UPDATE SET
           ActivePaidUsers = @activePaidUsers,
           ActiveFreeUsers = @activeFreeUsers,
           RevenueUsd = @revenueUsd,
           AiCostUsd = @aiCostUsd,
           MonthlyOverheadUsd = @monthlyOverheadUsd,
           OverageCostUsd = @overageCostUsd,
           PotentialChurnLossUsd = @potentialChurnLossUsd,
           CreatedAtUtc = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (FromDate, ToDate, ActivePaidUsers, ActiveFreeUsers, RevenueUsd, AiCostUsd, MonthlyOverheadUsd, OverageCostUsd, PotentialChurnLossUsd)
         VALUES (@fromDate, @toDate, @activePaidUsers, @activeFreeUsers, @revenueUsd, @aiCostUsd, @monthlyOverheadUsd, @overageCostUsd, @potentialChurnLossUsd);`,
      [
        { name: "fromDate", type: TYPES.Date, value: fromDate },
        { name: "toDate", type: TYPES.Date, value: toDate },
        { name: "activePaidUsers", type: TYPES.Int, value: pnl.activePaidUsers },
        { name: "activeFreeUsers", type: TYPES.Int, value: pnl.activeFreeUsers },
        { name: "revenueUsd", type: TYPES.Decimal, value: pnl.revenueUsd, options: { precision: 12, scale: 2 } },
        { name: "aiCostUsd", type: TYPES.Decimal, value: pnl.aiCostUsd, options: { precision: 12, scale: 2 } },
        { name: "monthlyOverheadUsd", type: TYPES.Decimal, value: pnl.monthlyOverheadUsd, options: { precision: 12, scale: 2 } },
        { name: "overageCostUsd", type: TYPES.Decimal, value: pnl.overageCostUsd, options: { precision: 12, scale: 2 } },
        { name: "potentialChurnLossUsd", type: TYPES.Decimal, value: pnl.potentialChurnLossUsd, options: { precision: 12, scale: 2 } },
      ]
    );
  } catch {
    // Snapshot persistence is best-effort. Report generation should still succeed.
  }

  return pnl;
}

async function getAtRiskUsersByRange(fromDateString, toDateString) {
  const fromDate = toSqlDate(fromDateString);
  const toDate = toSqlDate(toDateString);
  let result;
  try {
    result = await execQuery(
      `DECLARE @ToDateExclusive DATETIME2 = DATEADD(DAY, 1, CAST(@toDate AS DATETIME2));
       WITH PaidUsers AS (
         SELECT
           p.UserNameRegistryId,
           p.PlanCode,
           sp.PlanName,
           CAST(
             (COALESCE(NULLIF(p.Amount, 0), sp.Price, 0) / 30.0) *
             CASE
               WHEN DATEDIFF(DAY,
                 CASE WHEN CAST(COALESCE(p.PlanStartUtc, @fromDate) AS DATE) > @fromDate THEN CAST(p.PlanStartUtc AS DATE) ELSE @fromDate END,
                 CASE WHEN CAST(COALESCE(p.PlanEndUtc, @toDate) AS DATE) < @toDate THEN CAST(p.PlanEndUtc AS DATE) ELSE @toDate END
               ) + 1 > 0
               THEN DATEDIFF(DAY,
                 CASE WHEN CAST(COALESCE(p.PlanStartUtc, @fromDate) AS DATE) > @fromDate THEN CAST(p.PlanStartUtc AS DATE) ELSE @fromDate END,
                 CASE WHEN CAST(COALESCE(p.PlanEndUtc, @toDate) AS DATE) < @toDate THEN CAST(p.PlanEndUtc AS DATE) ELSE @toDate END
               ) + 1
               ELSE 0
             END
           AS DECIMAL(12,4)) AS ProRatedRevenueUsd,
           ISNULL(sp.AIQuizLimit, 0) AS AiLimit
         FROM dbo.Payments p
         LEFT JOIN dbo.SubscriptionPlan sp
           ON p.PlanCode = CASE
             WHEN LOWER(ISNULL(sp.AppliesToRole, 'Both')) LIKE '%student%' OR LOWER(sp.PlanName) LIKE '%student%'
               THEN CASE
                 WHEN LOWER(sp.PlanName) LIKE '%free%' THEN 'FREE_STUDENT'
                 WHEN LOWER(sp.PlanName) LIKE '%basic%' THEN 'STUDENT_BASIC'
                 WHEN LOWER(sp.PlanName) LIKE '%pro%' THEN 'STUDENT_PRO'
                 ELSE NULL
               END
             ELSE CASE
               WHEN LOWER(sp.PlanName) LIKE '%free%' THEN 'FREE_TRIAL'
               WHEN LOWER(sp.PlanName) LIKE '%basic%' THEN 'BASIC_TEACHER'
               WHEN LOWER(sp.PlanName) LIKE '%pro%' THEN 'PRO_TEACHER'
               ELSE NULL
             END
           END
         WHERE p.PaymentStatus = 'ACTIVE'
           AND p.IsActive = 1
           AND NULLIF(LTRIM(RTRIM(ISNULL(p.StripeInvoiceId, ''))), '') IS NOT NULL
           AND ISNULL(p.PlanCode, '') NOT IN ('FREE_TRIAL', 'FREE_STUDENT')
           AND CAST(COALESCE(p.PlanEndUtc, @toDate) AS DATE) >= @fromDate
           AND CAST(COALESCE(p.PlanStartUtc, @fromDate) AS DATE) <= @toDate
       ),
       RangedUsage AS (
         SELECT UserNameRegistryId,
                SUM(CASE WHEN EventType IN ('AI_QUESTION','AI_JOB') THEN Quantity ELSE 0 END) AS AiUsed
         FROM dbo.UsageEvent
         WHERE CreatedAtUtc >= CAST(@fromDate AS DATETIME2)
           AND CreatedAtUtc < @ToDateExclusive
         GROUP BY UserNameRegistryId
       ),
       LastActivity AS (
         SELECT UserNameRegistryId, MAX(CreatedAtUtc) AS LastActivityUtc
         FROM dbo.UsageEvent
         WHERE CreatedAtUtc < @ToDateExclusive
         GROUP BY UserNameRegistryId
       )
       SELECT
         pu.UserNameRegistryId,
         ur.UserName,
         ur.UserType,
         COALESCE(pu.PlanName, pu.PlanCode) AS PlanName,
         pu.PlanCode,
         pu.ProRatedRevenueUsd,
         pu.AiLimit,
         ISNULL(ru.AiUsed, 0) AS AiUsed,
         la.LastActivityUtc,
         CASE
           WHEN la.LastActivityUtc IS NULL THEN 0.60
           WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @toDate) >= 10 THEN 0.60
           WHEN DATEDIFF(DAY, CAST(la.LastActivityUtc AS DATE), @toDate) >= 7 THEN 0.40
           WHEN ISNULL(pu.AiLimit, 0) > 0 AND (CAST(ISNULL(ru.AiUsed, 0) AS DECIMAL(12,4)) / NULLIF(pu.AiLimit, 0)) < 0.20 THEN 0.25
           ELSE 0.10
         END AS ChurnProbability
       FROM PaidUsers pu
       JOIN dbo.UserNameRegistry ur
         ON ur.UserNameRegistryId = pu.UserNameRegistryId
       LEFT JOIN RangedUsage ru
         ON ru.UserNameRegistryId = pu.UserNameRegistryId
       LEFT JOIN LastActivity la
         ON la.UserNameRegistryId = pu.UserNameRegistryId
       ORDER BY ChurnProbability DESC, pu.ProRatedRevenueUsd DESC, ur.UserName`,
      [
        { name: "fromDate", type: TYPES.Date, value: fromDate },
        { name: "toDate", type: TYPES.Date, value: toDate },
      ]
    );
  } catch {
    result = { rows: await getAtRiskUsersFallback(fromDateString, toDateString) };
  }

  return result.rows
    .map((row) => {
      const churnProbability = Number(row.ChurnProbability || 0);
      const daysSinceLastActivity = row.LastActivityUtc
        ? Math.max(0, Math.floor((new Date(`${toDateString}T00:00:00.000Z`) - new Date(row.LastActivityUtc)) / 86400000))
        : null;
      const usagePctOfLimit =
        Number(row.AiLimit || 0) > 0 ? Number(row.AiUsed || 0) / Number(row.AiLimit || 1) : null;
      let reason = "Low recent engagement";
      if (daysSinceLastActivity == null || daysSinceLastActivity >= 10) reason = "No recent activity for 10+ days";
      else if (daysSinceLastActivity >= 7) reason = "No recent activity for 7+ days";
      else if (usagePctOfLimit != null && usagePctOfLimit < 0.2) reason = "Usage below 20% of plan allowance";
      return {
        userNameRegistryId: Number(row.UserNameRegistryId),
        userName: row.UserName || "",
        userType: row.UserType || "",
        planCode: row.PlanCode || row.PlanName || mapRegistryRoleToSubscriptionRole(row.UserType),
        planName: row.PlanName || row.PlanCode || "",
        proRatedRevenueUsd: Number(row.ProRatedRevenueUsd || 0),
        aiLimit: Number(row.AiLimit || 0),
        aiUsed: Number(row.AiUsed || 0),
        usagePctOfLimit,
        daysSinceLastActivity,
        churnProbability,
        reason,
      };
    })
    .filter((row) => row.churnProbability >= 0.4);
}

module.exports = {
  getMonthlyOverheadSetting,
  getUsageSummaryByRange,
  getProfitLossByRange,
  getAtRiskUsersByRange,
  setMonthlyOverheadSetting,
};
