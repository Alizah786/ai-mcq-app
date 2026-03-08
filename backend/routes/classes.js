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

async function listClassesWithQuizzes(role, userId, requestedStudentId) {
  try {
    return await execQuery(
      "EXEC dbo.usp_Classes_ListWithQuizzes @Role, @UserId, @RequestedStudentId",
      [
        { name: "Role", type: TYPES.NVarChar, value: String(role || "") },
        { name: "UserId", type: TYPES.Int, value: Number(userId || 0) },
        { name: "RequestedStudentId", type: TYPES.Int, value: requestedStudentId == null ? null : Number(requestedStudentId) },
      ]
    );
  } catch {
    return null;
  }
}

async function getAssignedStudentTeacherId(studentId) {
  const result = await execQuery(
    `SELECT TOP 1 TeacherId
     FROM dbo.Student
     WHERE StudentId = @studentId
       AND IsActive = 1`,
    [{ name: "studentId", type: TYPES.Int, value: studentId }]
  );
  return Number(result.rows[0]?.TeacherId || 0) || null;
}

let classExportVisibilityColumnsPromise = null;

async function hasClassExportVisibilityColumns() {
  if (!classExportVisibilityColumnsPromise) {
    classExportVisibilityColumnsPromise = execQuery(
      `SELECT
         COL_LENGTH('dbo.Class', 'ShowClassNameOnExport') AS ShowClassNameOnExportLength,
         COL_LENGTH('dbo.Class', 'ShowSubjectOnExport') AS ShowSubjectOnExportLength,
         COL_LENGTH('dbo.Class', 'ShowGradeLevelOnExport') AS ShowGradeLevelOnExportLength,
         COL_LENGTH('dbo.Class', 'ShowCourseCodeOnExport') AS ShowCourseCodeOnExportLength,
         COL_LENGTH('dbo.Class', 'ShowTermOnExport') AS ShowTermOnExportLength`
    )
      .then((result) => {
        const row = result.rows[0] || {};
        return Number(row.ShowClassNameOnExportLength || 0) > 0
          && Number(row.ShowSubjectOnExportLength || 0) > 0
          && Number(row.ShowGradeLevelOnExportLength || 0) > 0
          && Number(row.ShowCourseCodeOnExportLength || 0) > 0
          && Number(row.ShowTermOnExportLength || 0) > 0;
      })
      .catch(() => false);
  }
  return classExportVisibilityColumnsPromise;
}

function withClassExportVisibility(row = {}) {
  return {
    showClassNameOnExport: row.ShowClassNameOnExport == null ? true : !!row.ShowClassNameOnExport,
    showSubjectOnExport: row.ShowSubjectOnExport == null ? false : !!row.ShowSubjectOnExport,
    showGradeLevelOnExport: row.ShowGradeLevelOnExport == null ? false : !!row.ShowGradeLevelOnExport,
    showCourseCodeOnExport: row.ShowCourseCodeOnExport == null ? true : !!row.ShowCourseCodeOnExport,
    showTermOnExport: row.ShowTermOnExport == null ? true : !!row.ShowTermOnExport,
  };
}

let quizPublishScheduleColumnsPromise = null;

async function hasQuizPublishScheduleColumns() {
  if (!quizPublishScheduleColumnsPromise) {
    quizPublishScheduleColumnsPromise = execQuery(
      `SELECT
         COL_LENGTH('dbo.Quiz', 'PublishStartUtc') AS PublishStartUtcLength,
         COL_LENGTH('dbo.Quiz', 'PublishEndUtc') AS PublishEndUtcLength`
    )
      .then((result) => {
        const row = result.rows[0] || {};
        return Number(row.PublishStartUtcLength || 0) > 0 && Number(row.PublishEndUtcLength || 0) > 0;
      })
      .catch(() => false);
  }
  return quizPublishScheduleColumnsPromise;
}

router.get("/assigned-quizzes", async (req, res) => {
  if (req.user.role !== "Student") {
    return res.status(403).json({ message: "Assigned quizzes are only available for students." });
  }

  const teacherId = await getAssignedStudentTeacherId(req.user.userId);
  if (!teacherId) {
    return res.json({ assignedStudent: false, quizzes: [] });
  }

  const hasScheduleColumns = await hasQuizPublishScheduleColumns();
  const result = await execQuery(
    `SELECT
       q.QuizId,
       q.Title,
       q.Topic,
       q.Status,
       ISNULL(q.AttemptLimit, 1) AS AttemptLimit,
       ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes,
       ISNULL(q.RequiresTeacherReview, 0) AS RequiresTeacherReview,
       ISNULL(q.TeacherReviewed, 0) AS TeacherReviewed,
       ISNULL(q.IsTeacherEdited, 0) AS IsTeacherEdited,
       ${hasScheduleColumns ? "q.PublishStartUtc," : "CAST(NULL AS DATETIME2) AS PublishStartUtc,"}
       ${hasScheduleColumns ? "q.PublishEndUtc," : "CAST(NULL AS DATETIME2) AS PublishEndUtc,"}
       sourceClass.ClassId AS SourceClassId,
       sourceClass.ClassName AS SourceClassName,
       sourceClass.Subject AS SourceSubject,
       sourceClass.GradeLevel AS SourceGradeLevel,
       (SELECT COUNT(1) FROM dbo.QuizQuestion qq WHERE qq.QuizId = q.QuizId) AS QuestionCount,
       attempts.SubmittedAttempts,
       attempts.OpenAttemptId,
       attempts.LastSubmittedAtUtc
     FROM dbo.QuizAssignment qa
     JOIN dbo.Quiz q
       ON q.QuizId = qa.QuizId
     JOIN dbo.Class sourceClass
       ON sourceClass.ClassId = q.ClassId
     OUTER APPLY (
       SELECT
         SUM(CASE WHEN a.SubmittedAtUtc IS NOT NULL THEN 1 ELSE 0 END) AS SubmittedAttempts,
         MAX(CASE WHEN a.SubmittedAtUtc IS NULL THEN a.AttemptId ELSE NULL END) AS OpenAttemptId,
         MAX(a.SubmittedAtUtc) AS LastSubmittedAtUtc
       FROM dbo.QuizAttempt a
       WHERE a.QuizId = q.QuizId
         AND a.StudentId = @studentId
     ) attempts
     WHERE qa.StudentId = @studentId
      AND qa.TeacherId = @teacherId
      AND q.Status = 'Ready'
      AND (ISNULL(q.RequiresTeacherReview, 0) = 0 OR ISNULL(q.TeacherReviewed, 0) = 1)
     ORDER BY sourceClass.ClassName, q.Title, q.QuizId`,
    [
      { name: "studentId", type: TYPES.Int, value: req.user.userId },
      { name: "teacherId", type: TYPES.Int, value: teacherId },
    ]
  );

  return res.json({
    assignedStudent: true,
    quizzes: result.rows.map((row) => {
      const nowMs = Date.now();
      const publishStartMs = row.PublishStartUtc ? new Date(row.PublishStartUtc).getTime() : null;
      const publishEndMs = row.PublishEndUtc ? new Date(row.PublishEndUtc).getTime() : null;
      const isNotStartedYet = publishStartMs != null && Number.isFinite(publishStartMs) && publishStartMs > nowMs;
      const isExpired = publishEndMs != null && Number.isFinite(publishEndMs) && publishEndMs <= nowMs;
      const isActiveNow = !isNotStartedYet && !isExpired;
      const attemptLimit = Number(row.AttemptLimit || 1);
      const submittedAttempts = Number(row.SubmittedAttempts || 0);
      const attemptsRemaining = Math.max(attemptLimit - submittedAttempts, 0);
      const hasOpenAttempt = Number(row.OpenAttemptId || 0) > 0;
      let progressState = "not_started";
      if (submittedAttempts > 0 && attemptsRemaining <= 0) progressState = "completed";
      else if (hasOpenAttempt) progressState = "in_progress";
      else if (submittedAttempts > 0) progressState = "attempted";

      return {
        quizId: Number(row.QuizId),
        title: row.Title || "",
        topic: row.Topic || "",
        status: row.Status || "",
        attemptLimit,
        attemptsUsed: submittedAttempts,
        attemptsRemaining,
        timeLimitMinutes: Number(row.TimeLimitMinutes || 0),
        questionCount: Number(row.QuestionCount || 0),
        sourceClassId: Number(row.SourceClassId || 0) || null,
        sourceClassName: row.SourceClassName || "",
        sourceSubject: row.SourceSubject || "",
        sourceGradeLevel: row.SourceGradeLevel || "",
        lastSubmittedAtUtc: row.LastSubmittedAtUtc || null,
        isAssigned: true,
        requiresTeacherReview: !!row.RequiresTeacherReview,
        teacherReviewed: !!row.TeacherReviewed,
        isTeacherEdited: !!row.IsTeacherEdited,
        publishStartUtc: row.PublishStartUtc || null,
        publishEndUtc: row.PublishEndUtc || null,
        isActiveNow,
        availabilityState: isNotStartedYet ? "scheduled" : isExpired ? "expired" : "active",
        progressState,
      };
    }),
  });
});

/** GET /api/classes - list classes with quizzes */
router.get("/classes", async (req, res) => {
  const requestedStudentId = Number(req.query.studentId);
  const hasRequestedStudent = Number.isFinite(requestedStudentId) && requestedStudentId > 0;

  const fromStoredProc = await listClassesWithQuizzes(
    req.user.role,
    req.user.userId,
    hasRequestedStudent ? requestedStudentId : null
  );
  const procRows = Array.isArray(fromStoredProc?.rows) ? fromStoredProc.rows : [];
  const storedProcHasAcademicFields =
    !procRows.length ||
    (
      Object.prototype.hasOwnProperty.call(procRows[0], "CourseCode") &&
      Object.prototype.hasOwnProperty.call(procRows[0], "Term")
    );

  if (fromStoredProc && storedProcHasAcademicFields) {
    const classesMap = new Map();
    for (const row of procRows) {
      const classId = Number(row.ClassId);
      if (!classesMap.has(classId)) {
        classesMap.set(classId, {
          classId,
          className: row.ClassName,
          subject: row.Subject,
          gradeLevel: row.GradeLevel,
          courseCode: row.CourseCode,
          term: row.Term,
          joinCode: row.JoinCode,
          createDate: row.CreateDate || null,
          lastModifiedDate: row.LastModifiedDate || null,
          studentId: row.StudentId,
          studentCode: row.StudentCode || null,
          studentName: row.StudentCode || null,
          isOwner: true,
          ...withClassExportVisibility(row),
          quizzes: [],
        });
      }
      if (row.QuizId != null) {
        classesMap.get(classId).quizzes.push({
          quizId: Number(row.QuizId),
          title: row.Title,
          status: row.Status,
          attemptLimit: Number(row.AttemptLimit || 1),
          timeLimitMinutes: Number(row.TimeLimitMinutes || 0),
          questionCount: Number(row.QuestionCount || 0),
          createDate: row.QuizCreateDate || null,
          lastModifiedDate: row.QuizLastModifiedDate || null,
          isAssigned: !!row.IsAssigned,
          requiresTeacherReview: !!row.RequiresTeacherReview,
          teacherReviewed: !!row.TeacherReviewed,
          isTeacherEdited: !!row.IsTeacherEdited,
          requiresManagerReview: !!row.RequiresTeacherReview,
          managerReviewed: !!row.TeacherReviewed,
          isManagerEdited: !!row.IsTeacherEdited,
        });
      }
    }
    return res.json({ classes: Array.from(classesMap.values()) });
  }

  let classes;
  const hasExportVisibilityColumns = await hasClassExportVisibilityColumns();
  if (req.user.role === "Manager") {
    if (hasRequestedStudent) {
      const owns = await managerOwnsStudent(req.user.userId, requestedStudentId);
      if (!owns) return res.status(403).json({ message: "Forbidden student scope" });
    }

    classes = await execQuery(
      `SELECT c.ClassId, c.ClassName, c.Subject, c.GradeLevel, c.CourseCode, c.Term, c.JoinCode, c.StudentId, c.TeacherId, s.FullName AS StudentCode, c.CreateDate, c.LastModifiedDate
              ${hasExportVisibilityColumns ? ", ISNULL(c.ShowClassNameOnExport, 1) AS ShowClassNameOnExport, ISNULL(c.ShowSubjectOnExport, 0) AS ShowSubjectOnExport, ISNULL(c.ShowGradeLevelOnExport, 0) AS ShowGradeLevelOnExport, ISNULL(c.ShowCourseCodeOnExport, 1) AS ShowCourseCodeOnExport, ISNULL(c.ShowTermOnExport, 1) AS ShowTermOnExport" : ""}
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
      `SELECT c.ClassId, c.ClassName, c.Subject, c.GradeLevel, c.CourseCode, c.Term, c.JoinCode, c.StudentId, c.TeacherId, c.CreateDate, c.LastModifiedDate
              ${hasExportVisibilityColumns ? ", ISNULL(c.ShowClassNameOnExport, 1) AS ShowClassNameOnExport, ISNULL(c.ShowSubjectOnExport, 0) AS ShowSubjectOnExport, ISNULL(c.ShowGradeLevelOnExport, 0) AS ShowGradeLevelOnExport, ISNULL(c.ShowCourseCodeOnExport, 1) AS ShowCourseCodeOnExport, ISNULL(c.ShowTermOnExport, 1) AS ShowTermOnExport" : ""}
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
              ISNULL(q.AttemptLimit, 1) AS AttemptLimit,
              ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes,
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
              ISNULL(q.AttemptLimit, 1) AS AttemptLimit,
              ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes,
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
      courseCode: row.CourseCode,
      term: row.Term,
      joinCode: row.JoinCode,
      createDate: row.CreateDate || null,
      lastModifiedDate: row.LastModifiedDate || null,
      studentId: row.StudentId,
      studentCode: row.StudentCode || null,
      studentName: row.StudentCode || null,
      isOwner: true,
      ...withClassExportVisibility(row),
      quizzes: quizRows.rows.map((q) => ({
        quizId: q.QuizId,
        title: q.Title,
        status: q.Status,
        attemptLimit: Number(q.AttemptLimit || 1),
        timeLimitMinutes: Number(q.TimeLimitMinutes || 0),
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
  courseCode: z.string().max(50).optional(),
  term: z.string().max(50).optional(),
  showClassNameOnExport: z.boolean().optional(),
  showSubjectOnExport: z.boolean().optional(),
  showGradeLevelOnExport: z.boolean().optional(),
  showCourseCodeOnExport: z.boolean().optional(),
  showTermOnExport: z.boolean().optional(),
  studentId: z.number().int().positive().optional(),
});

const UpdateClassBody = z.object({
  className: z.string().min(1).max(120),
  subject: z.string().max(120).optional().nullable(),
  gradeLevel: z.string().max(30).optional().nullable(),
  courseCode: z.string().max(50).optional().nullable(),
  term: z.string().max(50).optional().nullable(),
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
        `SELECT s.StudentId, t.Email AS TeacherEmail, t.IsActive AS TeacherIsActive
         FROM dbo.Student s
         LEFT JOIN dbo.Teacher t ON t.TeacherId = s.TeacherId
         WHERE s.StudentId = @studentId AND s.IsActive = 1`,
        [{ name: "studentId", type: TYPES.Int, value: targetStudentId }]
      );
      if (!student.rows.length) {
        return res.status(401).json({ message: "Account not found in student schema. Please log in again." });
      }
      const teacherEmail = String(student.rows[0].TeacherEmail || "").toLowerCase();
      const teacherIsActive = !!student.rows[0].TeacherIsActive;
      const isManagedByActiveNonSystemTeacher =
        teacherIsActive && !!teacherEmail && !teacherEmail.endsWith("@local");
      if (isManagedByActiveNonSystemTeacher) {
        return res.status(403).json({ message: "Class creation is disabled for teacher-managed students." });
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
      (await hasClassExportVisibilityColumns())
        ? `INSERT INTO dbo.Class (TeacherId, StudentId, ClassName, Subject, GradeLevel, CourseCode, Term, JoinCode, ShowClassNameOnExport, ShowSubjectOnExport, ShowGradeLevelOnExport, ShowCourseCodeOnExport, ShowTermOnExport)
           OUTPUT INSERTED.ClassId, INSERTED.ClassName, INSERTED.Subject, INSERTED.GradeLevel, INSERTED.CourseCode, INSERTED.Term, INSERTED.JoinCode, INSERTED.StudentId,
                  INSERTED.ShowClassNameOnExport, INSERTED.ShowSubjectOnExport, INSERTED.ShowGradeLevelOnExport, INSERTED.ShowCourseCodeOnExport, INSERTED.ShowTermOnExport
           VALUES (@managerId, @studentId, @className, @subject, @gradeLevel, @courseCode, @term, @joinCode, @showClassNameOnExport, @showSubjectOnExport, @showGradeLevelOnExport, @showCourseCodeOnExport, @showTermOnExport)`
        : `INSERT INTO dbo.Class (TeacherId, StudentId, ClassName, Subject, GradeLevel, CourseCode, Term, JoinCode)
           OUTPUT INSERTED.ClassId, INSERTED.ClassName, INSERTED.Subject, INSERTED.GradeLevel, INSERTED.CourseCode, INSERTED.Term, INSERTED.JoinCode, INSERTED.StudentId
           VALUES (@managerId, @studentId, @className, @subject, @gradeLevel, @courseCode, @term, @joinCode)`,
      [
        { name: "managerId", type: TYPES.Int, value: managerId },
        { name: "studentId", type: TYPES.Int, value: targetStudentId },
        { name: "className", type: TYPES.NVarChar, value: body.className },
        { name: "subject", type: TYPES.NVarChar, value: body.subject || null },
        { name: "gradeLevel", type: TYPES.NVarChar, value: body.gradeLevel || null },
        { name: "courseCode", type: TYPES.NVarChar, value: body.courseCode || null },
        { name: "term", type: TYPES.NVarChar, value: body.term || null },
        { name: "joinCode", type: TYPES.NVarChar, value: joinCode },
        { name: "showClassNameOnExport", type: TYPES.Bit, value: body.showClassNameOnExport === false ? 0 : 1 },
        { name: "showSubjectOnExport", type: TYPES.Bit, value: body.showSubjectOnExport ? 1 : 0 },
        { name: "showGradeLevelOnExport", type: TYPES.Bit, value: body.showGradeLevelOnExport ? 1 : 0 },
        { name: "showCourseCodeOnExport", type: TYPES.Bit, value: body.showCourseCodeOnExport === false ? 0 : 1 },
        { name: "showTermOnExport", type: TYPES.Bit, value: body.showTermOnExport === false ? 0 : 1 },
      ]
    );
    const row = inserted.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to create class" });
    res.status(201).json({
      classId: row.ClassId,
      className: row.ClassName,
      subject: row.Subject,
      gradeLevel: row.GradeLevel,
      courseCode: row.CourseCode,
      term: row.Term,
      joinCode: row.JoinCode,
      studentId: row.StudentId,
      ...withClassExportVisibility(row),
    });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Create class failed", detail: e.message });
  }
});

/** PUT /api/classes/:classId - update editable class information (excludes id fields). */
router.put("/classes/:classId", async (req, res) => {
  const classIdNum = parseInt(req.params.classId, 10);
  if (!Number.isFinite(classIdNum)) return res.status(400).json({ message: "Invalid class id" });

  try {
    const body = UpdateClassBody.parse(req.body || {});

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

    const updated = await execQuery(
      `UPDATE dbo.Class
       SET ClassName = @className,
           Subject = @subject,
           GradeLevel = @gradeLevel,
           CourseCode = @courseCode,
           Term = @term,
           LastModifiedDate = SYSUTCDATETIME()
       OUTPUT INSERTED.ClassId, INSERTED.ClassName, INSERTED.Subject, INSERTED.GradeLevel, INSERTED.CourseCode, INSERTED.Term, INSERTED.JoinCode, INSERTED.StudentId
       WHERE ClassId = @classId`,
      [
        { name: "className", type: TYPES.NVarChar, value: String(body.className || "").trim() },
        { name: "subject", type: TYPES.NVarChar, value: body.subject ? String(body.subject).trim() : null },
        { name: "gradeLevel", type: TYPES.NVarChar, value: body.gradeLevel ? String(body.gradeLevel).trim() : null },
        { name: "courseCode", type: TYPES.NVarChar, value: body.courseCode ? String(body.courseCode).trim() : null },
        { name: "term", type: TYPES.NVarChar, value: body.term ? String(body.term).trim() : null },
        { name: "classId", type: TYPES.Int, value: classIdNum },
      ]
    );
    const row = updated.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to update class" });
    return res.json({
      classId: row.ClassId,
      className: row.ClassName,
      subject: row.Subject || "",
      gradeLevel: row.GradeLevel || "",
      courseCode: row.CourseCode || "",
      term: row.Term || "",
      joinCode: row.JoinCode || "",
      studentId: row.StudentId || null,
    });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Update class failed", detail: e.message });
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

