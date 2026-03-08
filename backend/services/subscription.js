const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { PaymentRequiredError } = require("./paymentErrors");

function normalizeRole(role) {
  return role === "Manager" ? "Teacher" : role;
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

async function getPlanByCode(planCode) {
  const normalizedCode = String(planCode || "").toUpperCase();
  try {
    const r = await execQuery(
      `SELECT TOP 1
          PlanId, PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit,
          ISNULL(MaxMcqsPerQuiz, 10) AS MaxMcqsPerQuiz, IsActive,
          ISNULL(FlashcardOtherGenerateLimit, 0) AS FlashcardOtherGenerateLimit,
          ISNULL(AppliesToRole, 'Both') AS AppliesToRole,
          ISNULL(AnalyticsLevel, 'Basic') AS AnalyticsLevel
       FROM dbo.SubscriptionPlan
       ORDER BY PlanId`,
      []
    );
    return (r.rows || []).find((row) => planCodeFromName(row.PlanName, row.AppliesToRole) === normalizedCode) || null;
  } catch {
    const r = await execQuery(
      `SELECT PlanId, PlanName, Price, DurationDays, AIQuizLimit, ManualQuizLimit,
              ISNULL(MaxMcqsPerQuiz, 10) AS MaxMcqsPerQuiz,
              CAST(0 AS INT) AS FlashcardOtherGenerateLimit,
              IsActive
       FROM dbo.SubscriptionPlan`,
      []
    );
    return (r.rows || []).find((row) => planCodeFromName(row.PlanName, row.AppliesToRole) === normalizedCode) || null;
  }
}

async function deactivateExpiredSubscriptions(role, userId) {
  await execQuery(
    `UPDATE dbo.UserSubscription
     SET IsActive = 0
     WHERE UserRole = @role
       AND UserId = @userId
       AND IsActive = 1
       AND ExpiryDate < SYSUTCDATETIME()`,
    [
      { name: "role", type: TYPES.NVarChar, value: role },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );
}

async function getActiveUserSubscription(role, userId) {
  try {
    const r = await execQuery(
      `SELECT TOP 1
          us.UserSubscriptionId, us.UserId, us.UserRole, us.PlanId, us.StartDate, us.ExpiryDate,
          us.AIQuizUsed, us.ManualQuizUsed, us.IsTrial, us.IsActive,
          sp.PlanName, sp.Price, sp.DurationDays, sp.AIQuizLimit, sp.ManualQuizLimit,
          ISNULL(sp.MaxMcqsPerQuiz, 10) AS MaxMcqsPerQuiz,
          ISNULL(sp.FlashcardOtherGenerateLimit, 0) AS FlashcardOtherGenerateLimit,
          ISNULL(sp.AnalyticsLevel, 'Basic') AS AnalyticsLevel,
          ISNULL(sp.LockHintForFreePlan, 0) AS LockHintForFreePlan,
          ISNULL(sp.LockPdfForFreePlan, 0) AS LockPdfForFreePlan
       FROM dbo.UserSubscription us
       JOIN dbo.SubscriptionPlan sp ON sp.PlanId = us.PlanId
       WHERE us.UserRole = @role
         AND us.UserId = @userId
         AND us.IsActive = 1
       ORDER BY us.UserSubscriptionId DESC`,
      [
        { name: "role", type: TYPES.NVarChar, value: role },
        { name: "userId", type: TYPES.Int, value: userId },
      ]
    );
    return r.rows[0] || null;
  } catch {
    const r = await execQuery(
      `SELECT TOP 1
          us.UserSubscriptionId, us.UserId, us.UserRole, us.PlanId, us.StartDate, us.ExpiryDate,
          us.AIQuizUsed, us.ManualQuizUsed, us.IsTrial, us.IsActive,
          sp.PlanName, sp.Price, sp.DurationDays, sp.AIQuizLimit, sp.ManualQuizLimit,
          ISNULL(sp.MaxMcqsPerQuiz, 10) AS MaxMcqsPerQuiz,
          CAST(0 AS INT) AS FlashcardOtherGenerateLimit
       FROM dbo.UserSubscription us
       JOIN dbo.SubscriptionPlan sp ON sp.PlanId = us.PlanId
       WHERE us.UserRole = @role
         AND us.UserId = @userId
         AND us.IsActive = 1
       ORDER BY us.UserSubscriptionId DESC`,
      [
        { name: "role", type: TYPES.NVarChar, value: role },
        { name: "userId", type: TYPES.Int, value: userId },
      ]
    );
    return r.rows[0] || null;
  }
}

async function ensureTrialSubscription(roleRaw, userId) {
  const role = normalizeRole(roleRaw);
  await deactivateExpiredSubscriptions(role, userId);
  let active = await getActiveUserSubscription(role, userId);
  if (active) return active;

  const trialPlanCode = role === "Student" ? "FREE_STUDENT" : "FREE_TRIAL";
  let trialPlan = await getPlanByCode(trialPlanCode);
  if (!trialPlan && role === "Student") {
    trialPlan = await getPlanByCode("FREE_TRIAL");
  }
  if (!trialPlan) throw new Error("Free Trial plan is not configured.");

  const created = await execQuery(
    `INSERT INTO dbo.UserSubscription
       (UserId, UserRole, PlanId, StartDate, ExpiryDate, AIQuizUsed, ManualQuizUsed, IsTrial, IsActive)
     OUTPUT INSERTED.UserSubscriptionId
     VALUES
       (@userId, @role, @planId, SYSUTCDATETIME(), DATEADD(DAY, @durationDays, SYSUTCDATETIME()), 0, 0, 1, 1)`,
    [
      { name: "userId", type: TYPES.Int, value: userId },
      { name: "role", type: TYPES.NVarChar, value: role },
      { name: "planId", type: TYPES.Int, value: trialPlan.PlanId },
      { name: "durationDays", type: TYPES.Int, value: trialPlan.DurationDays },
    ]
  );
  if (!created.rows[0]?.UserSubscriptionId) throw new Error("Failed to start trial subscription.");
  if (role === "Student") {
    await upsertStudentSubscription(userId, "FREE", trialPlan.DurationDays, true);
  }
  active = await getActiveUserSubscription(role, userId);
  return active;
}

async function upsertStudentSubscription(studentId, planType, durationDays, isTrial = false) {
  try {
    await execQuery(
      `UPDATE dbo.StudentSubscription
       SET IsActive = 0
       WHERE StudentId = @studentId
         AND IsActive = 1`,
      [{ name: "studentId", type: TYPES.Int, value: studentId }]
    );

    await execQuery(
      `INSERT INTO dbo.StudentSubscription
         (StudentId, PlanType, StartDate, ExpiryDate, AIPracticeUsed, IsActive)
       VALUES
         (@studentId, @planType, SYSUTCDATETIME(), DATEADD(DAY, @durationDays, SYSUTCDATETIME()), 0, 1)`,
      [
        { name: "studentId", type: TYPES.Int, value: studentId },
        { name: "planType", type: TYPES.NVarChar, value: isTrial ? "FREE" : planType },
        { name: "durationDays", type: TYPES.Int, value: durationDays },
      ]
    );
  } catch {
    // StudentSubscription is optional during staged rollout.
  }
}

async function getUsageCounts(roleRaw, userId, startDate, expiryDate) {
  const role = normalizeRole(roleRaw);
  if (role === "Teacher") {
    const r = await execQuery(
      `SELECT
          SUM(CASE WHEN UPPER(ISNULL(q.SourceType, '')) LIKE 'AI%' THEN ISNULL(qc.QuestionCount, 0) ELSE 0 END) AS AIUsed,
          SUM(CASE WHEN UPPER(ISNULL(q.SourceType, '')) LIKE 'AI%' THEN 0 ELSE 1 END) AS ManualUsed
       FROM dbo.Quiz q
       JOIN dbo.Class c ON c.ClassId = q.ClassId
       JOIN dbo.Student s ON s.StudentId = c.StudentId
       LEFT JOIN (
         SELECT QuizId, COUNT(1) AS QuestionCount
         FROM dbo.QuizQuestion
         GROUP BY QuizId
       ) qc ON qc.QuizId = q.QuizId
       WHERE s.TeacherId = @userId
         AND q.CreateDate >= @startDate
         AND q.CreateDate < @expiryDate`,
      [
        { name: "userId", type: TYPES.Int, value: userId },
        { name: "startDate", type: TYPES.DateTime2, value: startDate },
        { name: "expiryDate", type: TYPES.DateTime2, value: expiryDate },
      ]
    );
    return {
      aiUsed: Number(r.rows[0]?.AIUsed || 0),
      manualUsed: Number(r.rows[0]?.ManualUsed || 0),
    };
  }

  const r = await execQuery(
    `SELECT
        SUM(CASE WHEN UPPER(ISNULL(q.SourceType, '')) LIKE 'AI%' THEN ISNULL(qc.QuestionCount, 0) ELSE 0 END) AS AIUsed,
        SUM(CASE WHEN UPPER(ISNULL(q.SourceType, '')) LIKE 'AI%' THEN 0 ELSE 1 END) AS ManualUsed
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     LEFT JOIN (
       SELECT QuizId, COUNT(1) AS QuestionCount
       FROM dbo.QuizQuestion
       GROUP BY QuizId
     ) qc ON qc.QuizId = q.QuizId
     WHERE c.StudentId = @userId
       AND q.CreateDate >= @startDate
       AND q.CreateDate < @expiryDate`,
    [
      { name: "userId", type: TYPES.Int, value: userId },
      { name: "startDate", type: TYPES.DateTime2, value: startDate },
      { name: "expiryDate", type: TYPES.DateTime2, value: expiryDate },
    ]
  );
  return {
    aiUsed: Number(r.rows[0]?.AIUsed || 0),
    manualUsed: Number(r.rows[0]?.ManualUsed || 0),
  };
}

async function getStudyToolGenerateUsage(roleRaw, userId, startDate, expiryDate) {
  const role = normalizeRole(roleRaw);
  const r = await execQuery(
    `SELECT COUNT(1) AS GenerateUsed
     FROM dbo.StudyMaterialVersion v
     JOIN dbo.StudyMaterialSet s
       ON s.StudyMaterialSetId = v.StudyMaterialSetId
     LEFT JOIN dbo.StudyMaterialJob j
       ON j.StudyMaterialSetId = v.StudyMaterialSetId
      AND j.VersionNo = v.VersionNo
     WHERE s.OwnerUserId = @userId
       AND s.OwnerRole = @role
       AND v.CreatedAtUtc >= @startDate
       AND v.CreatedAtUtc < @expiryDate
       AND (j.StudyMaterialJobId IS NULL OR j.Status IN ('Queued','Processing','Succeeded','Retrying'))`,
    [
      { name: "userId", type: TYPES.Int, value: userId },
      { name: "role", type: TYPES.NVarChar, value: role },
      { name: "startDate", type: TYPES.DateTime2, value: startDate },
      { name: "expiryDate", type: TYPES.DateTime2, value: expiryDate },
    ]
  );
  return Number(r.rows[0]?.GenerateUsed || 0);
}

async function getSubscriptionStatus(roleRaw, userId) {
  const role = normalizeRole(roleRaw);
  const sub = await ensureTrialSubscription(role, userId);
  const now = new Date();
  const expired = new Date(sub.ExpiryDate) <= now;
  const usage = await getUsageCounts(role, userId, sub.StartDate, sub.ExpiryDate);
  const aiLimit = Number(sub.AIQuizLimit || 0);
  const manualLimit = Number(sub.ManualQuizLimit || 0);
  const maxMcqsPerQuiz = Number(sub.MaxMcqsPerQuiz || 10);
  const flashcardOtherGenerateLimit = Number(sub.FlashcardOtherGenerateLimit || 0);
  const flashcardOtherGenerateUsed = await getStudyToolGenerateUsage(role, userId, sub.StartDate, sub.ExpiryDate);
  const analyticsLevel = String(sub.AnalyticsLevel || "Basic");
  const isStudent = role === "Student";
  const canUseAIPractice = !expired && (isStudent ? aiLimit > 0 : true);
  const advancedAnalyticsEnabled =
    !isStudent || !expired || analyticsLevel.toLowerCase() === "advanced";
  const isFreePlan = !!sub.IsTrial || Number(sub.Price || 0) <= 0;
  const lockHintForFreePlan = !!sub.LockHintForFreePlan;
  const lockPdfForFreePlan = !!sub.LockPdfForFreePlan;

  return {
    userSubscriptionId: sub.UserSubscriptionId,
    role,
    planId: sub.PlanId,
    planName: sub.PlanName,
    price: Number(sub.Price || 0),
    durationDays: Number(sub.DurationDays || 0),
    startDate: sub.StartDate,
    expiryDate: sub.ExpiryDate,
    isTrial: !!sub.IsTrial,
    isActive: !!sub.IsActive,
    isExpired: expired,
    aiLimit,
    manualLimit,
    maxMcqsPerQuiz,
    flashcardOtherGenerateLimit,
    flashcardOtherGenerateUsed,
    flashcardOtherGenerateRemaining:
      flashcardOtherGenerateLimit > 0
        ? Math.max(flashcardOtherGenerateLimit - flashcardOtherGenerateUsed, 0)
        : null,
    aiUsed: usage.aiUsed,
    manualUsed: usage.manualUsed,
    aiRemaining: Math.max(aiLimit - usage.aiUsed, 0),
    manualRemaining: Math.max(manualLimit - usage.manualUsed, 0),
    analyticsLevel,
    canUseAIPractice,
    advancedAnalyticsEnabled,
    isStudentPostTrialLocked: isStudent && expired,
    isFreePlan,
    lockHintForFreePlan,
    lockPdfForFreePlan,
  };
}

async function assertCanCreateQuiz(roleRaw, userId, kind = "manual", extra = 1) {
  const status = await getSubscriptionStatus(roleRaw, userId);
  const role = normalizeRole(roleRaw);
  if (status.isExpired) {
    if (role === "Student" && String(kind || "").toLowerCase() === "ai") {
      throw new PaymentRequiredError("You have reached free AI practice limit. Upgrade to continue.");
    }
    throw new PaymentRequiredError("Your free trial has expired. Please upgrade to continue creating quizzes.");
  }
  const lowerKind = String(kind || "manual").toLowerCase();
  if (lowerKind === "ai") {
    if (status.aiUsed + extra > status.aiLimit) {
      throw new PaymentRequiredError("You have reached your monthly quiz limit. Upgrade to continue.");
    }
  } else if (status.manualUsed + extra > status.manualLimit) {
    throw new PaymentRequiredError("You have reached your monthly quiz limit. Upgrade to continue.");
  }
  return status;
}

async function assertCanGenerateStudyTools(roleRaw, userId, extra = 1) {
  const status = await getSubscriptionStatus(roleRaw, userId);
  const role = normalizeRole(roleRaw);
  if (status.isExpired) {
    if (role === "Student") {
      throw new PaymentRequiredError("Your free trial has expired. Upgrade to continue generating notes and flash cards.");
    }
    throw new PaymentRequiredError("Your plan has expired. Upgrade to continue generating notes and flash cards.");
  }
  if (
    Number(status.flashcardOtherGenerateLimit || 0) > 0 &&
    Number(status.flashcardOtherGenerateUsed || 0) + Number(extra || 1) > Number(status.flashcardOtherGenerateLimit || 0)
  ) {
    throw new PaymentRequiredError("You have reached your plan limit for FlashCard-Other generation. Upgrade to continue.");
  }
  return status;
}

async function activatePlanForUser(roleRaw, userId, planId) {
  const role = normalizeRole(roleRaw);
  let plan = null;
  try {
    plan = await execQuery(
      `SELECT TOP 1
          PlanId, PlanName, DurationDays, IsActive,
          ISNULL(AppliesToRole, 'Both') AS AppliesToRole
       FROM dbo.SubscriptionPlan
       WHERE PlanId = @planId`,
      [{ name: "planId", type: TYPES.Int, value: planId }]
    );
  } catch {
    plan = await execQuery(
      `SELECT TOP 1 PlanId, PlanName, DurationDays, IsActive
       FROM dbo.SubscriptionPlan
       WHERE PlanId = @planId`,
      [{ name: "planId", type: TYPES.Int, value: planId }]
    );
  }
  const selected = plan.rows[0];
  if (!selected || !selected.IsActive) throw new Error("Selected plan is not available.");
  if (selected.AppliesToRole && selected.AppliesToRole !== "Both" && selected.AppliesToRole !== role) {
    throw new Error("Selected plan does not apply to this user role.");
  }

  await execQuery(
    `UPDATE dbo.UserSubscription
     SET IsActive = 0
     WHERE UserRole = @role
       AND UserId = @userId
       AND IsActive = 1`,
    [
      { name: "role", type: TYPES.NVarChar, value: role },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );

  await execQuery(
    `INSERT INTO dbo.UserSubscription
       (UserId, UserRole, PlanId, StartDate, ExpiryDate, AIQuizUsed, ManualQuizUsed, IsTrial, IsActive)
     VALUES
       (@userId, @role, @planId, SYSUTCDATETIME(), DATEADD(DAY, @durationDays, SYSUTCDATETIME()), 0, 0, 0, 1)`,
    [
      { name: "userId", type: TYPES.Int, value: userId },
      { name: "role", type: TYPES.NVarChar, value: role },
      { name: "planId", type: TYPES.Int, value: selected.PlanId },
      { name: "durationDays", type: TYPES.Int, value: selected.DurationDays },
    ]
  );

  if (role === "Student") {
    let planType = "BASIC";
    const selectedPlanCode = planCodeFromName(selected.PlanName, selected.AppliesToRole);
    if (selectedPlanCode === "STUDENT_PRO") planType = "PRO";
    else if (selectedPlanCode === "FREE_STUDENT" || selectedPlanCode === "FREE_TRIAL") planType = "FREE";
    await upsertStudentSubscription(userId, planType, selected.DurationDays, planType === "FREE");
  }

  return getSubscriptionStatus(role, userId);
}

module.exports = {
  normalizeRole,
  ensureTrialSubscription,
  getSubscriptionStatus,
  assertCanCreateQuiz,
  assertCanGenerateStudyTools,
  activatePlanForUser,
};
