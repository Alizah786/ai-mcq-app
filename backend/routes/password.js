const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth, hashPassword, comparePassword } = require("../auth");

const router = express.Router();

const TOKEN_TTL_MINUTES = 20;
const FORGOT_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_LIMIT_IP_MAX = 20;
const FORGOT_LIMIT_IDENT_MAX = 5;
const forgotByIp = new Map();
const forgotByIdent = new Map();

function nowMs() {
  return Date.now();
}

function cleanOld(map, windowMs) {
  const n = nowMs();
  for (const [k, arr] of map.entries()) {
    const keep = arr.filter((t) => n - t <= windowMs);
    if (keep.length) map.set(k, keep);
    else map.delete(k);
  }
}

function pushHit(map, key) {
  const arr = map.get(key) || [];
  arr.push(nowMs());
  map.set(key, arr);
  return arr.length;
}

function getIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.ip || req.connection?.remoteAddress || "unknown";
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function normalizeUserType(v) {
  const t = String(v || "").trim().toUpperCase();
  return t === "TEACHER" ? "TEACHER" : t === "STUDENT" ? "STUDENT" : null;
}

function tokenHash(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function generateResetToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function validatePasswordStrength(password) {
  const v = String(password || "");
  if (v.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

async function safeLogResetEvent({
  userType,
  userId,
  isSuccess,
  failureReason,
  ip,
  userAgent,
  completed = false,
}) {
  try {
    await execQuery(
      `INSERT INTO dbo.PasswordResetLog
         (UserType, UserId, RequestedAt, RequestedIp, RequestedUserAgent, CompletedAt, IsSuccess, FailureReason)
       VALUES
         (@userType, @userId, SYSUTCDATETIME(), @ip, @ua, ${completed ? "SYSUTCDATETIME()" : "NULL"}, @isSuccess, @failureReason)`,
      [
        { name: "userType", type: TYPES.NVarChar, value: String(userType || "UNKNOWN").toUpperCase() },
        { name: "userId", type: TYPES.Int, value: Number(userId) || 0 },
        { name: "ip", type: TYPES.NVarChar, value: ip || null },
        { name: "ua", type: TYPES.NVarChar, value: userAgent || null },
        { name: "isSuccess", type: TYPES.Bit, value: isSuccess ? 1 : 0 },
        { name: "failureReason", type: TYPES.NVarChar, value: failureReason || null },
      ]
    );
  } catch {
    // Audit log must never break auth flow.
  }
}

function tableByType(userType) {
  return userType === "TEACHER" ? { table: "dbo.Teacher", idCol: "TeacherId" } : { table: "dbo.Student", idCol: "StudentId" };
}

const ForgotBody = z.object({
  userType: z.string(),
  userName: z.string().min(1).max(150).optional(),
  fullName: z.string().min(1).max(120).optional(),
  recoveryEmail: z.string().min(3).max(150),
  userId: z.number().int().positive().optional(),
});

const RecoverUserNameBody = z.object({
  recoveryEmail: z.string().min(3).max(150),
});

router.post("/password/forgot", async (req, res) => {
  const generic = { message: "If the account exists, we sent password reset instructions." };
  let body = null;
  try {
    body = ForgotBody.parse(req.body || {});
  } catch {
    return res.json(generic);
  }

  const userType = normalizeUserType(body.userType);
  const userName = String(body.userName || body.fullName || "").trim();
  if (!userName) return res.json(generic);
  const recoveryEmail = normalizeEmail(body.recoveryEmail);
  const identKey = `${userType || "UNKNOWN"}|${userName.toLowerCase()}|${recoveryEmail}`;
  const ip = getIp(req);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 256);

  cleanOld(forgotByIp, FORGOT_LIMIT_WINDOW_MS);
  cleanOld(forgotByIdent, FORGOT_LIMIT_WINDOW_MS);
  const ipHits = pushHit(forgotByIp, ip);
  const identHits = pushHit(forgotByIdent, identKey);
  if (ipHits > FORGOT_LIMIT_IP_MAX || identHits > FORGOT_LIMIT_IDENT_MAX) {
    await safeLogResetEvent({
      userType: userType || "UNKNOWN",
      userId: body.userId || 0,
      isSuccess: 0,
      failureReason: "Rate limit exceeded",
      ip,
      userAgent,
    });
    return res.json(generic);
  }

  if (!userType) {
    await safeLogResetEvent({
      userType: "UNKNOWN",
      userId: body.userId || 0,
      isSuccess: 0,
      failureReason: "Invalid userType",
      ip,
      userAgent,
    });
    return res.json(generic);
  }

  const { table, idCol } = tableByType(userType);
  const sql = `
    SELECT ${idCol} AS UserId, Email, RecoveryEmail
    FROM ${table}
    WHERE Email = @userName
      AND LOWER(ISNULL(RecoveryEmail, '')) = @recoveryEmail
      AND (@userId IS NULL OR ${idCol} = @userId)
      AND IsActive = 1`;

  const match = await execQuery(sql, [
    { name: "userName", type: TYPES.NVarChar, value: userName },
    { name: "recoveryEmail", type: TYPES.NVarChar, value: recoveryEmail },
    { name: "userId", type: TYPES.Int, value: body.userId || null },
  ]);

  if (match.rows.length === 1) {
    const userId = Number(match.rows[0].UserId);
    const plainToken = generateResetToken();
    const hash = tokenHash(plainToken);
    await execQuery(
      `UPDATE ${table}
       SET ResetTokenHash = @hash,
           ResetTokenExpiry = DATEADD(MINUTE, @ttl, SYSUTCDATETIME())
       WHERE ${idCol} = @userId`,
      [
        { name: "hash", type: TYPES.NVarChar, value: hash },
        { name: "ttl", type: TYPES.Int, value: TOKEN_TTL_MINUTES },
        { name: "userId", type: TYPES.Int, value: userId },
      ]
    );

    await safeLogResetEvent({
      userType,
      userId,
      isSuccess: 1,
      failureReason: null,
      ip,
      userAgent,
    });

    // Phase-1 simulation only; never return token to client.
    void plainToken;
  } else {
    await safeLogResetEvent({
      userType,
      userId: body.userId || 0,
      isSuccess: 0,
      failureReason: match.rows.length > 1 ? "Ambiguous match" : "No account match",
      ip,
      userAgent,
    });
  }

  return res.json(generic);
});

router.post("/password/recover-username", async (req, res) => {
  const genericMessage = "If the account exists, we sent username recovery instructions.";
  let body = null;
  try {
    body = RecoverUserNameBody.parse(req.body || {});
  } catch {
    return res.json({ message: genericMessage });
  }

  const recoveryEmail = normalizeEmail(body.recoveryEmail);
  const ip = getIp(req);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 256);

  const teachers = await execQuery(
    `SELECT TOP 10
        'TEACHER' AS UserType,
        TeacherId AS UserId,
        Email AS UserName
      FROM dbo.Teacher
      WHERE LOWER(ISNULL(RecoveryEmail, '')) = @recoveryEmail
        AND IsActive = 1`,
    [{ name: "recoveryEmail", type: TYPES.NVarChar, value: recoveryEmail }]
  );
  const students = await execQuery(
    `SELECT TOP 10
        'STUDENT' AS UserType,
        StudentId AS UserId,
        Email AS UserName
      FROM dbo.Student
      WHERE LOWER(ISNULL(RecoveryEmail, '')) = @recoveryEmail
        AND IsActive = 1`,
    [{ name: "recoveryEmail", type: TYPES.NVarChar, value: recoveryEmail }]
  );

  const recovered = [...teachers.rows, ...students.rows]
    .map((r) => ({
      userType: String(r.UserType || ""),
      userId: Number(r.UserId) || 0,
      userName: String(r.UserName || "").trim(),
    }))
    .filter((r) => r.userId > 0 && r.userName)
    .slice(0, 10);

  if (recovered.length) {
    for (const row of recovered) {
      await safeLogResetEvent({
        userType: row.userType,
        userId: row.userId,
        isSuccess: 1,
        failureReason: "Username recovery lookup",
        ip,
        userAgent,
      });
    }
    return res.json({
      message: genericMessage,
      recoveredUserNames: recovered.map((r) => ({ userType: r.userType, userName: r.userName })),
    });
  }

  await safeLogResetEvent({
    userType: "UNKNOWN",
    userId: 0,
    isSuccess: 0,
    failureReason: "No account match for username recovery",
    ip,
    userAgent,
  });
  return res.json({ message: genericMessage });
});

const ResetBody = z.object({
  userType: z.string(),
  token: z.string().min(16),
  newPassword: z.string().min(8).max(128),
});

router.post("/password/reset", async (req, res) => {
  const ip = getIp(req);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 256);

  let body = null;
  try {
    body = ResetBody.parse(req.body || {});
  } catch {
    return res.status(400).json({ message: "Invalid or expired token." });
  }

  const userType = normalizeUserType(body.userType);
  if (!userType) return res.status(400).json({ message: "Invalid or expired token." });
  const strengthError = validatePasswordStrength(body.newPassword);
  if (strengthError) return res.status(400).json({ message: strengthError });

  const { table, idCol } = tableByType(userType);
  const hash = tokenHash(body.token);
  const matched = await execQuery(
    `SELECT ${idCol} AS UserId
     FROM ${table}
     WHERE ResetTokenHash = @hash
       AND ResetTokenExpiry > SYSUTCDATETIME()
       AND IsActive = 1`,
    [{ name: "hash", type: TYPES.NVarChar, value: hash }]
  );

  if (matched.rows.length !== 1) {
    await safeLogResetEvent({
      userType,
      userId: 0,
      isSuccess: 0,
      failureReason: "Invalid/expired token",
      ip,
      userAgent,
      completed: true,
    });
    return res.status(400).json({ message: "Invalid or expired token." });
  }

  const userId = Number(matched.rows[0].UserId);
  const newHash = await hashPassword(body.newPassword);
  await execQuery(
    `UPDATE ${table}
     SET PasswordHash = @passwordHash,
         ResetTokenHash = NULL,
         ResetTokenExpiry = NULL,
         MustChangePassword = 0
     WHERE ${idCol} = @userId`,
    [
      { name: "passwordHash", type: TYPES.NVarChar, value: newHash },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );

  await safeLogResetEvent({
    userType,
    userId,
    isSuccess: 1,
    failureReason: null,
    ip,
    userAgent,
    completed: true,
  });

  return res.json({ message: "Password updated. Please login." });
});

const SetRecoveryEmailBody = z.object({
  recoveryEmail: z.string().min(3).max(150),
});

router.post("/password/set-recovery-email", requireAuth, async (req, res) => {
  const body = SetRecoveryEmailBody.parse(req.body || {});
  const recoveryEmail = normalizeEmail(body.recoveryEmail);
  const isTeacher = req.user.role === "Manager" || req.user.displayRole === "Teacher";
  const table = isTeacher ? "dbo.Teacher" : "dbo.Student";
  const idCol = isTeacher ? "TeacherId" : "StudentId";

  await execQuery(
    `UPDATE ${table}
     SET RecoveryEmail = @email,
         EmailVerified = 0
     WHERE ${idCol} = @userId`,
    [
      { name: "email", type: TYPES.NVarChar, value: recoveryEmail },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  return res.json({ ok: true, recoveryEmail, emailVerified: false });
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

router.post("/password/change", requireAuth, async (req, res) => {
  const body = ChangePasswordBody.parse(req.body || {});
  const strengthError = validatePasswordStrength(body.newPassword);
  if (strengthError) return res.status(400).json({ message: strengthError });

  const isTeacher = req.user.role === "Manager" || req.user.displayRole === "Teacher";
  const table = isTeacher ? "dbo.Teacher" : "dbo.Student";
  const idCol = isTeacher ? "TeacherId" : "StudentId";

  const u = await execQuery(
    `SELECT ${idCol} AS UserId, PasswordHash
     FROM ${table}
     WHERE ${idCol} = @userId AND IsActive = 1`,
    [{ name: "userId", type: TYPES.Int, value: req.user.userId }]
  );
  if (!u.rows.length) return res.status(404).json({ message: "User not found." });
  const ok = await comparePassword(body.currentPassword, u.rows[0].PasswordHash);
  if (!ok) return res.status(400).json({ message: "Current password is incorrect." });

  const newHash = await hashPassword(body.newPassword);
  await execQuery(
    `UPDATE ${table}
     SET PasswordHash = @passwordHash,
         MustChangePassword = 0,
         ResetTokenHash = NULL,
         ResetTokenExpiry = NULL
     WHERE ${idCol} = @userId`,
    [
      { name: "passwordHash", type: TYPES.NVarChar, value: newHash },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );

  return res.json({ message: "Password updated successfully.", mustChangePassword: false });
});

async function manualTeacherReset(req, res) {
  const teacherId = Number(req.params.teacherId);
  if (!Number.isFinite(teacherId) || teacherId <= 0) return res.status(400).json({ message: "Invalid teacher id." });
  if (req.user.role !== "Manager") return res.status(403).json({ message: "Forbidden" });

  const exists = await execQuery(
    "SELECT TeacherId FROM dbo.Teacher WHERE TeacherId = @teacherId AND IsActive = 1",
    [{ name: "teacherId", type: TYPES.Int, value: teacherId }]
  );
  if (!exists.rows.length) return res.status(404).json({ message: "Teacher not found." });

  const tempPassword = `Tmp${crypto.randomBytes(4).toString("hex")}!9`;
  const passHash = await hashPassword(tempPassword);
  await execQuery(
    `UPDATE dbo.Teacher
     SET PasswordHash = @hash,
         MustChangePassword = 1,
         ResetTokenHash = NULL,
         ResetTokenExpiry = NULL
     WHERE TeacherId = @teacherId`,
    [
      { name: "hash", type: TYPES.NVarChar, value: passHash },
      { name: "teacherId", type: TYPES.Int, value: teacherId },
    ]
  );

  await safeLogResetEvent({
    userType: "TEACHER",
    userId: teacherId,
    isSuccess: 1,
    failureReason: "Manual reset by admin/teacher",
    ip: getIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 256),
    completed: true,
  });
  return res.json({ message: "Temporary password generated.", temporaryPassword: tempPassword, mustChangePassword: true });
}

async function manualStudentReset(req, res) {
  const studentId = Number(req.params.studentId);
  if (!Number.isFinite(studentId) || studentId <= 0) return res.status(400).json({ message: "Invalid student id." });
  if (req.user.role !== "Manager") return res.status(403).json({ message: "Forbidden" });

  const exists = await execQuery(
    "SELECT StudentId FROM dbo.Student WHERE StudentId = @studentId AND TeacherId = @managerId AND IsActive = 1",
    [
      { name: "studentId", type: TYPES.Int, value: studentId },
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!exists.rows.length) return res.status(404).json({ message: "Student not found." });

  const tempPassword = `Tmp${crypto.randomBytes(4).toString("hex")}!9`;
  const passHash = await hashPassword(tempPassword);
  await execQuery(
    `UPDATE dbo.Student
     SET PasswordHash = @hash,
         MustChangePassword = 1,
         ResetTokenHash = NULL,
         ResetTokenExpiry = NULL
     WHERE StudentId = @studentId`,
    [
      { name: "hash", type: TYPES.NVarChar, value: passHash },
      { name: "studentId", type: TYPES.Int, value: studentId },
    ]
  );

  await safeLogResetEvent({
    userType: "STUDENT",
    userId: studentId,
    isSuccess: 1,
    failureReason: "Manual reset by teacher",
    ip: getIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 256),
    completed: true,
  });
  return res.json({ message: "Temporary password generated.", temporaryPassword: tempPassword, mustChangePassword: true });
}

router.post("/admin/teacher/:teacherId/reset-password", requireAuth, manualTeacherReset);
router.post("/teacher/students/:studentId/reset-password", requireAuth, manualStudentReset);

module.exports = router;
