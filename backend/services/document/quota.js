const { TYPES } = require("tedious");
const { execQuery } = require("../../db");
const { ensureTrialSubscription } = require("../subscription");
const { AppError } = require("./errors");

function normalizeRole(role) {
  return String(role || "") === "Manager" ? "Teacher" : String(role || "");
}

const DEFAULT_DOCUMENT_UPLOAD_LIMIT = Math.max(1, Number(process.env.DEFAULT_DOCUMENT_UPLOAD_LIMIT || 20));
const DEFAULT_PER_QUIZ_DOCUMENT_LIMIT = Math.max(1, Number(process.env.DEFAULT_PER_QUIZ_DOCUMENT_LIMIT || 1));

function quotaActorFromDocument(docRow) {
  if (Number(docRow?.TeacherId || 0) > 0) {
    return { userRole: "Teacher", userId: Number(docRow.TeacherId) };
  }
  if (Number(docRow?.StudentId || 0) > 0) {
    return { userRole: "Student", userId: Number(docRow.StudentId) };
  }
  return null;
}

async function ensureQuotaActorSubscription(userRole, userId) {
  const normalizedRole = normalizeRole(userRole);
  await ensureTrialSubscription(normalizedRole, userId);
  const sub = await execQuery(
    `SELECT TOP 1
        us.UserSubscriptionId,
        us.UserRole,
        us.UserId,
        us.StartDate,
        us.ExpiryDate,
        us.IsActive,
        sp.PlanName,
        ISNULL(sp.DocumentUploadLimit, 0) AS DocumentUploadLimit,
        ISNULL(sp.PerQuizDocumentLimit, 1) AS PerQuizDocumentLimit
     FROM dbo.UserSubscription us
     JOIN dbo.SubscriptionPlan sp ON sp.PlanId = us.PlanId
     WHERE us.UserRole = @role
       AND us.UserId = @userId
       AND us.IsActive = 1
     ORDER BY us.UserSubscriptionId DESC`,
    [
      { name: "role", type: TYPES.NVarChar, value: normalizedRole },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );
  return sub.rows[0] || null;
}

async function resolveRegistryIdForActor(userRole, userId) {
  const userType = String(normalizeRole(userRole)).toUpperCase();
  const registryType = userType === "TEACHER" ? "TEACHER" : userType === "STUDENT" ? "STUDENT" : userType;
  const r = await execQuery(
    `SELECT TOP 1 UserNameRegistryId
     FROM dbo.UserNameRegistry
     WHERE UserType = @userType
       AND UserId = @userId
       AND IsActive = 1`,
    [
      { name: "userType", type: TYPES.NVarChar, value: registryType },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );
  return Number(r.rows[0]?.UserNameRegistryId || 0) || null;
}

async function countUsedUploadsForPeriod(userRole, userId, startDate, endDate) {
  const registryId = await resolveRegistryIdForActor(userRole, userId);
  if (registryId) {
    const r = await execQuery(
      `SELECT COUNT(1) AS UsedCount
       FROM dbo.DocumentUpload
       WHERE OwnerUserNameRegistryId = @registryId
         AND Status = 'Extracted'
         AND CreatedAtUtc >= @startDate
         AND CreatedAtUtc < @endDate`,
      [
        { name: "registryId", type: TYPES.Int, value: registryId },
        { name: "startDate", type: TYPES.DateTime2, value: startDate },
        { name: "endDate", type: TYPES.DateTime2, value: endDate },
      ]
    );
    return Number(r.rows[0]?.UsedCount || 0);
  }
  const column = normalizeRole(userRole) === "Teacher" ? "TeacherId" : "StudentId";
  const r = await execQuery(
    `SELECT COUNT(1) AS UsedCount
     FROM dbo.DocumentUpload
     WHERE ${column} = @userId
       AND Status = 'Extracted'
       AND CreatedAtUtc >= @startDate
       AND CreatedAtUtc < @endDate`,
    [
      { name: "userId", type: TYPES.Int, value: userId },
      { name: "startDate", type: TYPES.DateTime2, value: startDate },
      { name: "endDate", type: TYPES.DateTime2, value: endDate },
    ]
  );
  return Number(r.rows[0]?.UsedCount || 0);
}

async function assertCanAttemptUpload(userRole, userId) {
  const sub = await ensureQuotaActorSubscription(userRole, userId);
  if (!sub) throw new AppError("QUOTA_EXCEEDED", "No active subscription.", 403);
  if (sub.ExpiryDate && new Date(sub.ExpiryDate).getTime() <= Date.now()) {
    throw new AppError("QUOTA_EXCEEDED", "Subscription expired.", 403);
  }
  const limit =
    Number(sub.DocumentUploadLimit || 0) > 0
      ? Number(sub.DocumentUploadLimit)
      : DEFAULT_DOCUMENT_UPLOAD_LIMIT;
  const used = await countUsedUploadsForPeriod(userRole, userId, sub.StartDate, sub.ExpiryDate);
  if (used >= limit) {
    throw new AppError("QUOTA_BLOCKED", "Quota exceeded.", 429);
  }
  return { sub, limit, used };
}

async function getPerQuizDocumentLimit(userRole, userId) {
  const sub = await ensureQuotaActorSubscription(userRole, userId);
  if (!sub) throw new AppError("FORBIDDEN", "No active subscription.", 403);
  const limit =
    Number(sub.PerQuizDocumentLimit || 0) > 0
      ? Number(sub.PerQuizDocumentLimit)
      : DEFAULT_PER_QUIZ_DOCUMENT_LIMIT;
  return { sub, limit };
}

module.exports = {
  quotaActorFromDocument,
  assertCanAttemptUpload,
  getPerQuizDocumentLimit,
  resolveRegistryIdForActor,
};
