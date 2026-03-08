const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth, requireRole, hashPassword } = require("../auth");
const { logException } = require("../services/exceptionLogger");

const router = express.Router();
router.use("/teacher", requireAuth, requireRole("Teacher", "Manager"));
router.use("/manager", requireAuth, requireRole("Teacher", "Manager"));

async function getOrCreatePrincipalIdByEmail(email, fullName) {
  try {
    const exists = await execQuery(
      `SELECT OBJECT_ID('dbo.Principal', 'U') AS ObjId`,
      []
    );
    if (!exists.rows[0]?.ObjId) return null;
  } catch {
    return null;
  }

  const trimmedEmail = String(email || "").trim().toLowerCase();
  const atPos = trimmedEmail.indexOf("@");
  const local = atPos > -1 ? trimmedEmail.slice(0, atPos) : trimmedEmail || "teacher";
  const domain = atPos > -1 ? trimmedEmail.slice(atPos + 1) : "local";

  const candidates = [
    `principal+${local}@${domain}`,
    `principal+${local}+1@${domain}`,
    `principal+${local}+2@${domain}`,
    `principal_${Date.now()}_${Math.floor(Math.random() * 100000)}@local`,
  ].map((v) => String(v).slice(0, 255));

  for (const candidate of candidates) {
    const existing = await execQuery(
      `SELECT TOP 1 PrincipalId
       FROM dbo.Principal
       WHERE Email = @email`,
      [{ name: "email", type: TYPES.NVarChar, value: candidate }]
    );
    if (existing.rows.length) return Number(existing.rows[0].PrincipalId);

    try {
      await execQuery(
        `INSERT INTO dbo.Principal (Email, FullName, IsActive)
         VALUES (@email, @fullName, 1)`,
        [
          { name: "email", type: TYPES.NVarChar, value: candidate },
          { name: "fullName", type: TYPES.NVarChar, value: fullName || trimmedEmail || candidate },
        ]
      );
      const created = await execQuery(
        `SELECT TOP 1 PrincipalId
         FROM dbo.Principal
         WHERE Email = @email`,
        [{ name: "email", type: TYPES.NVarChar, value: candidate }]
      );
      if (created.rows.length) return Number(created.rows[0].PrincipalId);
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function ensureTeacherPrincipal(teacherId) {
  let teacher = null;
  try {
    teacher = await execQuery(
      `SELECT TOP 1 TeacherId, PrincipalId, Email, FullName
       FROM dbo.Teacher
       WHERE TeacherId = @teacherId`,
      [{ name: "teacherId", type: TYPES.Int, value: teacherId }]
    );
  } catch {
    return null;
  }
  const row = teacher.rows[0];
  if (!row) return null;
  if (row.PrincipalId) return Number(row.PrincipalId);

  const principalId = await getOrCreatePrincipalIdByEmail(row.Email, row.FullName);
  if (!principalId) return null;

  await execQuery(
    `UPDATE dbo.Teacher
     SET PrincipalId = @principalId
     WHERE TeacherId = @teacherId`,
    [
      { name: "principalId", type: TYPES.Int, value: principalId },
      { name: "teacherId", type: TYPES.Int, value: teacherId },
    ]
  );
  return principalId;
}

async function userNameExistsAnywhere(userName) {
  const value = String(userName || "").trim();
  if (!value) return false;
  try {
    const reg = await execQuery(
      `SELECT TOP 1 1 AS Found
       FROM dbo.UserNameRegistry
       WHERE NormalizedUserName = LOWER(LTRIM(RTRIM(@userName)))`,
      [{ name: "userName", type: TYPES.NVarChar, value }]
    );
    if (reg.rows.length) return true;
  } catch {
    // fallback to direct table checks
  }

  const student = await execQuery(
    `SELECT TOP 1 1 AS Found
     FROM dbo.Student
     WHERE Email = @email`,
    [{ name: "email", type: TYPES.NVarChar, value }]
  );
  if (student.rows.length) return true;

  const teacher = await execQuery(
    `SELECT TOP 1 1 AS Found
     FROM dbo.Teacher
     WHERE Email = @email`,
    [{ name: "email", type: TYPES.NVarChar, value }]
  );
  if (teacher.rows.length) return true;

  try {
    const principal = await execQuery(
      `SELECT TOP 1 1 AS Found
       FROM dbo.Principal
       WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@email)))`,
      [{ name: "email", type: TYPES.NVarChar, value }]
    );
    if (principal.rows.length) return true;
  } catch {
    // Principal table may not exist on some schemas.
  }

  try {
    const appAdmin = await execQuery(
      `SELECT TOP 1 1 AS Found
       FROM dbo.AppAdmin
       WHERE LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@userName)))`,
      [{ name: "userName", type: TYPES.NVarChar, value }]
    );
    if (appAdmin.rows.length) return true;
  } catch {
    // AppAdmin table may not exist on some schemas.
  }

  return false;
}

async function listStudents(req, res) {
  let r = null;
  try {
    r = await execQuery(
      `SELECT StudentId, Email, FullName, IsActive, CreateDate, LastModifiedDate
       FROM dbo.Student
       WHERE TeacherId = @managerId
       ORDER BY FullName, StudentId`,
      [{ name: "managerId", type: TYPES.Int, value: req.user.userId }]
    );
  } catch {
    r = await execQuery(
      `SELECT StudentId, Email, FullName, IsActive
       FROM dbo.Student
       WHERE TeacherId = @managerId
       ORDER BY FullName, StudentId`,
      [{ name: "managerId", type: TYPES.Int, value: req.user.userId }]
    );
  }
  return res.json({
    students: r.rows.map((s) => ({
      studentId: s.StudentId,
      userName: s.Email,
      studentCode: s.FullName,
      isActive: !!s.IsActive,
      createDate: s.CreateDate || null,
      lastModifiedDate: s.LastModifiedDate || null,
      createdAtUtc: s.CreateDate || null,
    })),
  });
}

router.get("/teacher/students", listStudents);
router.get("/manager/students", listStudents);

const CreateStudentBody = z.object({
  userName: z.string().min(1).max(120),
  studentCode: z.string().min(1).max(120),
  password: z.string().min(6).max(128),
});

async function createStudent(req, res) {
  let stage = "start";
  try {
    stage = "validate_body";
    const body = CreateStudentBody.parse(req.body);
    const trimmedUserName = body.userName.trim();
    const trimmedStudentCode = body.studentCode.trim();

    stage = "check_duplicate_username";
    const exists = await userNameExistsAnywhere(trimmedUserName);
    if (exists) {
      return res.status(409).json({ message: "Student user name already exists." });
    }

    stage = "load_student_shape";
    const shape = await execQuery(
      `SELECT
         CASE WHEN COL_LENGTH('dbo.Student','TeacherId') IS NULL THEN 0 ELSE 1 END AS HasTeacherId,
         CASE WHEN COL_LENGTH('dbo.Student','ManagerId') IS NULL THEN 0 ELSE 1 END AS HasManagerId,
         CASE WHEN COL_LENGTH('dbo.Student','PrincipalId') IS NULL THEN 0 ELSE 1 END AS HasStudentPrincipalId,
         CASE WHEN COL_LENGTH('dbo.Student','QuizLimit') IS NULL THEN 0 ELSE 1 END AS HasQuizLimit`,
      []
    );
    const hasTeacherId = Number(shape.rows[0]?.HasTeacherId || 0) === 1;
    const hasManagerId = Number(shape.rows[0]?.HasManagerId || 0) === 1;
    const hasStudentPrincipalId = Number(shape.rows[0]?.HasStudentPrincipalId || 0) === 1;
    const hasQuizLimit = Number(shape.rows[0]?.HasQuizLimit || 0) === 1;

    if (!hasTeacherId && !hasManagerId) {
      return res.status(500).json({ message: "Student schema is missing teacher linkage columns." });
    }

    stage = "hash_password";
    const hash = await hashPassword(body.password);
    stage = "resolve_principal";
    const principalId = hasStudentPrincipalId ? await ensureTeacherPrincipal(req.user.userId) : null;

    stage = "build_insert";
    let inserted = null;
    const cols = [];
    const vals = [];
    const params = [];

    if (hasStudentPrincipalId) {
      cols.push("PrincipalId");
      vals.push("@principalId");
      params.push({ name: "principalId", type: TYPES.Int, value: principalId });
    }

    if (hasTeacherId) {
      cols.push("TeacherId");
      vals.push("@teacherId");
      params.push({ name: "teacherId", type: TYPES.Int, value: req.user.userId });
    } else if (hasManagerId) {
      cols.push("ManagerId");
      vals.push("@managerId");
      params.push({ name: "managerId", type: TYPES.Int, value: req.user.userId });
    }

    cols.push("Email");
    vals.push("@email");
    params.push({ name: "email", type: TYPES.NVarChar, value: trimmedUserName });

    cols.push("FullName");
    vals.push("@fullName");
    params.push({ name: "fullName", type: TYPES.NVarChar, value: trimmedStudentCode });

    cols.push("PasswordHash");
    vals.push("@passwordHash");
    params.push({ name: "passwordHash", type: TYPES.NVarChar, value: hash });

    cols.push("IsActive");
    vals.push("1");

    if (hasQuizLimit) {
      cols.push("QuizLimit");
      vals.push("@quizLimit");
      params.push({ name: "quizLimit", type: TYPES.Int, value: 40 });
    }

    stage = "insert_student";
    inserted = await execQuery(
      `INSERT INTO dbo.Student (${cols.join(", ")})
       VALUES (${vals.join(", ")});
       SELECT CAST(SCOPE_IDENTITY() AS INT) AS StudentId;`,
      params
    );

    const studentId = Number(inserted.rows[0]?.StudentId || 0);
    if (!studentId) {
      return res.status(500).json({ message: "Failed to create student" });
    }

    stage = "load_inserted_student";
    try {
      inserted = await execQuery(
        `SELECT TOP 1 StudentId, Email, FullName, IsActive, CreateDate, LastModifiedDate
         FROM dbo.Student
         WHERE StudentId = @studentId`,
        [{ name: "studentId", type: TYPES.Int, value: studentId }]
      );
    } catch {
      inserted = await execQuery(
        `SELECT TOP 1 StudentId, Email, FullName, IsActive
         FROM dbo.Student
         WHERE StudentId = @studentId`,
        [{ name: "studentId", type: TYPES.Int, value: studentId }]
      );
    }

    stage = "build_response";
    const row = inserted.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to create student" });

    return res.status(201).json({
      studentId: row.StudentId,
      userName: row.Email,
      studentCode: row.FullName,
      isActive: !!row.IsActive,
      createDate: row.CreateDate || null,
      lastModifiedDate: row.LastModifiedDate || null,
      createdAtUtc: row.CreateDate || null,
    });
  } catch (e) {
    const diagnostic = {
      stage,
      message: e && e.message ? e.message : String(e),
      number: e && e.number ? e.number : null,
      code: e && e.code ? e.code : null,
    };
    console.error("[createStudent] failed", diagnostic);
    await logException({
      correlationId: req?.correlationId || null,
      source: "manager.createStudent",
      route: req?.originalUrl || null,
      method: req?.method || null,
      userId: req?.user?.userId || null,
      userRole: req?.user?.role || null,
      stage,
      error: e,
      meta: diagnostic,
    });
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    const msg = String(e.message || "");
    if (
      msg.includes("UX_Student_Email") ||
      msg.includes("UX_UserNameRegistry_NormalizedUserName") ||
      msg.toLowerCase().includes("usernameregistry") ||
      msg.toLowerCase().includes("normalizedusername") ||
      msg.includes("duplicate")
    ) {
      return res.status(409).json({ message: "Student user name already exists." });
    }
    if (msg.includes("PrincipalId") && msg.includes("NULL")) {
      return res.status(400).json({ message: "Teacher profile is incomplete. Contact admin to enable student creation." });
    }
    return res.status(500).json({ message: `Failed to create student (stage: ${stage})` });
  }
}

router.post("/teacher/students", createStudent);
router.post("/manager/students", createStudent);

module.exports = router;

