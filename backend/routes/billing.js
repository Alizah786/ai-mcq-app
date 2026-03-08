const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const Stripe = require("stripe");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { activatePlanForUser, getSubscriptionStatus, ensureTrialSubscription, normalizeRole } = require("../services/subscription");

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PRORATION_BEHAVIOR = process.env.STRIPE_PRORATION_BEHAVIOR || "create_prorations";
const DOWNGRADE_POLICY = (process.env.STRIPE_DOWNGRADE_POLICY || "period_end").toLowerCase(); // period_end | immediate

let stripeClient = null;
function stripe() {
  if (!STRIPE_SECRET_KEY) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  if (!stripeClient) stripeClient = new Stripe(STRIPE_SECRET_KEY);
  return stripeClient;
}

const STRIPE_PRICE_BY_PLAN_CODE = {
  BASIC_TEACHER: process.env.STRIPE_PRICE_BASIC_TEACHER || "",
  PRO_TEACHER: process.env.STRIPE_PRICE_PRO_TEACHER || "",
  STUDENT_BASIC: process.env.STRIPE_PRICE_STUDENT_BASIC || "",
  STUDENT_PRO: process.env.STRIPE_PRICE_STUDENT_PRO || "",
};

const PRICE_TO_PLAN = Object.entries(STRIPE_PRICE_BY_PLAN_CODE).reduce((acc, [code, priceId]) => {
  if (priceId) acc[priceId] = code;
  return acc;
}, {});

function sendBillingError(res, status, errorCode, message, extra = {}) {
  return res.status(status).json({ errorCode, message, ...extra });
}

function roleToRegistryUserType(roleRaw) {
  const role = normalizeRole(roleRaw);
  if (role === "Teacher") return "TEACHER";
  if (role === "Student") return "STUDENT";
  if (role === "Principal") return "PRINCIPAL";
  return "TEACHER";
}

function planCodeFromName(planName, appliesToRole = "Both") {
  const n = String(planName || "").toLowerCase();
  const role = String(appliesToRole || "").toLowerCase();
  const studentish = role.includes("student") || n.includes("student");
  if (n.includes("free")) return studentish ? "FREE_STUDENT" : "FREE_TRIAL";
  if (n.includes("basic")) return studentish ? "STUDENT_BASIC" : "BASIC_TEACHER";
  if (n.includes("pro")) return studentish ? "STUDENT_PRO" : "PRO_TEACHER";
  return "CUSTOM";
}

async function hasSubscriptionPlanColumn(columnName) {
  try {
    const c = await execQuery(
      `SELECT COL_LENGTH('dbo.SubscriptionPlan', @columnName) AS LenVal`,
      [{ name: "columnName", type: TYPES.NVarChar, value: columnName }]
    );
    return c.rows[0]?.LenVal != null;
  } catch {
    return false;
  }
}

async function hasTable(tableName) {
  try {
    const r = await execQuery(
      `SELECT OBJECT_ID(@tableName, 'U') AS ObjectIdVal`,
      [{ name: "tableName", type: TYPES.NVarChar, value: tableName }]
    );
    return r.rows[0]?.ObjectIdVal != null;
  } catch {
    return false;
  }
}

function normalizePlanFeatures(features, maxCount = 7) {
  return Array.isArray(features)
    ? features
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, maxCount)
    : [];
}

async function replacePlanFeatures(planId, features, maxCount = 7) {
  const hasFeatureTable = await hasTable("dbo.SubscriptionPlanFeature");
  if (!hasFeatureTable) return;
  const normalizedPlanId = Number(planId || 0);
  if (!Number.isFinite(normalizedPlanId) || normalizedPlanId <= 0) return;
  const normalizedFeatures = normalizePlanFeatures(features, maxCount);
  await execQuery(
    `DELETE FROM dbo.SubscriptionPlanFeature
     WHERE PlanId = @planId`,
    [{ name: "planId", type: TYPES.Int, value: normalizedPlanId }]
  );
  for (let index = 0; index < normalizedFeatures.length; index += 1) {
    await execQuery(
      `INSERT INTO dbo.SubscriptionPlanFeature
         (PlanId, DisplayOrder, FeatureText, IsActive, CreatedAtUtc, UpdatedAtUtc)
       VALUES
         (@planId, @displayOrder, @featureText, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`,
      [
        { name: "planId", type: TYPES.Int, value: normalizedPlanId },
        { name: "displayOrder", type: TYPES.Int, value: index + 1 },
        { name: "featureText", type: TYPES.NVarChar, value: normalizedFeatures[index] },
      ]
    );
  }
}

async function getPlanFeaturesMap(planIds) {
  const normalizedPlanIds = Array.from(
    new Set((Array.isArray(planIds) ? planIds : []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0))
  );
  if (!normalizedPlanIds.length) return new Map();
  const hasFeatureTable = await hasTable("dbo.SubscriptionPlanFeature");
  if (!hasFeatureTable) return new Map();

  const params = normalizedPlanIds.map((planId, index) => ({
    name: `planId${index}`,
    type: TYPES.Int,
    value: planId,
  }));
  const placeholders = params.map((p) => `@${p.name}`).join(", ");
  const r = await execQuery(
    `SELECT PlanId, DisplayOrder, FeatureText
     FROM dbo.SubscriptionPlanFeature
     WHERE IsActive = 1
       AND PlanId IN (${placeholders})
     ORDER BY PlanId, DisplayOrder, SubscriptionPlanFeatureId`,
    params
  );
  const map = new Map();
  for (const row of r.rows || []) {
    const planId = Number(row.PlanId || 0);
    if (!planId) continue;
    if (!map.has(planId)) map.set(planId, []);
    map.get(planId).push(String(row.FeatureText || ""));
  }
  return map;
}

async function requireRegistryUser(req) {
  const userType = roleToRegistryUserType(req.user.displayRole || req.user.role);
  const r = await execQuery(
    `SELECT TOP 1 UserNameRegistryId, UserName, UserType, UserId, IsActive
     FROM dbo.UserNameRegistry
     WHERE UserType = @userType AND UserId = @userId AND IsActive = 1`,
    [
      { name: "userType", type: TYPES.NVarChar, value: userType },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  return r.rows[0] || null;
}

async function getPlanByCode(planCode) {
  const normalizedCode = String(planCode || "").toUpperCase();
  const rows = await getBillingPlansRows("Teacher", true);
  const match = (rows.rows || []).find((row) => planCodeFromName(row.PlanName, row.AppliesToRole) === normalizedCode);
  if (!match) return null;
  const role = String(match.AppliesToRole || "").toLowerCase();
  const userType = role.includes("student") || normalizedCode.startsWith("STUDENT_") || normalizedCode === "FREE_STUDENT"
    ? "STUDENT"
    : "TEACHER";
  return {
    planId: Number(match.PlanId),
    planCode: normalizedCode,
    userType,
    name: match.PlanName,
    priceCad: Number(match.Price || 0),
    durationDays: Number(match.DurationDays || 0),
    aiLimit: Number(match.AIQuizLimit || 0),
    manualLimit: Number(match.ManualQuizLimit || 0),
    isPaid: Number(match.Price || 0) > 0,
    stripePriceId: STRIPE_PRICE_BY_PLAN_CODE[normalizedCode] || "",
  };
}

async function getPlanCodeForRegistry(registryUserType) {
  return registryUserType === "STUDENT" ? "FREE_STUDENT" : "FREE_TRIAL";
}

async function getActivePayment(userNameRegistryId) {
  const r = await execQuery(
    `SELECT TOP 1 *
     FROM dbo.Payments
     WHERE UserNameRegistryId = @id
       AND IsActive = 1
       AND PaymentStatus = 'ACTIVE'
     ORDER BY CreatedAtUtc DESC`,
    [{ name: "id", type: TYPES.Int, value: userNameRegistryId }]
  );
  return r.rows[0] || null;
}

async function deactivateActivePayments(userNameRegistryId, status = "EXPIRED") {
  await execQuery(
    `UPDATE dbo.Payments
     SET IsActive = 0,
         PaymentStatus = @status,
         LastModifiedUtc = SYSUTCDATETIME()
     WHERE UserNameRegistryId = @id
       AND IsActive = 1
       AND PaymentStatus = 'ACTIVE'`,
    [
      { name: "id", type: TYPES.Int, value: userNameRegistryId },
      { name: "status", type: TYPES.NVarChar, value: status },
    ]
  );
}

async function insertPaymentRow(row) {
  await execQuery(
    `INSERT INTO dbo.Payments
      (UserNameRegistryId, PlanCode, UserType, StripeCustomerId, StripeSubscriptionId, StripeInvoiceId, StripeEventId,
       Amount, Currency, BillingCycle, PlanStartUtc, PlanEndUtc, PaymentStatus, IsActive, CreatedAtUtc, LastModifiedUtc)
     VALUES
      (@userNameRegistryId, @planCode, @userType, @stripeCustomerId, @stripeSubscriptionId, @stripeInvoiceId, @stripeEventId,
       @amount, @currency, @billingCycle, @planStartUtc, @planEndUtc, @paymentStatus, @isActive, SYSUTCDATETIME(), SYSUTCDATETIME())`,
    [
      { name: "userNameRegistryId", type: TYPES.Int, value: row.userNameRegistryId },
      { name: "planCode", type: TYPES.NVarChar, value: row.planCode },
      { name: "userType", type: TYPES.NVarChar, value: row.userType },
      { name: "stripeCustomerId", type: TYPES.NVarChar, value: row.stripeCustomerId || null },
      { name: "stripeSubscriptionId", type: TYPES.NVarChar, value: row.stripeSubscriptionId || null },
      { name: "stripeInvoiceId", type: TYPES.NVarChar, value: row.stripeInvoiceId || null },
      { name: "stripeEventId", type: TYPES.NVarChar, value: row.stripeEventId || null },
      { name: "amount", type: TYPES.Decimal, value: row.amount == null ? null : Number(row.amount), options: { precision: 10, scale: 2 } },
      { name: "currency", type: TYPES.NVarChar, value: row.currency || "CAD" },
      { name: "billingCycle", type: TYPES.NVarChar, value: row.billingCycle || "MONTHLY" },
      { name: "planStartUtc", type: TYPES.DateTime2, value: row.planStartUtc || null },
      { name: "planEndUtc", type: TYPES.DateTime2, value: row.planEndUtc || null },
      { name: "paymentStatus", type: TYPES.NVarChar, value: row.paymentStatus || "ACTIVE" },
      { name: "isActive", type: TYPES.Bit, value: row.isActive ? 1 : 0 },
    ]
  );
}

async function existsByStripeEventId(eventId) {
  if (!eventId) return false;
  const r = await execQuery(
    `SELECT TOP 1 PaymentId
     FROM dbo.Payments
     WHERE StripeEventId = @eventId`,
    [{ name: "eventId", type: TYPES.NVarChar, value: eventId }]
  );
  return !!r.rows.length;
}

async function findRegistryBySubscriptionId(subscriptionId) {
  const r = await execQuery(
    `SELECT TOP 1 UserNameRegistryId
     FROM dbo.Payments
     WHERE StripeSubscriptionId = @subscriptionId
     ORDER BY CreatedAtUtc DESC`,
    [{ name: "subscriptionId", type: TYPES.NVarChar, value: subscriptionId }]
  );
  return r.rows[0]?.UserNameRegistryId || null;
}

async function findRegistryByCustomerId(customerId) {
  const r = await execQuery(
    `SELECT TOP 1 UserNameRegistryId
     FROM dbo.Payments
     WHERE StripeCustomerId = @customerId
     ORDER BY CreatedAtUtc DESC`,
    [{ name: "customerId", type: TYPES.NVarChar, value: customerId }]
  );
  return r.rows[0]?.UserNameRegistryId || null;
}

function getPlanCodeFromInvoice(invoice) {
  const lines = invoice?.lines?.data || [];
  const line = lines.find((l) => l?.price?.id) || lines[0];
  const priceId = line?.price?.id || null;
  return PRICE_TO_PLAN[priceId] || null;
}

function comparePlanPrice(fromPrice, toPrice) {
  const a = Number(fromPrice || 0);
  const b = Number(toPrice || 0);
  if (b > a) return "UPGRADE";
  if (b < a) return "DOWNGRADE";
  return "SAME";
}

async function getUsageByPlan(userType, userId, startDate, endDate) {
  const start = startDate || new Date();
  const end = endDate || new Date();
  if (String(userType).toUpperCase() === "TEACHER") {
    const r = await execQuery(
      `SELECT
         SUM(CASE WHEN UPPER(ISNULL(q.SourceType, '')) LIKE 'AI%' THEN 1 ELSE 0 END) AS AIUsed,
         SUM(CASE WHEN UPPER(ISNULL(q.SourceType, '')) LIKE 'AI%' THEN 0 ELSE 1 END) AS ManualUsed
       FROM dbo.Quiz q
       JOIN dbo.Class c ON c.ClassId = q.ClassId
       JOIN dbo.Student s ON s.StudentId = c.StudentId
       WHERE s.TeacherId = @userId
         AND q.CreateDate >= @startDate
         AND q.CreateDate < @endDate`,
      [
        { name: "userId", type: TYPES.Int, value: userId },
        { name: "startDate", type: TYPES.DateTime2, value: start },
        { name: "endDate", type: TYPES.DateTime2, value: end },
      ]
    );
    return { aiUsed: Number(r.rows[0]?.AIUsed || 0), manualUsed: Number(r.rows[0]?.ManualUsed || 0) };
  }
  const r = await execQuery(
    `SELECT
       SUM(CASE WHEN UPPER(ISNULL(q.SourceType, '')) LIKE 'AI%' THEN 1 ELSE 0 END) AS AIUsed
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     WHERE c.StudentId = @userId
       AND q.CreateDate >= @startDate
       AND q.CreateDate < @endDate`,
    [
      { name: "userId", type: TYPES.Int, value: userId },
      { name: "startDate", type: TYPES.DateTime2, value: start },
      { name: "endDate", type: TYPES.DateTime2, value: end },
    ]
  );
  return { aiUsed: Number(r.rows[0]?.AIUsed || 0), manualUsed: 0 };
}

async function getBillingPlansRows(role, includeAll) {
  const hasFlashcardOtherGenerateLimit = await hasSubscriptionPlanColumn("FlashcardOtherGenerateLimit");
  try {
    const result = await execQuery(
      "EXEC dbo.usp_Billing_GetPlans @Role, @IncludeAll",
      [
        { name: "Role", type: TYPES.NVarChar, value: role },
        { name: "IncludeAll", type: TYPES.Bit, value: includeAll ? 1 : 0 },
      ]
    );
    return result;
  } catch {
    if (includeAll) {
      return execQuery(
        `SELECT PlanId, PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive,
                ISNULL(DocumentUploadLimit, 0) AS DocumentUploadLimit,
                ISNULL(PerQuizDocumentLimit, 1) AS PerQuizDocumentLimit,
                ISNULL(MaxMcqsPerQuiz, 10) AS MaxMcqsPerQuiz,
                ${hasFlashcardOtherGenerateLimit ? "ISNULL(FlashcardOtherGenerateLimit, 0)" : "CAST(0 AS INT)"} AS FlashcardOtherGenerateLimit,
                ISNULL(AppliesToRole, 'Both') AS AppliesToRole,
                ISNULL(AnalyticsLevel, 'Basic') AS AnalyticsLevel,
                ISNULL(LockHintForFreePlan, 0) AS LockHintForFreePlan,
                ISNULL(LockPdfForFreePlan, 0) AS LockPdfForFreePlan
         FROM dbo.SubscriptionPlan
         ORDER BY PlanId`
      );
    }
    return execQuery(
      `SELECT PlanId, PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit, IsActive,
              ISNULL(DocumentUploadLimit, 0) AS DocumentUploadLimit,
              ISNULL(PerQuizDocumentLimit, 1) AS PerQuizDocumentLimit,
              ISNULL(MaxMcqsPerQuiz, 10) AS MaxMcqsPerQuiz,
              ${hasFlashcardOtherGenerateLimit ? "ISNULL(FlashcardOtherGenerateLimit, 0)" : "CAST(0 AS INT)"} AS FlashcardOtherGenerateLimit,
              ISNULL(AppliesToRole, 'Both') AS AppliesToRole,
              ISNULL(AnalyticsLevel, 'Basic') AS AnalyticsLevel,
              ISNULL(LockHintForFreePlan, 0) AS LockHintForFreePlan,
              ISNULL(LockPdfForFreePlan, 0) AS LockPdfForFreePlan
       FROM dbo.SubscriptionPlan
       WHERE ISNULL(AppliesToRole, 'Both') IN ('Both', @role)
       ORDER BY PlanId`,
      [{ name: "role", type: TYPES.NVarChar, value: role }]
    );
  }
}

router.get("/billing/plans", async (_req, res) => {
  const includeAll = String(_req.query?.includeAll || "").toLowerCase() === "1" || String(_req.query?.includeAll || "").toLowerCase() === "true";
  const role = normalizeRole((_req.user?.displayRole || _req.user?.role || _req.query?.role || "Teacher"));
  const plans = await getBillingPlansRows(role, includeAll);
  const featureMap = await getPlanFeaturesMap((plans.rows || []).map((p) => p.PlanId));
  return res.json({
    role,
    plans: plans.rows.map((p) => ({
      planId: p.PlanId,
      code: planCodeFromName(p.PlanName, p.AppliesToRole),
      planName: p.PlanName,
      price: Number(p.Price || 0),
      durationDays: Number(p.DurationDays || 0),
      aiQuizLimit: Number(p.AIQuizLimit || 0),
      manualQuizLimit: Number(p.ManualQuizLimit || 0),
      documentUploadLimit: Number(p.DocumentUploadLimit || 0),
      perQuizDocumentLimit: Number(p.PerQuizDocumentLimit || 1),
      maxMcqsPerQuiz: Number(p.MaxMcqsPerQuiz || 10),
      flashcardOtherGenerateLimit: Number(p.FlashcardOtherGenerateLimit || 0),
      isActive: !!p.IsActive,
      appliesToRole: p.AppliesToRole || "Both",
      analyticsLevel: p.AnalyticsLevel || "Basic",
      lockHintForFreePlan: !!p.LockHintForFreePlan,
      lockPdfForFreePlan: !!p.LockPdfForFreePlan,
      features: featureMap.get(Number(p.PlanId)) || [],
    })),
  });
});

router.get("/billing/subscription-status", requireAuth, async (req, res) => {
  if (req.user.role === "AppAdmin") {
    return res.json({ subscription: null });
  }
  const role = normalizeRole(req.user.role === "Manager" ? "Teacher" : (req.user.displayRole || req.user.role));
  await ensureTrialSubscription(role, req.user.userId);
  const subscription = await getSubscriptionStatus(role, req.user.userId);
  return res.json({ subscription });
});

router.get("/billing/my-plan", requireAuth, async (req, res) => {
  if (req.user.role === "AppAdmin") {
    return res.json({ plan: null });
  }
  try {
    const registry = await requireRegistryUser(req);
    if (!registry) {
      throw new Error("User identity not linked in UserNameRegistry.");
    }

    const active = await getActivePayment(registry.UserNameRegistryId);
    const fallbackCode = await getPlanCodeForRegistry(registry.UserType);
    const planCode = active?.PlanCode || fallbackCode;
    const plan = (await getPlanByCode(planCode)) || (await getPlanByCode(fallbackCode));
    const usage = await getUsageByPlan(
      registry.UserType,
      registry.UserId,
      active?.PlanStartUtc || new Date(),
      active?.PlanEndUtc || new Date(Date.now() + 86400000)
    );

    return res.json({
      plan: {
        userNameRegistryId: registry.UserNameRegistryId,
        userType: registry.UserType,
        planCode,
        paymentStatus: active?.PaymentStatus || "ACTIVE",
        planStartUtc: active?.PlanStartUtc || null,
        planEndUtc: active?.PlanEndUtc || null,
        stripeCustomerId: active?.StripeCustomerId || null,
        stripeSubscriptionId: active?.StripeSubscriptionId || null,
        aiLimit: Number(plan?.aiLimit || 0),
        manualLimit: Number(plan?.manualLimit || 0),
        aiUsed: usage.aiUsed,
        manualUsed: usage.manualUsed,
        aiRemaining: Math.max(Number(plan?.aiLimit || 0) - usage.aiUsed, 0),
        manualRemaining: Math.max(Number(plan?.manualLimit || 0) - usage.manualUsed, 0),
        isPaid: !!plan?.isPaid,
      },
    });
  } catch {
    const role = normalizeRole(req.user.role === "Manager" ? "Teacher" : (req.user.displayRole || req.user.role));
    await ensureTrialSubscription(role, req.user.userId);
    const sub = await getSubscriptionStatus(role, req.user.userId);
    const fallbackCode = role === "Student" ? "FREE_STUDENT" : "FREE_TRIAL";
    const inferredCode = planCodeFromName(sub?.planName, role === "Student" ? "Student" : "Teacher");
    const planCode = inferredCode && inferredCode !== "CUSTOM"
      ? inferredCode
      : (sub?.currentPlanCode || fallbackCode);
    const plan = (await getPlanByCode(planCode)) || (await getPlanByCode(fallbackCode));
    return res.json({
      plan: {
        userNameRegistryId: null,
        userType: role === "Student" ? "STUDENT" : "TEACHER",
        planCode,
        paymentStatus: "ACTIVE",
        planStartUtc: sub?.startDate || null,
        planEndUtc: sub?.expiryDate || null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        aiLimit: Number(sub?.aiLimit ?? plan?.aiLimit ?? 0),
        manualLimit: Number(sub?.manualLimit ?? plan?.manualLimit ?? 0),
        aiUsed: Number(sub?.aiUsed || 0),
        manualUsed: Number(sub?.manualUsed || 0),
        aiRemaining: Math.max(Number(sub?.aiLimit ?? plan?.aiLimit ?? 0) - Number(sub?.aiUsed || 0), 0),
        manualRemaining: Math.max(Number(sub?.manualLimit ?? plan?.manualLimit ?? 0) - Number(sub?.manualUsed || 0), 0),
        isPaid: !!plan?.isPaid,
      },
    });
  }
});

const ChangePlanBody = z.object({
  planCode: z.string().min(1),
});

router.post("/billing/change-plan", requireAuth, async (req, res) => {
  if (req.user.role === "AppAdmin") {
    return sendBillingError(res, 400, "BILLING_PLAN_NOT_APPLICABLE_TO_APPADMIN", "AppAdmin does not use subscription plans.");
  }
  const { planCode } = ChangePlanBody.parse(req.body || {});
  const target = await getPlanByCode(planCode);
  if (!target) return sendBillingError(res, 400, "BILLING_INVALID_PLAN_CODE", "Invalid planCode.");

  const registry = await requireRegistryUser(req);
  if (!registry) {
    return sendBillingError(res, 404, "BILLING_IDENTITY_NOT_LINKED", "User identity not linked in UserNameRegistry.");
  }
  if (String(registry.UserType).toUpperCase() !== target.userType) {
    return sendBillingError(res, 400, "BILLING_PLAN_ROLE_MISMATCH", "Plan does not apply to this user type.");
  }
  if (!target.isPaid) {
    try {
      await deactivateActivePayments(registry.UserNameRegistryId, "EXPIRED");
      const now = new Date();
      const end = new Date(now.getTime() + Number(target.durationDays || 30) * 86400000);
      await insertPaymentRow({
        userNameRegistryId: registry.UserNameRegistryId,
        planCode,
        userType: registry.UserType,
        amount: 0,
        paymentStatus: "ACTIVE",
        isActive: true,
        planStartUtc: now,
        planEndUtc: end,
      });
    } catch {
      // Payments table is optional in some deployments; subscription state still drives entitlements.
    }
    return res.json({ status: "active", message: "Free plan activated.", planCode });
  }
  if (!STRIPE_SECRET_KEY || !target.stripePriceId) {
    const role = normalizeRole(req.user.role === "Manager" ? "Teacher" : (req.user.displayRole || req.user.role));
    if (!target?.name) {
      return sendBillingError(
        res,
        500,
        "BILLING_SIMULATION_PLAN_UNSUPPORTED",
        `Unsupported plan code for simulation: ${planCode}.`
      );
    }
    const planLookup = await execQuery(
      `SELECT TOP 1 PlanId
       FROM dbo.SubscriptionPlan
       WHERE LOWER(PlanName) = LOWER(@planName)
         AND IsActive = 1`,
      [{ name: "planName", type: TYPES.NVarChar, value: target.name }]
    );
    if (!planLookup.rows.length) {
      return sendBillingError(
        res,
        500,
        "BILLING_SIMULATION_PLAN_NOT_CONFIGURED",
        `Plan is not configured or inactive: ${target.name}.`
      );
    }
    const sub = await activatePlanForUser(role, req.user.userId, Number(planLookup.rows[0].PlanId));
    try {
      await deactivateActivePayments(registry.UserNameRegistryId, "EXPIRED");
      const now = new Date();
      const planEnd = sub?.expiryDate
        ? new Date(sub.expiryDate)
        : new Date(now.getTime() + Number(target.durationDays || 30) * 86400000);
      await insertPaymentRow({
        userNameRegistryId: registry.UserNameRegistryId,
        planCode,
        userType: registry.UserType,
        amount: Number(target.priceCad || 0),
        currency: "CAD",
        billingCycle: "MONTHLY",
        planStartUtc: now,
        planEndUtc: planEnd,
        paymentStatus: "ACTIVE",
        isActive: true,
      });
    } catch {
      // Payments table is optional in some deployments; subscription state still drives entitlements.
    }
    return res.json({
      status: "active",
      message: "Plan activated in simulation mode (Stripe not configured).",
      planCode,
      subscription: sub,
    });
  }

  const current = await getActivePayment(registry.UserNameRegistryId);
  const currentPaid = current && String(current.PaymentStatus).toUpperCase() === "ACTIVE" && !!current.StripeSubscriptionId;

  if (!currentPaid) {
    const s = stripe();
    let customerId = current?.StripeCustomerId || null;
    if (!customerId) {
      const customer = await s.customers.create({
        email: registry.UserName.includes("@") ? registry.UserName : undefined,
        name: registry.UserName,
        metadata: {
          userNameRegistryId: String(registry.UserNameRegistryId),
          userType: String(registry.UserType),
        },
      });
      customerId = customer.id;
    }

    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: target.stripePriceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/pricing`,
      metadata: {
        userNameRegistryId: String(registry.UserNameRegistryId),
        userType: String(registry.UserType),
        planCode,
        action: "NEW",
      },
    });
    return res.json({ status: "checkout", checkoutUrl: session.url });
  }

  const s = stripe();
  const sub = await s.subscriptions.retrieve(current.StripeSubscriptionId);
  const item = sub.items?.data?.[0];
  if (!item?.id) {
    return sendBillingError(res, 400, "BILLING_STRIPE_SUBSCRIPTION_ITEM_NOT_FOUND", "Active Stripe subscription item not found.");
  }
  const currentCode = PRICE_TO_PLAN[item.price?.id] || current.PlanCode;
  const currentPlan = await getPlanByCode(currentCode);
  const direction = comparePlanPrice(currentPlan?.priceCad, target.priceCad);
  const isDowngrade = direction === "DOWNGRADE";

  if (isDowngrade && DOWNGRADE_POLICY === "period_end") {
    const updated = await s.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: target.stripePriceId }],
      proration_behavior: "none",
      billing_cycle_anchor: "unchanged",
    });
    await insertPaymentRow({
      userNameRegistryId: registry.UserNameRegistryId,
      planCode,
      userType: registry.UserType,
      stripeCustomerId: updated.customer || current.StripeCustomerId,
      stripeSubscriptionId: updated.id,
      amount: Number(target.priceCad || 0),
      currency: "CAD",
      billingCycle: "MONTHLY",
      planStartUtc: current.PlanEndUtc || null,
      planEndUtc: null,
      paymentStatus: "PENDING_CHANGE",
      isActive: false,
    });
    return res.json({ status: "scheduled", message: "Downgrade scheduled for next billing cycle." });
  }

  await s.subscriptions.update(sub.id, {
    items: [{ id: item.id, price: target.stripePriceId }],
    proration_behavior: PRORATION_BEHAVIOR,
    billing_cycle_anchor: "unchanged",
  });
  return res.json({ status: "pending", message: "Plan change requested. It will activate after payment confirmation." });
});

const SimulateUpgradeBody = z.object({
  planId: z.number().int().positive(),
});

router.post("/billing/upgrade/simulate", requireAuth, async (req, res) => {
  if (req.user.role === "AppAdmin") {
    return sendBillingError(res, 400, "BILLING_PLAN_NOT_APPLICABLE_TO_APPADMIN", "AppAdmin does not use subscription plans.");
  }
  const body = SimulateUpgradeBody.parse(req.body);
  const role = normalizeRole(req.user.role === "Manager" ? "Teacher" : (req.user.displayRole || req.user.role));
  const subscription = await activatePlanForUser(role, req.user.userId, body.planId);
  return res.json({
    message: "Plan upgraded successfully.",
    subscription,
  });
});

const AdminUpdatePlanBody = z.object({
  planName: z.string().min(1).max(150).optional(),
  price: z.number().nonnegative().optional(),
  durationDays: z.number().int().positive().optional(),
  aiQuizLimit: z.number().int().nonnegative().optional(),
  manualQuizLimit: z.number().int().nonnegative().optional(),
  documentUploadLimit: z.number().int().min(0).max(1000).optional(),
  perQuizDocumentLimit: z.number().int().min(1).max(5).optional(),
  maxMcqsPerQuiz: z.number().int().positive().max(500).optional(),
  flashcardOtherGenerateLimit: z.number().int().min(0).max(1000).optional(),
  planFeatures: z.array(z.string().trim().max(200)).max(20).optional(),
  isActive: z.boolean().optional(),
  lockHintForFreePlan: z.boolean().optional(),
  lockPdfForFreePlan: z.boolean().optional(),
});

async function updateAdminPlanConfig(planId, body) {
  const updates = [];
  const params = [{ name: "planId", type: TYPES.Int, value: planId }];

  if (body.planName !== undefined) {
    updates.push("PlanName = @planName");
    params.push({ name: "planName", type: TYPES.NVarChar, value: body.planName });
  }
  if (body.price !== undefined) {
    updates.push("Price = @price");
    params.push({ name: "price", type: TYPES.Float, value: body.price });
  }
  if (body.durationDays !== undefined) {
    updates.push("DurationDays = @durationDays");
    params.push({ name: "durationDays", type: TYPES.Int, value: body.durationDays });
  }
  if (body.aiQuizLimit !== undefined) {
    updates.push("AIQuizLimit = @aiQuizLimit");
    params.push({ name: "aiQuizLimit", type: TYPES.Int, value: body.aiQuizLimit });
  }
  if (body.manualQuizLimit !== undefined) {
    updates.push("ManualQuizLimit = @manualQuizLimit");
    params.push({ name: "manualQuizLimit", type: TYPES.Int, value: body.manualQuizLimit });
  }
  if (body.documentUploadLimit !== undefined) {
    const hasDocumentUploadLimit = await hasSubscriptionPlanColumn("DocumentUploadLimit");
    if (hasDocumentUploadLimit) {
      const normalizedDocLimit = Math.max(0, Math.min(1000, Number(body.documentUploadLimit) || 0));
      updates.push("DocumentUploadLimit = @documentUploadLimit");
      params.push({ name: "documentUploadLimit", type: TYPES.Int, value: normalizedDocLimit });
    }
  }
  if (body.perQuizDocumentLimit !== undefined) {
    const hasPerQuizDocumentLimit = await hasSubscriptionPlanColumn("PerQuizDocumentLimit");
    if (hasPerQuizDocumentLimit) {
      const normalizedPerQuizLimit = Math.max(1, Math.min(5, Number(body.perQuizDocumentLimit) || 1));
      updates.push("PerQuizDocumentLimit = @perQuizDocumentLimit");
      params.push({ name: "perQuizDocumentLimit", type: TYPES.Int, value: normalizedPerQuizLimit });
    }
  }
  if (body.maxMcqsPerQuiz !== undefined) {
    const hasMaxMcqsPerQuiz = await hasSubscriptionPlanColumn("MaxMcqsPerQuiz");
    if (hasMaxMcqsPerQuiz) {
      updates.push("MaxMcqsPerQuiz = @maxMcqsPerQuiz");
      params.push({ name: "maxMcqsPerQuiz", type: TYPES.Int, value: body.maxMcqsPerQuiz });
    }
  }
  if (body.flashcardOtherGenerateLimit !== undefined) {
    const hasFlashcardOtherGenerateLimit = await hasSubscriptionPlanColumn("FlashcardOtherGenerateLimit");
    if (hasFlashcardOtherGenerateLimit) {
      const normalizedFlashcardOtherLimit = Math.max(0, Math.min(1000, Number(body.flashcardOtherGenerateLimit) || 0));
      updates.push("FlashcardOtherGenerateLimit = @flashcardOtherGenerateLimit");
      params.push({ name: "flashcardOtherGenerateLimit", type: TYPES.Int, value: normalizedFlashcardOtherLimit });
    }
  }
  if (body.isActive !== undefined) {
    updates.push("IsActive = @isActive");
    params.push({ name: "isActive", type: TYPES.Bit, value: body.isActive ? 1 : 0 });
  }

  const hasLockHint = await hasSubscriptionPlanColumn("LockHintForFreePlan");
  const hasLockPdf = await hasSubscriptionPlanColumn("LockPdfForFreePlan");

  if (body.lockHintForFreePlan !== undefined && hasLockHint) {
    updates.push("LockHintForFreePlan = @lockHintForFreePlan");
    params.push({ name: "lockHintForFreePlan", type: TYPES.Bit, value: body.lockHintForFreePlan ? 1 : 0 });
  }
  if (body.lockPdfForFreePlan !== undefined && hasLockPdf) {
    updates.push("LockPdfForFreePlan = @lockPdfForFreePlan");
    params.push({ name: "lockPdfForFreePlan", type: TYPES.Bit, value: body.lockPdfForFreePlan ? 1 : 0 });
  }

  if (!updates.length) {
    return false;
  }

  await execQuery(
    `UPDATE dbo.SubscriptionPlan
     SET ${updates.join(", ")}
     WHERE PlanId = @planId`,
    params
  );

  if (body.planFeatures !== undefined) {
    await replacePlanFeatures(planId, body.planFeatures, 7);
  }
  return true;
}

router.put("/billing/admin/plans/:planId", requireAuth, async (req, res) => {
  if (req.user.role !== "AppAdmin") {
    return sendBillingError(res, 403, "BILLING_ADMIN_REQUIRED", "Only AppAdmin can update plans.");
  }
  const planId = Number(req.params.planId);
  if (!Number.isFinite(planId) || planId <= 0) {
    return sendBillingError(res, 400, "BILLING_INVALID_PLAN_ID", "Invalid plan id");
  }
  const body = AdminUpdatePlanBody.parse(req.body || {});
  const changed = await updateAdminPlanConfig(planId, body);
  if (!changed) {
    return sendBillingError(
      res,
      400,
      "BILLING_NO_APPLICABLE_PLAN_FIELDS",
      "No applicable fields to update. Run migration 2026-02-22_add_free_plan_feature_locks.sql for free-plan feature locks."
    );
  }

  const selectFields = [
    "PlanId",
    "PlanName",
    "Price",
    "DurationDays",
    "AIQuizLimit",
    "ManualQuizLimit",
    (await hasSubscriptionPlanColumn("DocumentUploadLimit"))
      ? "ISNULL(DocumentUploadLimit, 0) AS DocumentUploadLimit"
      : "CAST(0 AS INT) AS DocumentUploadLimit",
    (await hasSubscriptionPlanColumn("PerQuizDocumentLimit"))
      ? "ISNULL(PerQuizDocumentLimit, 1) AS PerQuizDocumentLimit"
      : "CAST(1 AS INT) AS PerQuizDocumentLimit",
    (await hasSubscriptionPlanColumn("MaxMcqsPerQuiz"))
      ? "ISNULL(MaxMcqsPerQuiz, 10) AS MaxMcqsPerQuiz"
      : "CAST(10 AS INT) AS MaxMcqsPerQuiz",
    (await hasSubscriptionPlanColumn("FlashcardOtherGenerateLimit"))
      ? "ISNULL(FlashcardOtherGenerateLimit, 0) AS FlashcardOtherGenerateLimit"
      : "CAST(0 AS INT) AS FlashcardOtherGenerateLimit",
    "IsActive",
  ];
  const updated = await execQuery(
    `SELECT ${selectFields.join(", ")}
     FROM dbo.SubscriptionPlan
     WHERE PlanId = @planId`,
    [{ name: "planId", type: TYPES.Int, value: planId }]
  );
  if (!updated.rows.length) {
    return sendBillingError(res, 404, "BILLING_PLAN_NOT_FOUND", "Plan not found.");
  }
  const featureMap = await getPlanFeaturesMap([planId]);
  return res.json({
    plan: {
      ...updated.rows[0],
      features: featureMap.get(planId) || [],
    },
  });
});

const AdminBatchUpdatePlansBody = z.object({
  plans: z.array(
    z.object({
      planId: z.number().int().positive(),
      planName: z.string().min(1).max(150).optional(),
      price: z.number().nonnegative().optional(),
      durationDays: z.number().int().positive().optional(),
      aiQuizLimit: z.number().int().nonnegative().optional(),
      manualQuizLimit: z.number().int().nonnegative().optional(),
      documentUploadLimit: z.number().int().min(0).max(1000).optional(),
      perQuizDocumentLimit: z.number().int().min(1).max(5).optional(),
      maxMcqsPerQuiz: z.number().int().positive().max(500).optional(),
      flashcardOtherGenerateLimit: z.number().int().min(0).max(1000).optional(),
      isActive: z.boolean().optional(),
      lockHintForFreePlan: z.boolean().optional(),
      lockPdfForFreePlan: z.boolean().optional(),
    })
  ).min(1),
});

router.put("/billing/admin/plans", requireAuth, async (req, res) => {
  if (req.user.role !== "AppAdmin") {
    return sendBillingError(res, 403, "BILLING_ADMIN_REQUIRED", "Only AppAdmin can update plans.");
  }
  const body = AdminBatchUpdatePlansBody.parse(req.body || {});
  let changedCount = 0;
  for (const row of body.plans) {
    const changed = await updateAdminPlanConfig(row.planId, row);
    if (changed) changedCount += 1;
  }
  if (!changedCount) {
    return sendBillingError(
      res,
      400,
      "BILLING_NO_APPLICABLE_PLAN_FIELDS",
      "No applicable fields to update. Run migration 2026-02-22_add_free_plan_feature_locks.sql for free-plan feature locks."
    );
  }
  const plans = await getBillingPlansRows("Teacher", true);
  const featureMap = await getPlanFeaturesMap((plans.rows || []).map((p) => p.PlanId));
  return res.json({
    ok: true,
    plans: (plans.rows || []).map((p) => ({
      ...p,
      features: featureMap.get(Number(p.PlanId)) || [],
    })),
  });
});

const AdminUpdatePlanFeaturesBody = z.object({
  plans: z.array(
    z.object({
      planId: z.number().int().positive(),
      planFeatures: z.array(z.string().trim().max(200)).max(20).optional(),
    })
  ).min(1),
});

router.put("/billing/admin/plan-features", requireAuth, async (req, res) => {
  if (req.user.role !== "AppAdmin") {
    return sendBillingError(res, 403, "BILLING_ADMIN_REQUIRED", "Only AppAdmin can update plans.");
  }
  const body = AdminUpdatePlanFeaturesBody.parse(req.body || {});
  for (const row of body.plans) {
    await replacePlanFeatures(row.planId, row.planFeatures || [], 7);
  }
  const plans = await getBillingPlansRows("Teacher", true);
  const featureMap = await getPlanFeaturesMap((plans.rows || []).map((p) => p.PlanId));
  return res.json({
    ok: true,
    plans: (plans.rows || []).map((p) => ({
      planId: p.PlanId,
      features: featureMap.get(Number(p.PlanId)) || [],
    })),
  });
});

async function stripeWebhookHandler(req, res) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Webhook secret not configured");
  }
  let event = null;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe().webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (await existsByStripeEventId(event.id)) {
      return res.json({ received: true, duplicate: true });
    }

    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription || null;
      const customerId = invoice.customer || null;
      const planCode = getPlanCodeFromInvoice(invoice);

      let userNameRegistryId = Number(invoice?.metadata?.userNameRegistryId || 0) || null;
      if (!userNameRegistryId && subscriptionId) userNameRegistryId = await findRegistryBySubscriptionId(subscriptionId);
      if (!userNameRegistryId && customerId) userNameRegistryId = await findRegistryByCustomerId(customerId);

      if (userNameRegistryId && planCode) {
        const reg = await execQuery(
          `SELECT TOP 1 UserType FROM dbo.UserNameRegistry WHERE UserNameRegistryId = @id`,
          [{ name: "id", type: TYPES.Int, value: userNameRegistryId }]
        );
        const userType = reg.rows[0]?.UserType || "TEACHER";
        const sub = subscriptionId ? await stripe().subscriptions.retrieve(subscriptionId) : null;
        const planStartUtc = sub?.current_period_start ? new Date(sub.current_period_start * 1000) : null;
        const planEndUtc = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null;

        await deactivateActivePayments(userNameRegistryId, "EXPIRED");
        await insertPaymentRow({
          userNameRegistryId,
          planCode,
          userType,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripeInvoiceId: invoice.id,
          stripeEventId: event.id,
          amount: Number(invoice.amount_paid || 0) / 100,
          currency: String(invoice.currency || "cad").toUpperCase(),
          billingCycle: "MONTHLY",
          planStartUtc,
          planEndUtc,
          paymentStatus: "ACTIVE",
          isActive: true,
        });
      }
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription || null;
      const customerId = invoice.customer || null;
      const planCode = getPlanCodeFromInvoice(invoice) || "UNKNOWN";
      let userNameRegistryId = Number(invoice?.metadata?.userNameRegistryId || 0) || null;
      if (!userNameRegistryId && subscriptionId) userNameRegistryId = await findRegistryBySubscriptionId(subscriptionId);
      if (!userNameRegistryId && customerId) userNameRegistryId = await findRegistryByCustomerId(customerId);
      if (userNameRegistryId) {
        const reg = await execQuery(
          `SELECT TOP 1 UserType FROM dbo.UserNameRegistry WHERE UserNameRegistryId = @id`,
          [{ name: "id", type: TYPES.Int, value: userNameRegistryId }]
        );
        const userType = reg.rows[0]?.UserType || "TEACHER";
        await insertPaymentRow({
          userNameRegistryId,
          planCode,
          userType,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripeInvoiceId: invoice.id,
          stripeEventId: event.id,
          amount: Number(invoice.amount_due || 0) / 100,
          currency: String(invoice.currency || "cad").toUpperCase(),
          billingCycle: "MONTHLY",
          paymentStatus: "FAILED",
          isActive: false,
        });
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const userNameRegistryId = (await findRegistryBySubscriptionId(sub.id)) || (await findRegistryByCustomerId(sub.customer));
      if (userNameRegistryId) {
        await deactivateActivePayments(userNameRegistryId, "CANCELLED");
      }
    } else if (event.type === "customer.subscription.updated") {
      // Subscription updates are acknowledged, but plan activation is driven by invoice.payment_succeeded.
    } else if (event.type === "checkout.session.completed") {
      // Checkout completion acknowledged; activation happens on invoice.payment_succeeded.
    }
    return res.json({ received: true });
  } catch (e) {
    return sendBillingError(res, 500, "BILLING_WEBHOOK_PROCESSING_FAILED", "Webhook processing failed", { detail: e.message });
  }
}

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
