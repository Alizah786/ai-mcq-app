const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { comparePassword, signToken, requireAuth, hashPassword } = require("../auth");
const { TYPES } = require("tedious");
const {
  getStudentQuizCount,
  getStudentQuizLimit,
  getManagerQuizCount,
  getManagerQuizLimit,
} = require("../services/quizQuota");

const router = express.Router();
const SYSTEM_TEACHER_EMAIL = "system-fallback-teacher@local";
const SYSTEM_TEACHER_NAME = "System Fallback Teacher";

const LoginBody = z.object({
  identifier: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1),
  userType: z.enum(["Student", "Teacher", "Manager", "Principal"]).optional(),
});

const SignupBody = z.object({
  email: z.string().min(1).optional(),
  fullName: z.string().min(1).max(120).optional(),
  userName: z.string().min(1).max(120).optional(),
  studentCode: z.string().min(1).max(120).optional(),
  password: z.string().min(6).max(128),
  userType: z.enum(["Student", "Teacher", "Manager"]).optional(),
});

const ResolveRoleQuery = z.object({
  identifier: z.string().min(1),
});

async function getOrCreatePrincipalIdByEmail(email, fullName) {
  const existing = await execQuery(
    "SELECT TOP 1 PrincipalId FROM dbo.Principal WHERE Email = @email",
    [{ name: "email", type: TYPES.NVarChar, value: email }]
  );
  if (existing.rows.length) return existing.rows[0].PrincipalId;

  const inserted = await execQuery(
    `INSERT INTO dbo.Principal (Email, FullName, IsActive)
     OUTPUT INSERTED.PrincipalId
     VALUES (@email, @fullName, 1)`,
    [
      { name: "email", type: TYPES.NVarChar, value: email },
      { name: "fullName", type: TYPES.NVarChar, value: fullName || email },
    ]
  );
  return inserted.rows[0]?.PrincipalId || null;
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
  const inserted = await execQuery(
    `INSERT INTO dbo.Teacher (PrincipalId, Email, FullName, PasswordHash, IsActive, QuizLimit)
     OUTPUT INSERTED.TeacherId
     VALUES (@principalId, @email, @fullName, @passwordHash, 0, 40)`,
    [
      { name: "principalId", type: TYPES.Int, value: await getOrCreatePrincipalIdByEmail(SYSTEM_TEACHER_EMAIL, SYSTEM_TEACHER_NAME) },
      { name: "email", type: TYPES.NVarChar, value: SYSTEM_TEACHER_EMAIL },
      { name: "fullName", type: TYPES.NVarChar, value: SYSTEM_TEACHER_NAME },
      { name: "passwordHash", type: TYPES.NVarChar, value: systemPasswordHash },
    ]
  );
  return inserted.rows[0]?.TeacherId;
}

/** POST /api/auth/signup - free student signup */
router.post("/signup", async (req, res) => {
  try {
    const body = SignupBody.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const role = body.userType === "Manager" ? "Teacher" : (body.userType || "Student");

    if (role === "Teacher") {
      if (!body.email || !body.fullName) {
        return res.status(400).json({ message: "Email and full name are required for teacher signup." });
      }
      const inserted = await execQuery(
        `INSERT INTO dbo.Teacher (PrincipalId, Email, FullName, PasswordHash, IsActive, QuizLimit)
         OUTPUT INSERTED.TeacherId, INSERTED.Email, INSERTED.FullName, INSERTED.QuizLimit, INSERTED.PrincipalId
         VALUES (@principalId, @email, @fullName, @passwordHash, 1, 40)`,
        [
          { name: "principalId", type: TYPES.Int, value: await getOrCreatePrincipalIdByEmail(body.email.trim(), body.fullName.trim()) },
          { name: "email", type: TYPES.NVarChar, value: body.email.trim() },
          { name: "fullName", type: TYPES.NVarChar, value: body.fullName.trim() },
          { name: "passwordHash", type: TYPES.NVarChar, value: passwordHash },
        ]
      );
      const row = inserted.rows[0];
      if (!row) return res.status(500).json({ message: "Signup failed" });
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
      return res.status(400).json({ message: "UserName and student code are required for student signup." });
    }
    const principalId = await getOrCreatePrincipalIdByEmail(body.userName.trim(), body.studentCode.trim());
    const autoTeacherPasswordHash = await hashPassword(`AUTO_TEACHER_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const autoTeacherEmail = `teacher_${body.userName.trim()}_${Date.now()}@local`;
    const autoTeacher = await execQuery(
      `INSERT INTO dbo.Teacher (PrincipalId, Email, FullName, PasswordHash, IsActive, QuizLimit)
       OUTPUT INSERTED.TeacherId
       VALUES (@principalId, @email, @fullName, @passwordHash, 1, 40)`,
      [
        { name: "principalId", type: TYPES.Int, value: principalId },
        { name: "email", type: TYPES.NVarChar, value: autoTeacherEmail },
        { name: "fullName", type: TYPES.NVarChar, value: `${body.studentCode.trim()} Teacher` },
        { name: "passwordHash", type: TYPES.NVarChar, value: autoTeacherPasswordHash },
      ]
    );
    const systemTeacherId = autoTeacher.rows[0]?.TeacherId || (await getOrCreateSystemTeacherId());
    const inserted = await execQuery(
      `INSERT INTO dbo.Student (PrincipalId, TeacherId, Email, FullName, PasswordHash, IsActive, QuizLimit)
       OUTPUT INSERTED.StudentId, INSERTED.Email, INSERTED.FullName, INSERTED.QuizLimit, INSERTED.TeacherId, INSERTED.PrincipalId
       VALUES (@principalId, @managerId, @email, @fullName, @passwordHash, 1, 40)`,
      [
        { name: "principalId", type: TYPES.Int, value: principalId },
        { name: "managerId", type: TYPES.Int, value: systemTeacherId },
        { name: "email", type: TYPES.NVarChar, value: body.userName.trim() },
        { name: "fullName", type: TYPES.NVarChar, value: body.studentCode.trim() },
        { name: "passwordHash", type: TYPES.NVarChar, value: passwordHash },
      ]
    );
    const row = inserted.rows[0];
    if (!row) return res.status(500).json({ message: "Signup failed" });

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
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    const msg = String(e.message || "");
    if (msg.includes("UX_Student_Email") || msg.includes("UX_Teacher_Email") || msg.includes("duplicate")) {
      return res.status(409).json({ message: "Account identifier already registered." });
    }
    return res.status(500).json({ message: "Signup failed", detail: e.message });
  }
});

/** POST /api/auth/login - returns { token, user: { userId, email, displayName, role } } */
router.post("/login", async (req, res) => {
  try {
    const { identifier, email, password, userType } = LoginBody.parse(req.body);
    const loginId = (identifier || email || "").trim();
    if (!loginId) return res.status(400).json({ message: "User name is required." });
    const role = (userType === "Manager" || userType === "Principal") ? "Teacher" : (userType || "Student");

    if (role === "Teacher") {
      const r = await execQuery(
        "SELECT TeacherId, Email, FullName, PasswordHash, QuizLimit FROM dbo.Teacher WHERE Email = @email AND IsActive = 1",
        [{ name: "email", type: TYPES.NVarChar, value: loginId }]
      );
      if (!r.rows.length) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const user = r.rows[0];
      const ok = await comparePassword(password, user.PasswordHash);
      if (!ok) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const principalId = await ensureTeacherPrincipal(user.TeacherId, user.Email, user.FullName);
      const quizCount = await getManagerQuizCount(user.TeacherId);
      const quizLimit = await getManagerQuizLimit(user.TeacherId);
      if (quizCount >= quizLimit) {
        return res.status(402).json({
          message: `Free quiz limit reached (${quizLimit}). Upgrade required.`,
          paymentRequired: true,
          redirectTo: "/pricing",
          email: user.Email,
          role: "Teacher",
          quizCount,
          quizLimit,
        });
      }
      const token = signToken({
        userId: user.TeacherId,
        email: user.Email,
        role: "Teacher",
        displayName: user.FullName,
        principalId: principalId || null,
        quizLimit,
      });
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
        },
      });
    }

    const r = await execQuery(
      "SELECT StudentId, Email, FullName, PasswordHash, TeacherId, PrincipalId FROM dbo.Student WHERE Email = @email AND IsActive = 1",
      [{ name: "email", type: TYPES.NVarChar, value: loginId }]
    );
    if (!r.rows.length) {
      return res.status(401).json({ message: "Invalid user name or password" });
    }
    const user = r.rows[0];
    const ok = await comparePassword(password, user.PasswordHash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid user name or password" });
    }
    const principalId = await ensureStudentPrincipal(user.StudentId, user.TeacherId, user.Email, user.FullName);
    const quizCount = await getStudentQuizCount(user.StudentId);
    const quizLimit = await getStudentQuizLimit(user.StudentId);
    if (quizCount >= quizLimit) {
      return res.status(402).json({
        message: `Free quiz limit reached (${quizLimit}). Upgrade required.`,
        paymentRequired: true,
        redirectTo: "/pricing",
        email: user.Email,
        role: "Student",
        quizCount,
        quizLimit,
      });
    }
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
    });
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
      },
    });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
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

    return res.json({ role: null });
  } catch {
    return res.json({ role: null });
  }
});

/** GET /api/auth/me - return current user (requires auth) */
router.get("/me", requireAuth, (req, res) => {
  const roleOut = req.user.displayRole || (req.user.role === "Manager" ? "Teacher" : req.user.role);
  res.json({
    userId: req.user.userId,
    email: req.user.email,
    userName: req.user.userName || req.user.email,
    studentCode: req.user.studentCode || req.user.displayName,
    displayName: req.user.displayName,
    role: roleOut,
    managerId: req.user.managerId || null,
    principalId: req.user.principalId || null,
  });
});

module.exports = router;

