const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth, requireRole, hashPassword } = require("../auth");

const router = express.Router();
router.use(requireAuth, requireRole("Teacher", "Manager"));

async function listStudents(req, res) {
  const r = await execQuery(
    `SELECT StudentId, Email, FullName, IsActive, CreateDate, LastModifiedDate
     FROM dbo.Student
     WHERE TeacherId = @managerId
     ORDER BY FullName, StudentId`,
    [{ name: "managerId", type: TYPES.Int, value: req.user.userId }]
  );
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
  try {
    const body = CreateStudentBody.parse(req.body);
    const hash = await hashPassword(body.password);
    const teacherRow = await execQuery(
      "SELECT PrincipalId FROM dbo.Teacher WHERE TeacherId = @teacherId",
      [{ name: "teacherId", type: TYPES.Int, value: req.user.userId }]
    );
    const principalId = teacherRow.rows[0]?.PrincipalId ?? null;

    const inserted = await execQuery(
      `INSERT INTO dbo.Student (PrincipalId, TeacherId, Email, FullName, PasswordHash, IsActive)
       OUTPUT INSERTED.StudentId, INSERTED.Email, INSERTED.FullName, INSERTED.IsActive, INSERTED.CreateDate, INSERTED.LastModifiedDate
       VALUES (@principalId, @managerId, @email, @fullName, @passwordHash, 1)`,
      [
        { name: "principalId", type: TYPES.Int, value: principalId },
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
        { name: "email", type: TYPES.NVarChar, value: body.userName.trim() },
        { name: "fullName", type: TYPES.NVarChar, value: body.studentCode.trim() },
        { name: "passwordHash", type: TYPES.NVarChar, value: hash },
      ]
    );

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
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    const msg = String(e.message || "");
    if (msg.includes("UX_Student_Email") || msg.includes("duplicate")) {
      return res.status(409).json({ message: "Student user name already exists." });
    }
    return res.status(500).json({ message: "Failed to create student", detail: e.message });
  }
}

router.post("/teacher/students", createStudent);
router.post("/manager/students", createStudent);

module.exports = router;

