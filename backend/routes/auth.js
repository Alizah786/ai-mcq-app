const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { comparePassword, signToken, requireAuth, hashPassword } = require("../auth");
const { TYPES } = require("tedious");
const { ensureTrialSubscription, getSubscriptionStatus } = require("../services/subscription");
const { logUsageEventByActor } = require("../services/usageEvents");
const { DEFAULT_PREFERENCE, normalizeLocalePreference, resolveEffectiveLocale } = require("../services/locale");

const router = express.Router();
const SYSTEM_TEACHER_EMAIL = "system-fallback-teacher@local";
const SYSTEM_TEACHER_NAME = "System Fallback Teacher";
const APP_ADMIN_CODE = "Ali991786";

const LoginBody = z.object({
  identifier: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1),
  adminCode: z.string().optional(),
  userType: z.enum(["Student", "Teacher", "Manager", "Principal", "AppAdmin"]).optional(),
});

const SignupBody = z.object({
  email: z.string().min(1).optional(),
  fullName: z.string().min(1).max(120).optional(),
  userName: z.string().min(1).max(120).optional(),
  studentCode: z.string().min(1).max(120).optional(),
  password: z.string().min(6).max(128),
  disclaimerAcknowledged: z.literal(true),
  disclaimerId: z.number().int().positive().optional(),
  userType: z.enum(["Student", "Teacher", "Manager"]).optional(),
});

const ResolveRoleQuery = z.object({
  identifier: z.string().min(1),
});

function sendError(res, status, errorCode, message, extra = {}) {
  return res.status(status).json({ errorCode, message, ...extra });
}

async function hasTeacherShortNameColumn() {
  try {
    const r = await execQuery(
      `SELECT CASE WHEN COL_LENGTH('dbo.Teacher', 'ShortName') IS NULL THEN 0 ELSE 1 END AS HasShortName`
    );
    return Number(r.rows[0]?.HasShortName || 0) === 1;
  } catch {
    return false;
  }
}

async function loadLocalePreferenceForUser(user) {
  const role = user?.role;
  if (role === "Manager") {
    const r = await execQuery("SELECT LocalePreference FROM dbo.Teacher WHERE TeacherId = @id", [
      { name: "id", type: TYPES.Int, value: user.userId },
    ]).catch(() => ({ rows: [] }));
    return normalizeLocalePreference(r.rows[0]?.LocalePreference) || DEFAULT_PREFERENCE;
  }
  if (role === "Student") {
    const r = await execQuery("SELECT LocalePreference FROM dbo.Student WHERE StudentId = @id", [
      { name: "id", type: TYPES.Int, value: user.userId },
    ]).catch(() => ({ rows: [] }));
    return normalizeLocalePreference(r.rows[0]?.LocalePreference) || DEFAULT_PREFERENCE;
  }
  if (role === "Principal") {
    const r = await execQuery("SELECT LocalePreference FROM dbo.Principal WHERE PrincipalId = @id", [
      { name: "id", type: TYPES.Int, value: user.userId },
    ]).catch(() => ({ rows: [] }));
    return normalizeLocalePreference(r.rows[0]?.LocalePreference) || DEFAULT_PREFERENCE;
  }
  if (role === "AppAdmin") {
    const r = await execQuery("SELECT LocalePreference FROM dbo.AppAdmin WHERE AppAdminId = @id", [
      { name: "id", type: TYPES.Int, value: user.userId },
    ]).catch(() => ({ rows: [] }));
    return normalizeLocalePreference(r.rows[0]?.LocalePreference) || DEFAULT_PREFERENCE;
  }
  return DEFAULT_PREFERENCE;
}

const DEFAULT_SIGNUP_DISCLAIMER = {
  DisclaimerId: null,
  Title: "General Terms and Disclaimer",
  DisclaimerText:
    "By creating an account, you agree to use this platform for lawful educational purposes only. You are responsible for protecting your account credentials and for content uploaded or created under your account. You must review and validate quizzes, answers, grading rules, and AI-assisted output before academic use. The platform provides tools and drafting assistance only and does not guarantee correctness, completeness, or fitness for formal evaluation.",
  DisclaimerType: "GENERAL",
  Version: "default",
  IsActive: true,
};

const UpdateProfileBody = z.object({
  instructorNameLabel: z.string().trim().max(120).optional(),
});

async function getActiveDisclaimerByType(type) {
  try {
    const result = await execQuery(
      `SELECT TOP 1 DisclaimerId, Title, DisclaimerText, DisclaimerType, Version, IsActive
       FROM dbo.Disclaimer
       WHERE DisclaimerType = @type
         AND IsActive = 1
       ORDER BY DisclaimerId DESC`,
      [{ name: "type", type: TYPES.NVarChar, value: type }]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

router.get("/signup-disclaimer", async (_req, res) => {
  const general = (await getActiveDisclaimerByType("GENERAL")) || DEFAULT_SIGNUP_DISCLAIMER;
  return res.json({ general });
});

router.put("/profile", requireAuth, async (req, res) => {
  if (req.user.role === "AppAdmin") {
    return sendError(res, 400, "AUTH_PROFILE_NOT_APPLICABLE", "Profile updates are not supported for AppAdmin.");
  }
  const body = UpdateProfileBody.parse(req.body || {});
  const isTeacher = req.user.role === "Manager" || req.user.displayRole === "Teacher" || req.user.role === "Teacher";
  if (!isTeacher) {
    return res.json({ ok: true, instructorNameLabel: null });
  }
  if (!(await hasTeacherShortNameColumn())) {
    return res.json({ ok: true, instructorNameLabel: null, migrationRequired: true });
  }

  const instructorNameLabel = String(body.instructorNameLabel || "").trim() || null;
  await execQuery(
    `UPDATE dbo.Teacher
     SET ShortName = @shortName
     WHERE TeacherId = @teacherId`,
    [
      { name: "shortName", type: TYPES.NVarChar, value: instructorNameLabel },
      { name: "teacherId", type: TYPES.Int, value: req.user.userId },
    ]
  );

  return res.json({ ok: true, instructorNameLabel });
});

async function getOrCreatePrincipalIdByEmail(email, fullName) {
  const trimmedEmail = String(email || "").trim().toLowerCase();
  const atPosForLookup = trimmedEmail.indexOf("@");
  const lookupLocal = atPosForLookup > -1 ? trimmedEmail.slice(0, atPosForLookup) : trimmedEmail;
  const lookupDomain = atPosForLookup > -1 ? trimmedEmail.slice(atPosForLookup + 1) : "local";
  const lookupAlias = `principal+${lookupLocal}@${lookupDomain}`.slice(0, 255);
  const existing = await execQuery(
    "SELECT TOP 1 PrincipalId FROM dbo.Principal WHERE Email IN (@email, @aliasEmail)",
    [
      { name: "email", type: TYPES.NVarChar, value: trimmedEmail },
      { name: "aliasEmail", type: TYPES.NVarChar, value: lookupAlias },
    ]
  );
  if (existing.rows.length) return existing.rows[0].PrincipalId;

  const aliasBase = trimmedEmail || `principal_${Date.now()}@local`;
  const atPos = aliasBase.indexOf("@");
  const local = atPos > -1 ? aliasBase.slice(0, atPos) : aliasBase;
  const domain = atPos > -1 ? aliasBase.slice(atPos + 1) : "local";
  const candidate1 = `principal+${local}@${domain}`.slice(0, 255);
  const candidate2 = `principal+${local}+${Date.now()}@${domain}`.slice(0, 255);
  const candidate3 = `principal_${Date.now()}_${Math.floor(Math.random() * 100000)}@local`.slice(0, 255);
  const principalCandidates = [candidate1, candidate2, candidate3];

  let principalEmail = principalCandidates[0];
  for (const c of principalCandidates) {
    try {
      const taken = await execQuery(
        `SELECT TOP 1 1
         FROM dbo.UserNameRegistry
         WHERE NormalizedUserName = LOWER(LTRIM(RTRIM(@userName)))
           AND IsActive = 1`,
        [{ name: "userName", type: TYPES.NVarChar, value: c }]
      );
      if (!taken.rows.length) {
        principalEmail = c;
        break;
      }
    } catch {
      principalEmail = c;
      break;
    }
  }

  const inserted = await execQuery(
    `INSERT INTO dbo.Principal (Email, FullName, IsActive)
     VALUES (@email, @fullName, 1)`,
    [
      { name: "email", type: TYPES.NVarChar, value: principalEmail },
      { name: "fullName", type: TYPES.NVarChar, value: fullName || trimmedEmail || principalEmail },
    ]
  );
  const created = await execQuery(
    "SELECT TOP 1 PrincipalId FROM dbo.Principal WHERE Email = @email",
    [{ name: "email", type: TYPES.NVarChar, value: principalEmail }]
  );
  return created.rows[0]?.PrincipalId || null;
}

async function ensureTeacherPrincipal(teacherId, email, fullName) {
  if (!teacherId) return null;
  const row = await execQuery(
    "SELECT TeacherId, PrincipalId, Email, FullName FROM dbo.Teacher WHERE TeacherId = @teacherId",
    [{ name: "teacherId", type: TYPES.Int, value: teacherId }]
  );
  const teacher = row.rows[0];
  if (!teacher) return null;
  if (teacher.PrincipalId) return teacher.PrincipalId;
  const principalId = await getOrCreatePrincipalIdByEmail(email || teacher.Email, fullName || teacher.FullName);
  await execQuery(
    "UPDATE dbo.Teacher SET PrincipalId = @principalId WHERE TeacherId = @teacherId",
    [
      { name: "principalId", type: TYPES.Int, value: principalId },
      { name: "teacherId", type: TYPES.Int, value: teacherId },
    ]
  );
  return principalId;
}

async function ensureStudentPrincipal(studentId, teacherId, email, fullName) {
  if (!studentId) return null;
  const row = await execQuery(
    "SELECT StudentId, PrincipalId, TeacherId, Email, FullName FROM dbo.Student WHERE StudentId = @studentId",
    [{ name: "studentId", type: TYPES.Int, value: studentId }]
  );
  const student = row.rows[0];
  if (!student) return null;
  if (student.PrincipalId) return student.PrincipalId;

  let principalId = null;
  const targetTeacherId = teacherId || student.TeacherId;
  if (targetTeacherId) {
    const t = await execQuery(
      "SELECT TeacherId, PrincipalId, Email, FullName FROM dbo.Teacher WHERE TeacherId = @teacherId",
      [{ name: "teacherId", type: TYPES.Int, value: targetTeacherId }]
    );
    const teacher = t.rows[0];
    if (teacher) {
      principalId = teacher.PrincipalId || (await ensureTeacherPrincipal(teacher.TeacherId, teacher.Email, teacher.FullName));
    }
  }
  if (!principalId) {
    principalId = await getOrCreatePrincipalIdByEmail(email || student.Email, fullName || student.FullName);
  }
  await execQuery(
    "UPDATE dbo.Student SET PrincipalId = @principalId WHERE StudentId = @studentId",
    [
      { name: "principalId", type: TYPES.Int, value: principalId },
      { name: "studentId", type: TYPES.Int, value: studentId },
    ]
  );
  return principalId;
}

async function getOrCreateSystemTeacherId() {
  const existing = await execQuery(
    "SELECT TOP 1 TeacherId FROM dbo.Teacher WHERE Email = @email",
    [{ name: "email", type: TYPES.NVarChar, value: SYSTEM_TEACHER_EMAIL }]
  );
  if (existing.rows.length) return existing.rows[0].TeacherId;

  const systemPasswordHash = await hashPassword(`SYSTEM_DISABLED_${Date.now()}`);
  await execQuery(
    `INSERT INTO dbo.Teacher (PrincipalId, Email, FullName, PasswordHash, IsActive, QuizLimit)
     VALUES (@principalId, @email, @fullName, @passwordHash, 0, 40)`,
    [
      { name: "principalId", type: TYPES.Int, value: await getOrCreatePrincipalIdByEmail(SYSTEM_TEACHER_EMAIL, SYSTEM_TEACHER_NAME) },
      { name: "email", type: TYPES.NVarChar, value: SYSTEM_TEACHER_EMAIL },
      { name: "fullName", type: TYPES.NVarChar, value: SYSTEM_TEACHER_NAME },
      { name: "passwordHash", type: TYPES.NVarChar, value: systemPasswordHash },
    ]
  );
  const created = await execQuery(
    "SELECT TOP 1 TeacherId FROM dbo.Teacher WHERE Email = @email ORDER BY TeacherId DESC",
    [{ name: "email", type: TYPES.NVarChar, value: SYSTEM_TEACHER_EMAIL }]
  );
  return created.rows[0]?.TeacherId;
}

/** POST /api/auth/signup - free student signup */
router.post("/signup", async (req, res) => {
  try {
    const body = SignupBody.parse(req.body);
    const activeGeneralDisclaimer = await getActiveDisclaimerByType("GENERAL");
    if (!body.disclaimerAcknowledged) {
      return sendError(res, 400, "AUTH_SIGNUP_DISCLAIMER_REQUIRED", "You must accept the signup terms to create an account.");
    }
    if (activeGeneralDisclaimer) {
      if (!body.disclaimerId) {
        return sendError(res, 400, "AUTH_SIGNUP_DISCLAIMER_ID_REQUIRED", "Signup disclaimer selection is required.");
      }
      if (Number(body.disclaimerId) !== Number(activeGeneralDisclaimer.DisclaimerId)) {
        return sendError(res, 400, "AUTH_SIGNUP_DISCLAIMER_INVALID", "Invalid signup disclaimer selected.");
      }
    }
    const passwordHash = await hashPassword(body.password);
    const role = body.userType === "Manager" ? "Teacher" : (body.userType || "Student");

    if (role === "Teacher") {
      if (!body.email || !body.fullName) {
        return sendError(
          res,
          400,
          "AUTH_SIGNUP_TEACHER_FIELDS_REQUIRED",
          "Email and full name are required for teacher signup."
        );
      }
      await execQuery(
        `INSERT INTO dbo.Teacher (PrincipalId, Email, FullName, PasswordHash, IsActive, QuizLimit)
         VALUES (@principalId, @email, @fullName, @passwordHash, 1, 40)`,
        [
          { name: "principalId", type: TYPES.Int, value: await getOrCreatePrincipalIdByEmail(body.email.trim(), body.fullName.trim()) },
          { name: "email", type: TYPES.NVarChar, value: body.email.trim() },
          { name: "fullName", type: TYPES.NVarChar, value: body.fullName.trim() },
          { name: "passwordHash", type: TYPES.NVarChar, value: passwordHash },
        ]
      );
      const teacherLookup = await execQuery(
        `SELECT TOP 1 TeacherId, Email, FullName, QuizLimit, PrincipalId
         FROM dbo.Teacher
         WHERE Email = @email
         ORDER BY TeacherId DESC`,
        [{ name: "email", type: TYPES.NVarChar, value: body.email.trim() }]
      );
      const row = teacherLookup.rows[0];
      if (!row) {
        return sendError(res, 500, "AUTH_SIGNUP_FAILED", "Signup failed");
      }
      return res.status(201).json({
        message: "Signup successful",
        user: {
          userId: row.TeacherId,
          email: row.Email,
          displayName: row.FullName,
          role: "Teacher",
          principalId: row.PrincipalId || null,
          quizLimit: Number(row.QuizLimit || 40),
        },
      });
    }

    if (!body.userName || !body.studentCode) {
      return sendError(
        res,
        400,
        "AUTH_SIGNUP_STUDENT_FIELDS_REQUIRED",
        "UserName and student code are required for student signup."
      );
    }
    const principalId = await getOrCreatePrincipalIdByEmail(body.userName.trim(), body.studentCode.trim());
    let systemTeacherId = null;
    try {
      const autoTeacherPasswordHash = await hashPassword(`AUTO_TEACHER_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      const autoTeacherEmail = `autot_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000)}@local`;
      await execQuery(
        `INSERT INTO dbo.Teacher (PrincipalId, Email, FullName, PasswordHash, IsActive, QuizLimit)
         VALUES (@principalId, @email, @fullName, @passwordHash, 1, 40)`,
        [
          { name: "principalId", type: TYPES.Int, value: principalId },
          { name: "email", type: TYPES.NVarChar, value: autoTeacherEmail },
          { name: "fullName", type: TYPES.NVarChar, value: `${body.studentCode.trim()} Teacher` },
          { name: "passwordHash", type: TYPES.NVarChar, value: autoTeacherPasswordHash },
        ]
      );
      const autoTeacherLookup = await execQuery(
        "SELECT TOP 1 TeacherId FROM dbo.Teacher WHERE Email = @email ORDER BY TeacherId DESC",
        [{ name: "email", type: TYPES.NVarChar, value: autoTeacherEmail }]
      );
      systemTeacherId = autoTeacherLookup.rows[0]?.TeacherId || null;
    } catch {
      systemTeacherId = null;
    }
    if (!systemTeacherId) {
      systemTeacherId = await getOrCreateSystemTeacherId();
    }
    await execQuery(
      `INSERT INTO dbo.Student (PrincipalId, TeacherId, Email, FullName, PasswordHash, IsActive, QuizLimit)
       VALUES (@principalId, @managerId, @email, @fullName, @passwordHash, 1, 40)`,
      [
        { name: "principalId", type: TYPES.Int, value: principalId },
        { name: "managerId", type: TYPES.Int, value: systemTeacherId },
        { name: "email", type: TYPES.NVarChar, value: body.userName.trim() },
        { name: "fullName", type: TYPES.NVarChar, value: body.studentCode.trim() },
        { name: "passwordHash", type: TYPES.NVarChar, value: passwordHash },
      ]
    );
    const studentLookup = await execQuery(
      `SELECT TOP 1 StudentId, Email, FullName, QuizLimit, TeacherId, PrincipalId
       FROM dbo.Student
       WHERE Email = @email
       ORDER BY StudentId DESC`,
      [{ name: "email", type: TYPES.NVarChar, value: body.userName.trim() }]
    );
    const row = studentLookup.rows[0];
    if (!row) {
      return sendError(res, 500, "AUTH_SIGNUP_FAILED", "Signup failed");
    }

    return res.status(201).json({
      message: "Signup successful",
      user: {
        userId: row.StudentId,
        userName: row.Email,
        studentCode: row.FullName,
        displayName: row.FullName,
        role: "Student",
        managerId: row.TeacherId || null,
        principalId: row.PrincipalId || null,
        quizLimit: Number(row.QuizLimit || 40),
      },
    });
  } catch (e) {
    console.error("Signup failed:", e);
    if (e.name === "ZodError") {
      return sendError(res, 400, "AUTH_INVALID_INPUT", "Invalid input", { errors: e.errors });
    }
    const msg = String(e.message || "");
    if (
      msg.includes("UX_Student_Email") ||
      msg.includes("UX_Teacher_Email") ||
      msg.includes("UX_Principal_Email") ||
      msg.includes("UX_UserNameRegistry_NormalizedUserName") ||
      msg.includes("duplicate")
    ) {
      return sendError(
        res,
        409,
        "AUTH_IDENTIFIER_ALREADY_REGISTERED",
        "Account identifier already registered."
      );
    }
    return sendError(res, 500, "AUTH_SIGNUP_FAILED", "Signup failed", { detail: e.message });
  }
});

/** POST /api/auth/login - returns { token, user: { userId, email, displayName, role } } */
router.post("/login", async (req, res) => {
  try {
    const { identifier, email, password, userType, adminCode } = LoginBody.parse(req.body);
    const loginId = (identifier || email || "").trim();
    if (!loginId) {
      return sendError(res, 400, "AUTH_IDENTIFIER_REQUIRED", "User name is required.");
    }

    const adminRes = await execQuery(
      "SELECT TOP 1 AppAdminId, UserName, PasswordHash FROM dbo.AppAdmin WHERE UserName = @userName AND IsActive = 1",
      [{ name: "userName", type: TYPES.NVarChar, value: loginId }]
    );
    if (adminRes.rows.length) {
      const admin = adminRes.rows[0];
      const ok = await comparePassword(password, admin.PasswordHash);
      if (!ok) {
        return sendError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid user name or password");
      }
      if (String(adminCode || "").trim() !== APP_ADMIN_CODE) {
        return sendError(res, 401, "AUTH_INVALID_ADMIN_CODE", "Invalid admin security code");
      }
      const token = signToken({
        userId: admin.AppAdminId,
        email: admin.UserName,
        userName: admin.UserName,
        role: "AppAdmin",
        displayName: "Application Admin",
      });
      return res.json({
        token,
        user: {
          userId: admin.AppAdminId,
          email: admin.UserName,
          userName: admin.UserName,
          displayName: "Application Admin",
          role: "AppAdmin",
        },
      });
    }

    const role = (userType === "Manager" || userType === "Principal") ? "Teacher" : (userType || "Student");

    if (role === "Teacher") {
      let r = null;
      try {
        r = await execQuery(
          "SELECT TeacherId, Email, FullName, PasswordHash, QuizLimit, RecoveryEmail, MustChangePassword FROM dbo.Teacher WHERE Email = @email AND IsActive = 1",
          [{ name: "email", type: TYPES.NVarChar, value: loginId }]
        );
      } catch {
        r = await execQuery(
          "SELECT TeacherId, Email, FullName, PasswordHash, QuizLimit FROM dbo.Teacher WHERE Email = @email AND IsActive = 1",
          [{ name: "email", type: TYPES.NVarChar, value: loginId }]
        );
      }
      if (!r.rows.length) {
        return sendError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
      }
      const user = r.rows[0];
      const ok = await comparePassword(password, user.PasswordHash);
      if (!ok) {
        return sendError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
      }
      const principalId = await ensureTeacherPrincipal(user.TeacherId, user.Email, user.FullName);
      await ensureTrialSubscription("Teacher", user.TeacherId);
      const subscription = await getSubscriptionStatus("Teacher", user.TeacherId);
      const quizCount = (subscription.aiUsed || 0) + (subscription.manualUsed || 0);
      const quizLimit = (subscription.aiLimit || 0) + (subscription.manualLimit || 0);
      const token = signToken({
        userId: user.TeacherId,
        email: user.Email,
        role: "Teacher",
        displayName: user.FullName,
        principalId: principalId || null,
        quizLimit,
        mustChangePassword: !!user.MustChangePassword,
        recoveryEmail: user.RecoveryEmail || null,
        subscription,
      });
      logUsageEventByActor({
        role: "Teacher",
        userId: user.TeacherId,
        eventType: "LOGIN",
        quantity: 1,
      }).catch(() => {});
      return res.json({
        token,
        user: {
          userId: user.TeacherId,
          email: user.Email,
          displayName: user.FullName,
          role: "Teacher",
          principalId: principalId || null,
          quizLimit,
          quizCount,
          mustChangePassword: !!user.MustChangePassword,
          recoveryEmail: user.RecoveryEmail || null,
          subscription,
        },
      });
    }

    let r = null;
    try {
      r = await execQuery(
        `SELECT s.StudentId, s.Email, s.FullName, s.PasswordHash, s.TeacherId, s.PrincipalId,
                s.RecoveryEmail, s.MustChangePassword, t.Email AS TeacherEmail, t.IsActive AS TeacherIsActive
         FROM dbo.Student s
         LEFT JOIN dbo.Teacher t ON t.TeacherId = s.TeacherId
         WHERE s.Email = @email AND s.IsActive = 1`,
        [{ name: "email", type: TYPES.NVarChar, value: loginId }]
      );
    } catch {
      r = await execQuery(
        `SELECT s.StudentId, s.Email, s.FullName, s.PasswordHash, s.TeacherId, s.PrincipalId,
                t.Email AS TeacherEmail, t.IsActive AS TeacherIsActive
         FROM dbo.Student s
         LEFT JOIN dbo.Teacher t ON t.TeacherId = s.TeacherId
         WHERE s.Email = @email AND s.IsActive = 1`,
        [{ name: "email", type: TYPES.NVarChar, value: loginId }]
      );
    }
    if (!r.rows.length) {
      return sendError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid user name or password");
    }
    const user = r.rows[0];
    const ok = await comparePassword(password, user.PasswordHash);
    if (!ok) {
      return sendError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid user name or password");
    }
    const principalId = await ensureStudentPrincipal(user.StudentId, user.TeacherId, user.Email, user.FullName);
    await ensureTrialSubscription("Student", user.StudentId);
    const subscription = await getSubscriptionStatus("Student", user.StudentId);
    const quizCount = (subscription.aiUsed || 0) + (subscription.manualUsed || 0);
    const quizLimit = (subscription.aiLimit || 0) + (subscription.manualLimit || 0);
    const teacherEmail = String(user.TeacherEmail || "").toLowerCase();
    const isDirectStudent = !!teacherEmail && (teacherEmail.endsWith("@local") || teacherEmail === SYSTEM_TEACHER_EMAIL);
    const teacherUserName =
      !!user.TeacherIsActive && !!teacherEmail && !teacherEmail.endsWith("@local")
        ? String(user.TeacherEmail)
        : null;
    const token = signToken({
      userId: user.StudentId,
      email: user.Email,
      userName: user.Email,
      role: "Student",
      displayName: user.FullName,
      studentCode: user.FullName,
      managerId: user.TeacherId || null,
      principalId: principalId || user.PrincipalId || null,
      quizLimit,
      isDirectStudent,
      teacherUserName,
      mustChangePassword: !!user.MustChangePassword,
      recoveryEmail: user.RecoveryEmail || null,
      subscription,
    });
    logUsageEventByActor({
      role: "Student",
      userId: user.StudentId,
      eventType: "LOGIN",
      quantity: 1,
    }).catch(() => {});
    res.json({
      token,
      user: {
        userId: user.StudentId,
        email: user.Email,
        userName: user.Email,
        studentCode: user.FullName,
        displayName: user.FullName,
        role: "Student",
        managerId: user.TeacherId || null,
        principalId: principalId || user.PrincipalId || null,
        quizLimit,
        quizCount,
        isDirectStudent,
        teacherUserName,
        mustChangePassword: !!user.MustChangePassword,
        recoveryEmail: user.RecoveryEmail || null,
        subscription,
      },
    });
  } catch (e) {
    if (e.name === "ZodError") {
      return sendError(res, 400, "AUTH_INVALID_INPUT", "Invalid input", { errors: e.errors });
    }
    throw e;
  }
});

/** GET /api/auth/resolve-role?identifier=... - detect existing account role for login dropdown */
router.get("/resolve-role", async (req, res) => {
  try {
    const { identifier } = ResolveRoleQuery.parse(req.query);
    const loginId = identifier.trim();
    if (!loginId) return res.json({ role: null });

    const teacher = await execQuery(
      "SELECT TOP 1 TeacherId FROM dbo.Teacher WHERE Email = @email AND IsActive = 1",
      [{ name: "email", type: TYPES.NVarChar, value: loginId }]
    );
    if (teacher.rows.length) return res.json({ role: "Teacher" });

    const student = await execQuery(
      "SELECT TOP 1 StudentId FROM dbo.Student WHERE Email = @email AND IsActive = 1",
      [{ name: "email", type: TYPES.NVarChar, value: loginId }]
    );
    if (student.rows.length) return res.json({ role: "Student" });

    const principal = await execQuery(
      "SELECT TOP 1 PrincipalId FROM dbo.Principal WHERE Email = @email AND IsActive = 1",
      [{ name: "email", type: TYPES.NVarChar, value: loginId }]
    );
    if (principal.rows.length) return res.json({ role: "Principal" });

    const appAdmin = await execQuery(
      "SELECT TOP 1 AppAdminId FROM dbo.AppAdmin WHERE UserName = @userName AND IsActive = 1",
      [{ name: "userName", type: TYPES.NVarChar, value: loginId }]
    );
    if (appAdmin.rows.length) return res.json({ role: "AppAdmin" });

    return res.json({ role: null });
  } catch {
    return res.json({ role: null });
  }
});

/** GET /api/auth/me - return current user (requires auth) */
router.get("/me", requireAuth, async (req, res) => {
  const localePreference = await loadLocalePreferenceForUser(req.user).catch(() => DEFAULT_PREFERENCE);
  const effectiveLocale = resolveEffectiveLocale({
    localePreference,
    acceptLanguageHeader: req.headers["accept-language"],
  });
  if (req.user.role === "AppAdmin") {
    return res.json({
      userId: req.user.userId,
      email: req.user.email,
      userName: req.user.userName || req.user.email,
      studentCode: null,
      displayName: req.user.displayName || "Application Admin",
      role: "AppAdmin",
      managerId: null,
      principalId: null,
      mustChangePassword: false,
      recoveryEmail: null,
      quizLimit: 0,
      quizCount: 0,
      subscription: null,
      localePreference,
      effectiveLocale,
    });
  }
  const roleNormalized = req.user.displayRole || (req.user.role === "Manager" ? "Teacher" : req.user.role);
  const subRole = roleNormalized === "Teacher" ? "Teacher" : "Student";
  const subscription = await getSubscriptionStatus(subRole, req.user.userId);
  const quizLimit = (subscription.aiLimit || 0) + (subscription.manualLimit || 0);
  const quizCount = (subscription.aiUsed || 0) + (subscription.manualUsed || 0);
  const roleOut = roleNormalized;
  let mustChangePassword = !!req.user.mustChangePassword;
  let recoveryEmail = req.user.recoveryEmail || null;
  let instructorNameLabel = req.user.instructorNameLabel || null;
  try {
    if (roleOut === "Teacher") {
      const teacherHasShortName = await hasTeacherShortNameColumn();
      const t = await execQuery(
        teacherHasShortName
          ? "SELECT MustChangePassword, RecoveryEmail, ShortName FROM dbo.Teacher WHERE TeacherId = @id"
          : "SELECT MustChangePassword, RecoveryEmail FROM dbo.Teacher WHERE TeacherId = @id",
        [{ name: "id", type: TYPES.Int, value: req.user.userId }]
      );
      if (t.rows.length) {
        mustChangePassword = !!t.rows[0].MustChangePassword;
        recoveryEmail = t.rows[0].RecoveryEmail || null;
        instructorNameLabel = teacherHasShortName
          ? (String(t.rows[0].ShortName || "").trim() || req.user.displayName || null)
          : (req.user.displayName || null);
      }
    } else {
      const s = await execQuery(
        `SELECT s.MustChangePassword, s.RecoveryEmail, t.Email AS TeacherEmail, t.IsActive AS TeacherIsActive
         FROM dbo.Student s
         LEFT JOIN dbo.Teacher t ON t.TeacherId = s.TeacherId
         WHERE s.StudentId = @id`,
        [{ name: "id", type: TYPES.Int, value: req.user.userId }]
      );
      if (s.rows.length) {
        mustChangePassword = !!s.rows[0].MustChangePassword;
        recoveryEmail = s.rows[0].RecoveryEmail || null;
        const tEmail = String(s.rows[0].TeacherEmail || "").toLowerCase();
        req.user.teacherUserName =
          !!s.rows[0].TeacherIsActive && !!tEmail && !tEmail.endsWith("@local")
            ? String(s.rows[0].TeacherEmail)
            : null;
      }
    }
  } catch {
    // Migration may not be applied yet.
  }
  res.json({
    userId: req.user.userId,
    email: req.user.email,
    userName: req.user.userName || req.user.email,
    studentCode: req.user.studentCode || req.user.displayName,
    displayName: req.user.displayName,
    role: roleOut,
    managerId: req.user.managerId || null,
    principalId: req.user.principalId || null,
    teacherUserName: req.user.teacherUserName || null,
    instructorNameLabel,
    isDirectStudent: !!req.user.isDirectStudent,
    mustChangePassword,
    recoveryEmail,
    quizLimit,
    quizCount,
    subscription,
    localePreference,
    effectiveLocale,
  });
});

module.exports = router;

