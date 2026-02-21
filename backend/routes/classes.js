const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { TYPES } = require("tedious");

const router = express.Router();

router.use(requireAuth);

function randomJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function managerOwnsStudent(managerId, studentId) {
  const r = await execQuery(
    "SELECT 1 FROM dbo.Student WHERE StudentId = @studentId AND TeacherId = @managerId AND IsActive = 1",
    [
      { name: "studentId", type: TYPES.Int, value: studentId },
      { name: "managerId", type: TYPES.Int, value: managerId },
    ]
  );
  return !!r.rows.length;
}

/** GET /api/classes - list classes with quizzes */
router.get("/classes", async (req, res) => {
  const requestedStudentId = Number(req.query.studentId);
  const hasRequestedStudent = Number.isFinite(requestedStudentId) && requestedStudentId > 0;

  let classes;
  if (req.user.role === "Manager") {
    if (hasRequestedStudent) {
      const owns = await managerOwnsStudent(req.user.userId, requestedStudentId);
      if (!owns) return res.status(403).json({ message: "Forbidden student scope" });
    }

    classes = await execQuery(
      `SELECT c.ClassId, c.ClassName, c.Subject, c.GradeLevel, c.JoinCode, c.StudentId, c.TeacherId, s.FullName AS StudentCode, c.CreateDate, c.LastModifiedDate
       FROM dbo.Class c
       JOIN dbo.Student s ON s.StudentId = c.StudentId
       WHERE s.TeacherId = @managerId
         AND (@studentId IS NULL OR c.StudentId = @studentId)
       ORDER BY s.FullName, c.ClassName`,
      [
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
        { name: "studentId", type: TYPES.Int, value: hasRequestedStudent ? requestedStudentId : null },
      ]
    );
  } else {
    classes = await execQuery(
      `SELECT c.ClassId, c.ClassName, c.Subject, c.GradeLevel, c.JoinCode, c.StudentId, c.TeacherId, c.CreateDate, c.LastModifiedDate
       FROM dbo.Class c
       WHERE c.StudentId = @studentId
       ORDER BY c.ClassName`,
      [{ name: "studentId", type: TYPES.Int, value: req.user.userId }]
    );
  }

  const result = [];
  for (const row of classes.rows) {
    const quizRows = await execQuery(
      `SELECT q.QuizId, q.Title, q.Status, q.CreateDate, q.LastModifiedDate,
              ISNULL(q.RequiresTeacherReview, 0) AS RequiresTeacherReview,
              ISNULL(q.TeacherReviewed, 0) AS TeacherReviewed,
              ISNULL(q.IsTeacherEdited, 0) AS IsTeacherEdited,
              CAST(0 AS BIT) AS IsAssigned,
              (SELECT COUNT(1) FROM dbo.QuizQuestion qq WHERE qq.QuizId = q.QuizId) AS QuestionCount
       FROM dbo.Quiz q
       WHERE q.ClassId = @classId
         AND (
           @isManager = 1
           OR (
             q.Status = 'Ready'
             AND (ISNULL(q.RequiresTeacherReview, 0) = 0 OR ISNULL(q.TeacherReviewed, 0) = 1)
           )
         )

       UNION ALL

       SELECT q.QuizId, q.Title, q.Status, q.CreateDate, q.LastModifiedDate,
              ISNULL(q.RequiresTeacherReview, 0) AS RequiresTeacherReview,
              ISNULL(q.TeacherReviewed, 0) AS TeacherReviewed,
              ISNULL(q.IsTeacherEdited, 0) AS IsTeacherEdited,
              CAST(1 AS BIT) AS IsAssigned,
              (SELECT COUNT(1) FROM dbo.QuizQuestion qq WHERE qq.QuizId = q.QuizId) AS QuestionCount
       FROM dbo.QuizAssignment qa
       JOIN dbo.Quiz q ON q.QuizId = qa.QuizId
       JOIN dbo.Class sourceClass ON sourceClass.ClassId = q.ClassId
       WHERE qa.StudentId = @studentId
         AND qa.TeacherId = @managerId
         AND sourceClass.ClassName = @className
         AND q.ClassId <> @classId
         AND (
           @isManager = 1
           OR (
             q.Status = 'Ready'
             AND (ISNULL(q.RequiresTeacherReview, 0) = 0 OR ISNULL(q.TeacherReviewed, 0) = 1)
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM dbo.Quiz q2
           WHERE q2.ClassId = @classId
             AND q2.Title = q.Title
         )
       ORDER BY Title`,
      [
        { name: "classId", type: TYPES.Int, value: row.ClassId },
        { name: "studentId", type: TYPES.Int, value: row.StudentId },
        { name: "managerId", type: TYPES.Int, value: row.TeacherId || null },
        { name: "className", type: TYPES.NVarChar, value: row.ClassName },
        { name: "isManager", type: TYPES.Bit, value: req.user.role === "Manager" ? 1 : 0 },
      ]
    );
    result.push({
      classId: row.ClassId,
      className: row.ClassName,
      subject: row.Subject,
      gradeLevel: row.GradeLevel,
      joinCode: row.JoinCode,
      createDate: row.CreateDate || null,
      lastModifiedDate: row.LastModifiedDate || null,
      studentId: row.StudentId,
      studentCode: row.StudentCode || null,
      studentName: row.StudentCode || null,
      isOwner: true,
      quizzes: quizRows.rows.map((q) => ({
        quizId: q.QuizId,
        title: q.Title,
        status: q.Status,
        questionCount: Number(q.QuestionCount || 0),
        createDate: q.CreateDate || null,
        lastModifiedDate: q.LastModifiedDate || null,
        isAssigned: !!q.IsAssigned,
        requiresTeacherReview: !!q.RequiresTeacherReview,
        teacherReviewed: !!q.TeacherReviewed,
        isTeacherEdited: !!q.IsTeacherEdited,
        requiresManagerReview: !!q.RequiresTeacherReview,
        managerReviewed: !!q.TeacherReviewed,
        isManagerEdited: !!q.IsTeacherEdited,
      })),
    });
  }
  res.json({ classes: result });
});

const CreateClassBody = z.object({
  className: z.string().min(1).max(120),
  subject: z.string().max(120).optional(),
  gradeLevel: z.string().max(30).optional(),
  studentId: z.number().int().positive().optional(),
});

/** POST /api/classes - create class for current student, or manager-selected student */
router.post("/classes", async (req, res) => {
  try {
    const body = CreateClassBody.parse(req.body);

    let targetStudentId = req.user.userId;
    if (req.user.role === "Manager") {
      if (!body.studentId) {
        return res.status(400).json({ message: "studentId is required for teacher." });
      }
      const owns = await managerOwnsStudent(req.user.userId, body.studentId);
      if (!owns) return res.status(403).json({ message: "Forbidden student scope" });
      targetStudentId = body.studentId;
    } else {
      const student = await execQuery(
        "SELECT 1 FROM dbo.Student WHERE StudentId = @studentId AND IsActive = 1",
        [{ name: "studentId", type: TYPES.Int, value: targetStudentId }]
      );
      if (!student.rows.length) {
        return res.status(401).json({ message: "Account not found in student schema. Please log in again." });
      }
    }

    let joinCode = randomJoinCode();
    for (let attempt = 0; attempt < 20; attempt++) {
      const existing = await execQuery(
        "SELECT 1 FROM dbo.Class WHERE JoinCode = @code",
        [{ name: "code", type: TYPES.NVarChar, value: joinCode }]
      );
      if (!existing.rows.length) break;
      joinCode = randomJoinCode();
    }

    const studentRow = await execQuery(
      "SELECT TeacherId FROM dbo.Student WHERE StudentId = @studentId",
      [{ name: "studentId", type: TYPES.Int, value: targetStudentId }]
    );
    const managerId = studentRow.rows[0]?.TeacherId ?? null;

    const inserted = await execQuery(
      `INSERT INTO dbo.Class (TeacherId, StudentId, ClassName, Subject, GradeLevel, JoinCode)
       OUTPUT INSERTED.ClassId, INSERTED.ClassName, INSERTED.Subject, INSERTED.GradeLevel, INSERTED.JoinCode, INSERTED.StudentId
       VALUES (@managerId, @studentId, @className, @subject, @gradeLevel, @joinCode)`,
      [
        { name: "managerId", type: TYPES.Int, value: managerId },
        { name: "studentId", type: TYPES.Int, value: targetStudentId },
        { name: "className", type: TYPES.NVarChar, value: body.className },
        { name: "subject", type: TYPES.NVarChar, value: body.subject || null },
        { name: "gradeLevel", type: TYPES.NVarChar, value: body.gradeLevel || null },
        { name: "joinCode", type: TYPES.NVarChar, value: joinCode },
      ]
    );
    const row = inserted.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to create class" });
    res.status(201).json({
      classId: row.ClassId,
      className: row.ClassName,
      subject: row.Subject,
      gradeLevel: row.GradeLevel,
      joinCode: row.JoinCode,
      studentId: row.StudentId,
    });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Create class failed", detail: e.message });
  }
});

const JoinClassBody = z.object({
  joinCode: z.string().min(1).max(12),
});

/** POST /api/classes/join - not supported in single-owner schema */
router.post("/classes/join", async (req, res) => {
  JoinClassBody.parse(req.body);
  res.status(400).json({ message: "Join class is not available in the current schema." });
});

/** GET /api/classes/:classId/students - list students belonging to same class name (manager scope) */
router.get("/classes/:classId/students", async (req, res) => {
  const classIdNum = parseInt(req.params.classId, 10);
  if (!Number.isFinite(classIdNum)) return res.status(400).json({ message: "Invalid class id" });

  if (req.user.role === "Manager") {
    const classScope = await execQuery(
      `SELECT c.ClassName
       FROM dbo.Class c
       JOIN dbo.Student s ON s.StudentId = c.StudentId
       WHERE c.ClassId = @classId AND s.TeacherId = @managerId`,
      [
        { name: "classId", type: TYPES.Int, value: classIdNum },
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
      ]
    );
    const row = classScope.rows[0];
    if (!row) return res.status(404).json({ message: "Class not found" });

    const students = await execQuery(
      `SELECT DISTINCT s.StudentId, s.FullName, s.Email, s.IsActive
       FROM dbo.Class c
       JOIN dbo.Student s ON s.StudentId = c.StudentId
       WHERE s.TeacherId = @managerId
         AND c.ClassName = @className
       ORDER BY s.FullName, s.StudentId`,
      [
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
        { name: "className", type: TYPES.NVarChar, value: row.ClassName },
      ]
    );

    return res.json({
      classId: classIdNum,
      className: row.ClassName,
      students: students.rows.map((s) => ({
        studentId: s.StudentId,
        studentCode: s.FullName,
        userName: s.Email,
        isActive: !!s.IsActive,
      })),
    });
  }

  const ownClass = await execQuery(
    "SELECT c.ClassId, c.ClassName, s.StudentId, s.FullName, s.Email, s.IsActive FROM dbo.Class c JOIN dbo.Student s ON s.StudentId = c.StudentId WHERE c.ClassId = @classId AND c.StudentId = @studentId",
    [
      { name: "classId", type: TYPES.Int, value: classIdNum },
      { name: "studentId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  const row = ownClass.rows[0];
  if (!row) return res.status(404).json({ message: "Class not found" });
  return res.json({
    classId: classIdNum,
    className: row.ClassName,
    students: [{
      studentId: row.StudentId,
      studentCode: row.FullName,
      userName: row.Email,
      isActive: !!row.IsActive,
    }],
  });
});

/** DELETE /api/classes/:classId - delete class only when it has no quizzes */
router.delete("/classes/:classId", async (req, res) => {
  const classIdNum = parseInt(req.params.classId, 10);
  if (!Number.isFinite(classIdNum)) return res.status(400).json({ message: "Invalid class id" });

  let classRow;
  if (req.user.role === "Manager") {
    classRow = await execQuery(
      `SELECT c.ClassId
       FROM dbo.Class c
       JOIN dbo.Student s ON s.StudentId = c.StudentId
       WHERE c.ClassId = @classId AND s.TeacherId = @managerId`,
      [
        { name: "classId", type: TYPES.Int, value: classIdNum },
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
      ]
    );
  } else {
    classRow = await execQuery(
      "SELECT ClassId FROM dbo.Class WHERE ClassId = @classId AND StudentId = @studentId",
      [
        { name: "classId", type: TYPES.Int, value: classIdNum },
        { name: "studentId", type: TYPES.Int, value: req.user.userId },
      ]
    );
  }
  if (!classRow.rows.length) return res.status(404).json({ message: "Class not found" });

  const quizCount = await execQuery(
    "SELECT COUNT(1) AS Cnt FROM dbo.Quiz WHERE ClassId = @classId",
    [{ name: "classId", type: TYPES.Int, value: classIdNum }]
  );
  const cnt = Number(quizCount.rows[0]?.Cnt || 0);
  if (cnt > 0) {
    return res.status(400).json({ message: "Cannot delete class with quizzes. Delete quizzes first." });
  }

  await execQuery(
    "DELETE FROM dbo.Class WHERE ClassId = @classId",
    [{ name: "classId", type: TYPES.Int, value: classIdNum }]
  );
  return res.json({ message: "Class deleted", classId: classIdNum });
});

module.exports = router;

