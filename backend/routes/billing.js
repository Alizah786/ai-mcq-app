const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function getStripeClient() {
  const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secret) return { stripe: null, reason: "STRIPE_SECRET_KEY is not configured" };
  try {
    // eslint-disable-next-line global-require
    const Stripe = require("stripe");
    return { stripe: new Stripe(secret), reason: null };
  } catch (e) {
    return { stripe: null, reason: "Stripe SDK not installed. Run npm install stripe in backend." };
  }
}

const PLAN_CATALOG = {
  plus: { code: "plus", name: "Quiz Plus", quizLimit: 200, envPrice: "STRIPE_PRICE_PLUS" },
  unlimited: { code: "unlimited", name: "Quiz Plus Unlimited", quizLimit: 2000, envPrice: "STRIPE_PRICE_UNLIMITED" },
  family: { code: "family", name: "Quiz Family", quizLimit: 5000, envPrice: "STRIPE_PRICE_FAMILY" },
};

function getPlanOrNull(planCode) {
  if (!planCode) return null;
  return PLAN_CATALOG[String(planCode).trim().toLowerCase()] || null;
}

function getTargetTableByRole(role) {
  return role === "Manager" || role === "Teacher" ? "Teacher" : "Student";
}

function frontendBase(req) {
  return String(process.env.FRONTEND_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

async function findStudentByIdentifier(identifier) {
  const r = await execQuery(
    "SELECT TOP 1 StudentId, Email, FullName, QuizLimit, IsPaid, StripeCustomerId FROM dbo.Student WHERE Email = @email AND IsActive = 1",
    [{ name: "email", type: TYPES.NVarChar, value: identifier }]
  );
  return r.rows[0] || null;
}

async function applyPaidPlan({ studentId, planCode, stripeCustomerId }) {
  const plan = getPlanOrNull(planCode);
  if (!plan) throw new Error("Unknown plan");
  await execQuery(
    `UPDATE dbo.Student
     SET QuizLimit = @quizLimit,
         IsPaid = 1,
         PlanCode = @planCode,
         StripeCustomerId = COALESCE(@stripeCustomerId, StripeCustomerId)
     WHERE StudentId = @studentId`,
    [
      { name: "quizLimit", type: TYPES.Int, value: plan.quizLimit },
      { name: "planCode", type: TYPES.NVarChar, value: plan.code },
      { name: "stripeCustomerId", type: TYPES.NVarChar, value: stripeCustomerId || null },
      { name: "studentId", type: TYPES.Int, value: studentId },
    ]
  );
}

async function applyPaidPlanByRole({ role, userId, planCode, stripeCustomerId }) {
  const plan = getPlanOrNull(planCode);
  if (!plan) throw new Error("Unknown plan");
  const table = getTargetTableByRole(role);
  const idCol = role === "Manager" || role === "Teacher" ? "TeacherId" : "StudentId";
  await execQuery(
    `UPDATE dbo.${table}
     SET QuizLimit = @quizLimit,
         IsPaid = 1,
         PlanCode = @planCode,
         StripeCustomerId = COALESCE(@stripeCustomerId, StripeCustomerId)
     WHERE ${idCol} = @userId`,
    [
      { name: "quizLimit", type: TYPES.Int, value: plan.quizLimit },
      { name: "planCode", type: TYPES.NVarChar, value: plan.code },
      { name: "stripeCustomerId", type: TYPES.NVarChar, value: stripeCustomerId || null },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );
}

router.get("/billing/plans", (req, res) => {
  const plans = Object.values(PLAN_CATALOG).map((p) => ({
    code: p.code,
    name: p.name,
    quizLimit: p.quizLimit,
    configured: !!String(process.env[p.envPrice] || "").trim(),
  }));
  return res.json({ plans });
});

const CreateSessionBody = z.object({
  planCode: z.string().min(1),
});

router.post("/billing/checkout-session", requireAuth, async (req, res) => {
  try {
    const { stripe, reason } = getStripeClient();
    if (!stripe) return res.status(500).json({ message: reason });

    const { planCode } = CreateSessionBody.parse(req.body);
    const plan = getPlanOrNull(planCode);
    if (!plan) return res.status(400).json({ message: "Invalid plan code" });
    const priceId = String(process.env[plan.envPrice] || "").trim();
    if (!priceId) return res.status(400).json({ message: `Stripe price is not configured for plan '${plan.code}'` });

    const isManager = req.user.role === "Manager" || req.user.role === "Teacher";
    const table = isManager ? "Teacher" : "Student";
    const idCol = isManager ? "TeacherId" : "StudentId";
    const acct = await execQuery(
      `SELECT ${idCol} AS AccountId, Email, StripeCustomerId FROM dbo.${table} WHERE ${idCol} = @id AND IsActive = 1`,
      [{ name: "id", type: TYPES.Int, value: req.user.userId }]
    );
    const row = acct.rows[0];
    if (!row) return res.status(404).json({ message: "Student account not found" });

    const base = frontendBase(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: row.StripeCustomerId || undefined,
      customer_email: row.StripeCustomerId ? undefined : row.Email,
      success_url: `${base}/pricing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing?status=cancelled`,
      metadata: {
        role: req.user.role,
        userId: String(row.AccountId),
        email: row.Email,
        planCode: plan.code,
      },
    });

    return res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Failed to create checkout session", detail: e.message });
  }
});

const CreatePublicSessionBody = z.object({
  email: z.string().min(1),
  planCode: z.string().min(1),
  role: z.enum(["Student", "Teacher", "Manager"]).optional(),
});

router.post("/billing/checkout-session/public", async (req, res) => {
  try {
    const { stripe, reason } = getStripeClient();
    if (!stripe) return res.status(500).json({ message: reason });

    const { email, planCode, role } = CreatePublicSessionBody.parse(req.body);
    const plan = getPlanOrNull(planCode);
    if (!plan) return res.status(400).json({ message: "Invalid plan code" });
    const priceId = String(process.env[plan.envPrice] || "").trim();
    if (!priceId) return res.status(400).json({ message: `Stripe price is not configured for plan '${plan.code}'` });

    const targetRole = role === "Manager" || role === "Teacher" ? "Teacher" : "Student";
    let account = null;
    if (targetRole === "Teacher") {
      const r = await execQuery(
        "SELECT TOP 1 TeacherId AS AccountId, Email, StripeCustomerId FROM dbo.Teacher WHERE Email = @email AND IsActive = 1",
        [{ name: "email", type: TYPES.NVarChar, value: email.trim() }]
      );
      account = r.rows[0] || null;
    } else {
      const student = await findStudentByIdentifier(email.trim());
      account = student
        ? { AccountId: student.StudentId, Email: student.Email, StripeCustomerId: student.StripeCustomerId }
        : null;
    }
    if (!account) return res.status(404).json({ message: `${targetRole} account not found for this user name/email.` });

    const base = frontendBase(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: account.StripeCustomerId || undefined,
      customer_email: account.StripeCustomerId ? undefined : account.Email,
      success_url: `${base}/pricing?status=success&session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(account.Email)}&role=${encodeURIComponent(targetRole)}`,
      cancel_url: `${base}/pricing?status=cancelled&email=${encodeURIComponent(account.Email)}&role=${encodeURIComponent(targetRole)}`,
      metadata: {
        role: targetRole,
        userId: String(account.AccountId),
        email: account.Email,
        planCode: plan.code,
      },
    });

    return res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Failed to create checkout session", detail: e.message });
  }
});

const ConfirmBody = z.object({
  sessionId: z.string().min(1),
  email: z.string().min(1).optional(),
  role: z.enum(["Student", "Teacher", "Manager"]).optional(),
});

router.post("/billing/checkout/confirm", async (req, res) => {
  try {
    const { stripe, reason } = getStripeClient();
    if (!stripe) return res.status(500).json({ message: reason });

    const { sessionId, email, role } = ConfirmBody.parse(req.body);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) return res.status(404).json({ message: "Checkout session not found" });
    if (session.payment_status !== "paid") {
      return res.status(400).json({ message: "Payment is not completed yet." });
    }

    const planCode = session.metadata?.planCode;
    const roleFromMetaRaw = session.metadata?.role || role || "Student";
    const roleFromMeta = roleFromMetaRaw === "Manager" ? "Teacher" : roleFromMetaRaw;
    const userIdFromMeta = Number(session.metadata?.userId);
    const customerId = session.customer ? String(session.customer) : null;

    let userId = Number.isFinite(userIdFromMeta) && userIdFromMeta > 0 ? userIdFromMeta : null;
    if (!userId && email) {
      if (roleFromMeta === "Teacher") {
        const m = await execQuery(
          "SELECT TOP 1 TeacherId FROM dbo.Teacher WHERE Email = @email AND IsActive = 1",
          [{ name: "email", type: TYPES.NVarChar, value: email.trim() }]
        );
        userId = m.rows[0]?.TeacherId || null;
      } else {
        const s = await findStudentByIdentifier(email.trim());
        if (s) userId = s.StudentId;
      }
    }
    if (!userId) {
      return res.status(400).json({ message: "Could not resolve account for this payment." });
    }

    await applyPaidPlanByRole({ role: roleFromMeta, userId, planCode, stripeCustomerId: customerId });

    return res.json({
      message: "Payment confirmed and plan activated.",
      userId,
      role: roleFromMeta,
      planCode,
      paymentStatus: session.payment_status,
    });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Failed to confirm payment", detail: e.message });
  }
});

module.exports = router;

