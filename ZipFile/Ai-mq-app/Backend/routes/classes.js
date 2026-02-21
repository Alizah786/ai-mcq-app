const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { TYPES } = require("tedious");

const router = express.Router();

router.use(requireAuth);

function randomJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** GET /api/classes - list my classes with all quizzes (student-based app: everyone sees Draft + Published) */
router.get("/classes", async (req, res) => {
  const userId = req.user.userId;
  const classes = await execQuery(
    `SELECT c.ClassId, c.ClassName, c.Subject, c.GradeLevel, c.JoinCode, c.OwnerUserId, cm.RoleInClass
     FROM dbo.ClassMembers cm
     JOIN dbo.Classes c ON c.ClassId = cm.ClassId
     WHERE cm.UserId = @userId
     ORDER BY c.ClassName`,
    [{ name: "userId", type: TYPES.Int, value: userId }]
  );
  const result = [];
  for (const row of classes.rows) {
    const quizRows = await execQuery(
      "SELECT QuizId, Title, Status FROM dbo.Quizzes WHERE ClassId = @classId ORDER BY Title",
      [{ name: "classId", type: TYPES.Int, value: row.ClassId }]
    );
    result.push({
      classId: row.ClassId,
      className: row.ClassName,
      subject: row.Subject,
      gradeLevel: row.GradeLevel,
      joinCode: row.OwnerUserId === userId ? row.JoinCode : undefined,
      isOwner: row.OwnerUserId === userId,
      quizzes: quizRows.rows.map((q) => ({ quizId: q.QuizId, title: q.Title, status: q.Status })),
    });
  }
  res.json({ classes: result });
});

const CreateClassBody = z.object({
  className: z.string().min(1).max(120),
  subject: z.string().max(120).optional(),
  gradeLevel: z.string().max(30).optional(),
});

/** POST /api/classes - Any user can create class (student-based app). */
router.post("/classes", async (req, res) => {
  const body = CreateClassBody.parse(req.body);
  let joinCode = randomJoinCode();
  for (let attempt = 0; attempt < 20; attempt++) {
    const existing = await execQuery(
      "SELECT 1 FROM dbo.Classes WHERE JoinCode = @code",
      [{ name: "code", type: TYPES.NVarChar, value: joinCode }]
    );
    if (!existing.rows.length) break;
    joinCode = randomJoinCode();
  }
  const inserted = await execQuery(
    `INSERT INTO dbo.Classes (OwnerUserId, ClassName, Subject, GradeLevel, JoinCode)
     OUTPUT INSERTED.ClassId, INSERTED.ClassName, INSERTED.Subject, INSERTED.GradeLevel, INSERTED.JoinCode
     VALUES (@ownerId, @className, @subject, @gradeLevel, @joinCode)`,
    [
      { name: "ownerId", type: TYPES.Int, value: req.user.userId },
      { name: "className", type: TYPES.NVarChar, value: body.className },
      { name: "subject", type: TYPES.NVarChar, value: body.subject || null },
      { name: "gradeLevel", type: TYPES.NVarChar, value: body.gradeLevel || null },
      { name: "joinCode", type: TYPES.NVarChar, value: joinCode },
    ]
  );
  const row = inserted.rows[0];
  if (!row) return res.status(500).json({ message: "Failed to create class" });
  await execQuery(
    "INSERT INTO dbo.ClassMembers (ClassId, UserId, RoleInClass) VALUES (@classId, @userId, 'Teacher')",
    [
      { name: "classId", type: TYPES.Int, value: row.ClassId },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  res.status(201).json({
    classId: row.ClassId,
    className: row.ClassName,
    subject: row.Subject,
    gradeLevel: row.GradeLevel,
    joinCode: row.JoinCode,
  });
});

const JoinClassBody = z.object({
  joinCode: z.string().min(1).max(12),
});

/** POST /api/classes/join - Any user can join class by code. */
router.post("/classes/join", async (req, res) => {
  const { joinCode } = JoinClassBody.parse(req.body);
  const code = String(joinCode).trim().toUpperCase();
  const cls = await execQuery(
    "SELECT ClassId, ClassName FROM dbo.Classes WHERE UPPER(RTRIM(JoinCode)) = @code",
    [{ name: "code", type: TYPES.NVarChar, value: code }]
  );
  if (!cls.rows.length) {
    return res.status(404).json({ message: "Invalid join code" });
  }
  const { ClassId, ClassName } = cls.rows[0];
  const existing = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: ClassId },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (existing.rows.length) {
    return res.status(400).json({ message: "Already a member of this class" });
  }
  await execQuery(
    "INSERT INTO dbo.ClassMembers (ClassId, UserId, RoleInClass) VALUES (@classId, @userId, 'Student')",
    [
      { name: "classId", type: TYPES.Int, value: ClassId },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  res.status(201).json({ classId: ClassId, className: ClassName });
});

module.exports = router;
