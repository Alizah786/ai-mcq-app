const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { TYPES } = require("tedious");
const { logException } = require("../services/exceptionLogger");
const {
  SAFE_GRADE_ERROR_MESSAGE,
  processLongGradingJobById,
  refreshAttemptGradingStatus,
  refreshAttemptScore,
} = require("../services/longGradingService");
const { logUsageEventByActor } = require("../services/usageEvents");
const { getLegacySubscriptionRole, normalizeUserRole } = require("../services/domainCodes");

const router = express.Router();

router.use((req, res, next) => {
  if (req.path === "/internal/grade/long") return next();
  return requireAuth(req, res, next);
});

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

async function resolveAttemptStudentId(req, studentIdRaw) {
  if (normalizeUserRole(req.user.roleCode || req.user.role) !== "TEACHER") return req.user.userId;
  const studentId = Number(studentIdRaw);
  if (!Number.isFinite(studentId) || studentId <= 0) return null;
  const owns = await managerOwnsStudent(req.user.userId, studentId);
  return owns ? studentId : null;
}

function roleCode(req) {
  return normalizeUserRole(req.user?.roleCode || req.user?.role);
}

function legacyRole(req) {
  return getLegacySubscriptionRole(req.user?.roleCode || req.user?.role);
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function normalizeQuestionType(value) {
  const v = String(value || "MCQ").toUpperCase();
  if (v === "SHORT_TEXT" || v === "NUMERIC" || v === "TRUE_FALSE" || v === "LONG" || v === "MCQ" || v === "MIX_MATCH_DRAG") return v;
  return "MCQ";
}

function normalizeAnswerText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function evaluateShortTextAnswer(mode, expected, actual) {
  const expectedNorm = normalizeAnswerText(expected);
  const actualNorm = normalizeAnswerText(actual);
  if (!expectedNorm || !actualNorm) return false;
  const safeMode = String(mode || "EXACT").toUpperCase();
  if (safeMode === "CONTAINS") return actualNorm.includes(expectedNorm);
  if (safeMode === "KEYWORDS") {
    const words = expectedNorm.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) return false;
    return words.every((w) => actualNorm.includes(w));
  }
  return actualNorm === expectedNorm;
}

function safeApiError(errorCode, message, status = 400) {
  return { errorCode, message, status };
}

function parseBearerToken(headerValue) {
  const value = String(headerValue || "");
  if (!value.toLowerCase().startsWith("bearer ")) return "";
  return value.slice(7).trim();
}

async function getAttemptSummaryForQuiz(quizId, studentId) {
  const rows = await execQuery(
    `SELECT AttemptId, Score, TotalPoints, SubmittedAtUtc, StartedAtUtc
     FROM dbo.QuizAttempt
     WHERE QuizId = @quizId AND StudentId = @studentId
     ORDER BY AttemptId`,
    [
      { name: "quizId", type: TYPES.Int, value: quizId },
      { name: "studentId", type: TYPES.Int, value: studentId },
    ]
  );
  return (rows.rows || []).map((r, idx) => {
    const score = Number(r.Score || 0);
    const total = Number(r.TotalPoints || 0);
    const submittedAtUtc = r.SubmittedAtUtc || null;
    const scorePercent = submittedAtUtc && total > 0 ? Math.round((score * 10000) / total) / 100 : null;
    return {
      attemptId: Number(r.AttemptId),
      attemptNo: idx + 1,
      submitted: !!submittedAtUtc,
      score,
      total,
      scorePercent,
      startedAtUtc: r.StartedAtUtc || null,
      submittedAtUtc,
    };
  });
}

async function loadQuizStartData(quizId, role, studentId, managerId) {
  return null;
}

function formatNullableNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeHeaderExtraLines(lines = []) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      text: String(line?.text || "").replace(/\s+/g, " ").trim().slice(0, 200),
      showOnHeader: line?.showOnHeader == null ? true : !!line.showOnHeader,
    }))
    .filter((line) => line.text);
}

function parseHeaderExtraLines(rawValue) {
  if (!rawValue) return [];
  try {
    return normalizeHeaderExtraLines(JSON.parse(String(rawValue)));
  } catch {
    return [];
  }
}

let quizHeaderExtraLinesColumnAvailablePromise = null;

async function hasQuizHeaderExtraLinesColumn() {
  if (!quizHeaderExtraLinesColumnAvailablePromise) {
    quizHeaderExtraLinesColumnAvailablePromise = execQuery(
      "SELECT COL_LENGTH('dbo.Quiz', 'HeaderExtraLinesJson') AS ColumnLength"
    )
      .then((result) => Number(result.rows[0]?.ColumnLength || 0) > 0)
      .catch(() => false);
  }
  return quizHeaderExtraLinesColumnAvailablePromise;
}

async function loadQuizHeaderExtraLines(quizId) {
  if (!(await hasQuizHeaderExtraLinesColumn())) return [];
  const result = await execQuery(
    "SELECT HeaderExtraLinesJson FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  return parseHeaderExtraLines(result.rows[0]?.HeaderExtraLinesJson || null);
}

let quizAssessmentTypeColumnAvailablePromise = null;

async function hasQuizAssessmentTypeColumn() {
  if (!quizAssessmentTypeColumnAvailablePromise) {
    quizAssessmentTypeColumnAvailablePromise = execQuery(
      "SELECT COL_LENGTH('dbo.Quiz', 'AssessmentType') AS ColumnLength"
    )
      .then((result) => Number(result.rows[0]?.ColumnLength || 0) > 0)
      .catch(() => false);
  }
  return quizAssessmentTypeColumnAvailablePromise;
}

function normalizeAssessmentType(value) {
  return String(value || "").toUpperCase() === "ASSIGNMENT" ? "ASSIGNMENT" : "QUIZ";
}

async function loadQuizAssessmentType(quizId) {
  if (!(await hasQuizAssessmentTypeColumn())) return "QUIZ";
  const result = await execQuery(
    "SELECT AssessmentType FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  return normalizeAssessmentType(result.rows[0]?.AssessmentType);
}

let quizRevealAnswersColumnAvailablePromise = null;

async function hasQuizRevealAnswersAfterSubmitColumn() {
  if (!quizRevealAnswersColumnAvailablePromise) {
    quizRevealAnswersColumnAvailablePromise = execQuery(
      "SELECT COL_LENGTH('dbo.Quiz', 'RevealAnswersAfterSubmit') AS ColumnLength"
    )
      .then((result) => Number(result.rows[0]?.ColumnLength || 0) > 0)
      .catch(() => false);
  }
  return quizRevealAnswersColumnAvailablePromise;
}

async function loadQuizRevealAnswersAfterSubmit(quizId) {
  if (!(await hasQuizRevealAnswersAfterSubmitColumn())) return false;
  const result = await execQuery(
    "SELECT RevealAnswersAfterSubmit FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  return !!result.rows[0]?.RevealAnswersAfterSubmit;
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

function defaultClassExportSettings() {
  return {
    className: "",
    subject: "",
    gradeLevel: "",
    courseCode: "",
    term: "",
    showClassNameOnExport: false,
    showSubjectOnExport: false,
    showGradeLevelOnExport: false,
    showCourseCodeOnExport: true,
    showTermOnExport: true,
  };
}

async function loadQuizClassExportSettings(quizId) {
  const hasVisibilityColumns = await hasClassExportVisibilityColumns();
  const result = await execQuery(
    `SELECT TOP 1
        c.ClassName,
        c.Subject,
        c.GradeLevel,
        c.CourseCode,
        c.Term
        ${hasVisibilityColumns ? `,
        ISNULL(c.ShowClassNameOnExport, 1) AS ShowClassNameOnExport,
        ISNULL(c.ShowSubjectOnExport, 0) AS ShowSubjectOnExport,
        ISNULL(c.ShowGradeLevelOnExport, 0) AS ShowGradeLevelOnExport,
        ISNULL(c.ShowCourseCodeOnExport, 1) AS ShowCourseCodeOnExport,
        ISNULL(c.ShowTermOnExport, 1) AS ShowTermOnExport` : ""}
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     WHERE q.QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  const row = result.rows[0];
  if (!row) return defaultClassExportSettings();
  return {
    className: row.ClassName || "",
    subject: row.Subject || "",
    gradeLevel: row.GradeLevel || "",
    courseCode: row.CourseCode || "",
    term: row.Term || "",
    showClassNameOnExport: row.ShowClassNameOnExport == null ? false : !!row.ShowClassNameOnExport,
    showSubjectOnExport: row.ShowSubjectOnExport == null ? false : !!row.ShowSubjectOnExport,
    showGradeLevelOnExport: row.ShowGradeLevelOnExport == null ? false : !!row.ShowGradeLevelOnExport,
    showCourseCodeOnExport: row.ShowCourseCodeOnExport == null ? true : !!row.ShowCourseCodeOnExport,
    showTermOnExport: row.ShowTermOnExport == null ? true : !!row.ShowTermOnExport,
  };
}

async function resolveInstructorNameLabel(teacherId, explicitLabel) {
  const preset = String(explicitLabel || "").trim();
  if (preset) return preset;
  const normalizedTeacherId = Number(teacherId || 0);
  if (!Number.isFinite(normalizedTeacherId) || normalizedTeacherId <= 0) return "";
  try {
    const withShortName = await execQuery(
      `SELECT TOP 1 ShortName, FullName
       FROM dbo.Teacher
       WHERE TeacherId = @teacherId`,
      [{ name: "teacherId", type: TYPES.Int, value: normalizedTeacherId }]
    );
    return String(withShortName.rows[0]?.ShortName || "").trim()
      || String(withShortName.rows[0]?.FullName || "").trim()
      || "";
  } catch {
    const fallback = await execQuery(
      `SELECT TOP 1 FullName
       FROM dbo.Teacher
       WHERE TeacherId = @teacherId`,
      [{ name: "teacherId", type: TYPES.Int, value: normalizedTeacherId }]
    );
    return String(fallback.rows[0]?.FullName || "").trim() || "";
  }
}

function buildDeterministicOrder(items, seedText) {
  const seedBase = String(seedText || "");
  return [...(items || [])]
    .map((item, index) => ({
      item,
      sortKey: (() => {
        let hash = 2166136261;
        const text = `${seedBase}:${index}:${JSON.stringify(item)}`;
        for (let i = 0; i < text.length; i++) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      })(),
    }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((entry) => entry.item);
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

async function enforceQuizPublishWindowForStudent(quizId, role) {
  if (String(role || "") !== "Student") return null;
  if (!(await hasQuizPublishScheduleColumns())) return null;
  const result = await execQuery(
    "SELECT PublishStartUtc, PublishEndUtc FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  const row = result.rows[0] || {};
  const nowMs = Date.now();
  const startMs = row.PublishStartUtc ? new Date(row.PublishStartUtc).getTime() : null;
  const endMs = row.PublishEndUtc ? new Date(row.PublishEndUtc).getTime() : null;
  if (startMs != null && Number.isFinite(startMs) && startMs > nowMs) {
    return {
      status: 403,
      message: "Quiz is not active yet.",
      errorCode: "QUIZ_NOT_ACTIVE_YET",
      activationDateUtc: row.PublishStartUtc,
    };
  }
  if (endMs != null && Number.isFinite(endMs) && endMs <= nowMs) {
    return {
      status: 403,
      message: "Quiz has expired.",
      errorCode: "QUIZ_EXPIRED",
      expiryDateUtc: row.PublishEndUtc,
    };
  }
  return null;
}

async function loadMatchPairsByQuestionIds(questionIds = []) {
  const ids = Array.from(new Set((questionIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return new Map();
  try {
    const params = ids.map((id, index) => ({
      name: `qid${index}`,
      type: TYPES.Int,
      value: id,
    }));
    const placeholders = params.map((p) => `@${p.name}`).join(", ");
    const result = await execQuery(
      `SELECT MatchPairId, QuestionId, LeftText, RightText, DisplayOrder, IsActive
       FROM dbo.MatchPair
       WHERE QuestionId IN (${placeholders})
       ORDER BY QuestionId, DisplayOrder, MatchPairId`,
      params
    );
    const map = new Map();
    for (const row of result.rows || []) {
      const questionId = Number(row.QuestionId);
      if (!map.has(questionId)) map.set(questionId, []);
      map.get(questionId).push({
        matchPairId: Number(row.MatchPairId),
        leftText: row.LeftText || "",
        rightText: row.RightText || "",
        displayOrder: Number(row.DisplayOrder || 0),
        isActive: !!row.IsActive,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/** GET /api/attempts/mine - student attempt history for submitted quizzes */
router.get("/attempts/mine", async (req, res) => {
  const studentScope = await execQuery(
    "SELECT TOP 1 StudentId FROM dbo.Student WHERE StudentId = @studentId AND IsActive = 1",
    [{ name: "studentId", type: TYPES.Int, value: req.user.userId }]
  );
  if (!studentScope.rows.length) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const studentId = Number(studentScope.rows[0].StudentId);

  const rows = await execQuery(
    `SELECT TOP 300
        qa.AttemptId,
        qa.QuizId,
        q.Title AS QuizTitle,
        c.ClassId,
        c.ClassName,
        qa.Score,
        qa.TotalPoints,
        CASE
          WHEN ISNULL(qa.TotalPoints, 0) > 0 THEN CAST((qa.Score * 100.0) / qa.TotalPoints AS DECIMAL(6,2))
          ELSE 0
        END AS ScorePercent,
        qa.StartedAtUtc,
        qa.SubmittedAtUtc
     FROM dbo.QuizAttempt qa
     JOIN dbo.Quiz q ON q.QuizId = qa.QuizId
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     WHERE qa.StudentId = @studentId
       AND qa.SubmittedAtUtc IS NOT NULL
     ORDER BY qa.SubmittedAtUtc DESC, qa.AttemptId DESC`,
    [{ name: "studentId", type: TYPES.Int, value: studentId }]
  );

  return res.json({
    attempts: (rows.rows || []).map((r) => ({
      attemptId: r.AttemptId,
      quizId: r.QuizId,
      quizTitle: r.QuizTitle,
      classId: r.ClassId,
      className: r.ClassName,
      score: Number(r.Score || 0),
      totalPoints: Number(r.TotalPoints || 0),
      scorePercent: Number(r.ScorePercent || 0),
      startedAtUtc: r.StartedAtUtc || null,
      submittedAtUtc: r.SubmittedAtUtc || null,
    })),
  });
});

/** GET /api/reports/quiz-performance - manager report with optional class/student/quiz filters */
router.get("/reports/quiz-performance", async (req, res) => {
  if (roleCode(req) !== "TEACHER") {
    return res.status(403).json({ message: "Only teacher can access reports." });
  }

  const classId = toPositiveInt(req.query.classId);
  const studentId = toPositiveInt(req.query.studentId);
  const quizId = toPositiveInt(req.query.quizId);

  if (studentId) {
    const owns = await managerOwnsStudent(req.user.userId, studentId);
    if (!owns) return res.status(403).json({ message: "Forbidden student scope" });
  }

  const attempts = await execQuery(
    `SELECT TOP 300
        qa.AttemptId,
        qa.StudentId,
        s.FullName AS StudentCode,
        s.Email AS UserName,
        q.QuizId,
        q.Title AS QuizTitle,
        c.ClassId,
        c.ClassName,
        qa.Score,
        qa.TotalPoints,
        CASE
          WHEN ISNULL(qa.TotalPoints, 0) > 0 THEN CAST((qa.Score * 100.0) / qa.TotalPoints AS DECIMAL(6,2))
          ELSE 0
        END AS ScorePercent,
        qa.StartedAtUtc,
        qa.SubmittedAtUtc
     FROM dbo.QuizAttempt qa
     JOIN dbo.Quiz q ON q.QuizId = qa.QuizId
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     JOIN dbo.Student s ON s.StudentId = qa.StudentId
     WHERE COALESCE(qa.TeacherId, s.TeacherId) = @managerId
       AND qa.SubmittedAtUtc IS NOT NULL
       AND (@classId IS NULL OR c.ClassId = @classId)
       AND (@studentId IS NULL OR qa.StudentId = @studentId)
       AND (@quizId IS NULL OR q.QuizId = @quizId)
     ORDER BY qa.SubmittedAtUtc DESC, qa.AttemptId DESC`,
    [
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
      { name: "classId", type: TYPES.Int, value: classId },
      { name: "studentId", type: TYPES.Int, value: studentId },
      { name: "quizId", type: TYPES.Int, value: quizId },
    ]
  );

  const rows = attempts.rows || [];
  const attemptsCount = rows.length;
  const uniqueStudents = new Set(rows.map((r) => Number(r.StudentId))).size;
  const percentages = rows.map((r) => Number(r.ScorePercent || 0));
  const avgScorePercent = attemptsCount
    ? Math.round((percentages.reduce((a, b) => a + b, 0) / attemptsCount) * 100) / 100
    : 0;
  const bestScorePercent = attemptsCount ? Math.max(...percentages) : 0;
  const worstScorePercent = attemptsCount ? Math.min(...percentages) : 0;

  return res.json({
    filters: { classId, studentId, quizId },
    summary: {
      attemptsCount,
      studentsCount: uniqueStudents,
      avgScorePercent,
      bestScorePercent,
      worstScorePercent,
    },
    attempts: rows.map((r) => ({
      attemptId: r.AttemptId,
      studentId: r.StudentId,
      studentCode: r.StudentCode,
      userName: r.UserName,
      classId: r.ClassId,
      className: r.ClassName,
      quizId: r.QuizId,
      quizTitle: r.QuizTitle,
      score: Number(r.Score || 0),
      totalPoints: Number(r.TotalPoints || 0),
      scorePercent: Number(r.ScorePercent || 0),
      startedAtUtc: r.StartedAtUtc || null,
      submittedAtUtc: r.SubmittedAtUtc || null,
    })),
  });
});

/** POST /api/quizzes/:quizId/attempts/start - Owner can start (quiz must be Ready). */
router.post("/quizzes/:quizId/attempts/start", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const attemptStudentId = await resolveAttemptStudentId(req, req.query.studentId);
  const arcadeMode = String(req.query.mode || "").toLowerCase() === "arcade";
  if (!attemptStudentId) {
    return res.status(400).json({ message: "Valid studentId is required for manager attempts." });
  }
  const publishWindowError = await enforceQuizPublishWindowForStudent(quizIdNum, req.user.role);
  if (publishWindowError) {
    return res.status(publishWindowError.status || 403).json(publishWindowError);
  }

  const startData = await loadQuizStartData(quizIdNum, req.user.role, attemptStudentId, req.user.userId);
  if (startData) {
    if (!startData.rows.length) {
      return res.status(404).json({ message: "Quiz not found or not ready" });
    }

    const firstRow = startData.rows[0];
    const attemptLimit = Math.max(1, Math.min(5, Number(firstRow.AttemptLimit || 1)));
    const attemptSummary = await getAttemptSummaryForQuiz(quizIdNum, attemptStudentId);
    const submittedAttempts = attemptSummary.filter((a) => a.submitted);
    const inProgressAttempt = attemptSummary.find((a) => !a.submitted) || null;
    const assessmentType = await loadQuizAssessmentType(quizIdNum).catch(() => "QUIZ");
    if (assessmentType === "ASSIGNMENT" && roleCode(req) === "STUDENT") {
      return res.status(400).json({ message: "This assignment is PDF-only. Online attempt is disabled.", errorCode: "ASSIGNMENT_PDF_ONLY" });
    }

    if (firstRow.QuestionId == null) {
      return res.status(400).json({ message: "Quiz has no questions yet. Add questions before attempting." });
    }

    let attemptId = inProgressAttempt?.attemptId || null;
    let startedAtUtc = inProgressAttempt?.startedAtUtc || null;
    if (!attemptId) {
      const createdAttempt = await execQuery(
        `INSERT INTO dbo.QuizAttempt (TeacherId, QuizId, StudentId, DisclaimerAcknowledgment, StartedAtUtc)
         OUTPUT INSERTED.AttemptId, INSERTED.DisclaimerAcknowledgment, INSERTED.StartedAtUtc
         VALUES (@managerId, @quizId, @studentId, @disclaimerAcknowledgment, SYSUTCDATETIME())`,
        [
          { name: "managerId", type: TYPES.Int, value: firstRow.TeacherId ?? null },
          { name: "quizId", type: TYPES.Int, value: quizIdNum },
          { name: "studentId", type: TYPES.Int, value: attemptStudentId },
          { name: "disclaimerAcknowledgment", type: TYPES.Bit, value: 1 },
        ]
      );
      attemptId = createdAttempt.rows[0].AttemptId;
      startedAtUtc = createdAttempt.rows[0].StartedAtUtc || null;
      logUsageEventByActor({
        role: legacyRole(req),
        userId: roleCode(req) === "TEACHER" ? req.user.userId : attemptStudentId,
        eventType: "QUIZ_ATTEMPT",
        quantity: 1,
      }).catch(() => {});
    } else if (!startedAtUtc) {
      const existingAttempt = await execQuery(
        "SELECT StartedAtUtc FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
        [{ name: "attemptId", type: TYPES.Int, value: attemptId }]
      );
      startedAtUtc = existingAttempt.rows[0]?.StartedAtUtc || null;
    }

    const latestAttemptSummary = await getAttemptSummaryForQuiz(quizIdNum, attemptStudentId);
    const latestSubmittedAttempts = latestAttemptSummary.filter((a) => a.submitted).length;
    const attemptsRemaining = Math.max(0, attemptLimit - latestSubmittedAttempts);
    const quizMetaFallback = await execQuery(
      `SELECT q.DeadlineUtc, q.TotalMarks, q.WeightPercent, q.InstructorLabel
       FROM dbo.Quiz q
       WHERE q.QuizId = @quizId`,
      [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
    ).catch(() => ({ rows: [] }));
    const metaRow = quizMetaFallback.rows[0] || {};
    const resolvedInstructorLabel = firstRow.InstructorLabel ?? metaRow.InstructorLabel ?? null;
    const resolvedDeadlineUtc = firstRow.DeadlineUtc ?? metaRow.DeadlineUtc ?? null;
    const resolvedTotalMarks = firstRow.TotalMarks ?? metaRow.TotalMarks ?? null;
    const resolvedWeightPercent = firstRow.WeightPercent ?? metaRow.WeightPercent ?? null;
    const instructorNameLabel = await resolveInstructorNameLabel(firstRow.TeacherId, resolvedInstructorLabel);
    const headerExtraLines = await loadQuizHeaderExtraLines(quizIdNum).catch(() => []);
    const classExportSettings = await loadQuizClassExportSettings(quizIdNum).catch(() => defaultClassExportSettings());

    const questionMap = new Map();
    for (const row of startData.rows) {
      if (row.QuestionId == null) continue;
      const questionId = Number(row.QuestionId);
      if (!questionMap.has(questionId)) {
        questionMap.set(questionId, {
          questionId,
          questionText: row.QuestionText,
          explanation: row.Explanation || null,
          diagramType: row.DiagramType || "none",
          diagramData: row.DiagramData || null,
          questionType: normalizeQuestionType(row.QuestionType),
          points: Number(row.Points || 1),
          isHiddenForStudent: !!row.IsHiddenForStudent,
          options: [],
        });
      }
      if (row.ChoiceId != null) {
        const q = questionMap.get(questionId);
        const optionIndex = q.options.length;
        q.options.push({
          optionId: Number(row.ChoiceId),
          label: ["A", "B", "C", "D", "E", "F"][optionIndex] || String(optionIndex + 1),
          text: row.ChoiceText,
        });
      }
    }

    if (arcadeMode && questionMap.size) {
      const questionIds = Array.from(questionMap.keys()).filter((id) => Number.isFinite(Number(id)));
      const correctChoiceRows = await execQuery(
        `SELECT QuestionId, ChoiceId, IsCorrect
         FROM dbo.QuizChoice
         WHERE QuestionId IN (${questionIds.map((_, index) => `@qid${index}`).join(", ")})`,
        questionIds.map((questionId, index) => ({ name: `qid${index}`, type: TYPES.Int, value: Number(questionId) }))
      ).catch(() => ({ rows: [] }));

      const correctByQuestionId = new Map();
      for (const row of correctChoiceRows.rows || []) {
        const questionId = Number(row.QuestionId);
        if (!correctByQuestionId.has(questionId)) correctByQuestionId.set(questionId, new Map());
        correctByQuestionId.get(questionId).set(Number(row.ChoiceId), !!row.IsCorrect);
      }

      for (const question of questionMap.values()) {
        const optionFlags = correctByQuestionId.get(Number(question.questionId)) || new Map();
        question.options = (question.options || []).map((option) => ({
          ...option,
          isCorrect: !!optionFlags.get(Number(option.optionId)),
        }));
      }
    }

    const quiz = {
      quizId: quizIdNum,
      title: firstRow.Title,
      description: firstRow.Topic,
      createDate: firstRow.CreateDate || null,
      lastModifiedDate: firstRow.LastModifiedDate || null,
      timeLimitMinutes: Number(firstRow.TimeLimitMinutes || 0),
      assessmentType,
      className: classExportSettings.className,
      subject: classExportSettings.subject,
      gradeLevel: classExportSettings.gradeLevel,
      courseCode: classExportSettings.courseCode,
      term: classExportSettings.term,
      showClassNameOnExport: classExportSettings.showClassNameOnExport,
      showSubjectOnExport: classExportSettings.showSubjectOnExport,
      showGradeLevelOnExport: classExportSettings.showGradeLevelOnExport,
      showCourseCodeOnExport: classExportSettings.showCourseCodeOnExport,
      showTermOnExport: classExportSettings.showTermOnExport,
      deadlineUtc: resolvedDeadlineUtc || null,
      totalMarks: formatNullableNumber(resolvedTotalMarks),
      weightPercent: formatNullableNumber(resolvedWeightPercent),
      instructorLabel: instructorNameLabel,
      instructorNameLabel,
      revealAnswersAfterSubmit: await loadQuizRevealAnswersAfterSubmit(quizIdNum).catch(() => false),
      headerExtraLines,
      questions: Array.from(questionMap.values()),
    };
    const mixMatchMeta = await execQuery(
      `SELECT QuestionId, ISNULL(ShuffleLeft, 0) AS ShuffleLeft, ISNULL(ShuffleRight, 1) AS ShuffleRight, ISNULL(AllowPartialMarks, 1) AS AllowPartialMarks
       FROM dbo.QuizQuestion
       WHERE QuizId = @quizId`,
      [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
    ).catch(() => ({ rows: [] }));
    const metaByQuestionId = new Map((mixMatchMeta.rows || []).map((meta) => [
      Number(meta.QuestionId),
      {
        shuffleLeft: !!meta.ShuffleLeft,
        shuffleRight: !!meta.ShuffleRight,
        allowPartialMarks: !!meta.AllowPartialMarks,
      },
    ]));
    const matchPairsByQuestionId = await loadMatchPairsByQuestionIds(quiz.questions.map((q) => q.questionId));
    for (const question of quiz.questions) {
      if (normalizeQuestionType(question.questionType) !== "MIX_MATCH_DRAG") continue;
      const pairs = (matchPairsByQuestionId.get(Number(question.questionId)) || []).filter((pair) => pair.isActive);
      const meta = metaByQuestionId.get(Number(question.questionId)) || {};
      const leftItems = pairs.map((pair) => ({ leftMatchPairId: pair.matchPairId, leftText: pair.leftText }));
      const rightItems = pairs.map((pair) => ({ rightMatchPairId: pair.matchPairId, rightText: pair.rightText }));
      question.shuffleLeft = !!meta.shuffleLeft;
      question.shuffleRight = meta.shuffleRight == null ? true : !!meta.shuffleRight;
      question.allowPartialMarks = meta.allowPartialMarks == null ? true : !!meta.allowPartialMarks;
      question.leftItems = question.shuffleLeft
        ? buildDeterministicOrder(leftItems, `${attemptId}:${question.questionId}:left`)
        : leftItems;
      question.rightItems = question.shuffleRight
        ? buildDeterministicOrder(rightItems, `${attemptId}:${question.questionId}:right`)
        : rightItems;
      question.options = [];
    }

    if (!inProgressAttempt && submittedAttempts.length >= attemptLimit) {
      const latestSubmittedAttemptId = submittedAttempts.length
        ? Number(submittedAttempts[submittedAttempts.length - 1].attemptId || 0) || null
        : null;
      return res.status(409).json({
        message: "Maximum attempts reached for this quiz.",
        errorCode: "QUIZ_ATTEMPT_LIMIT_REACHED",
        attemptLimit,
        submittedAttempts: submittedAttempts.length,
        attemptsRemaining: 0,
        attemptSummary,
        latestSubmittedAttemptId,
        quiz,
      });
    }

    return res.status(201).json({
      attemptId,
      quiz,
      attemptLimit,
      attemptsRemaining,
      attemptSummary: latestAttemptSummary,
      attemptStartedAtUtc: startedAtUtc,
    });
  }

  const quizRow = await execQuery(
    `SELECT q.QuizId, q.Title, q.Topic, q.ClassId, q.Status, q.CreateDate, q.LastModifiedDate, s.TeacherId,
            c.CourseCode, c.Term,
            q.DeadlineUtc, q.TotalMarks, q.WeightPercent, q.InstructorLabel,
            ISNULL(q.AttemptLimit, 1) AS AttemptLimit,
            ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     JOIN dbo.Student s ON s.StudentId = c.StudentId
     WHERE q.QuizId = @quizId
       AND q.Status = 'Ready'
       AND (
         @role = 'Manager'
         OR (ISNULL(q.RequiresTeacherReview, 0) = 0 OR ISNULL(q.TeacherReviewed, 0) = 1)
       )
       AND (
         ( @role = 'Student' AND (
             c.StudentId = @studentId
             OR EXISTS (
               SELECT 1
               FROM dbo.QuizAssignment qa
               WHERE qa.QuizId = q.QuizId
                 AND qa.StudentId = @studentId
             )
           )
         )
         OR
         ( @role = 'Manager' AND s.TeacherId = @managerId AND (
             c.StudentId = @studentId
             OR EXISTS (
               SELECT 1
               FROM dbo.QuizAssignment qa
               WHERE qa.QuizId = q.QuizId
                 AND qa.StudentId = @studentId
                 AND qa.TeacherId = @managerId
             )
           )
         )
       )`,
    [
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "role", type: TYPES.NVarChar, value: req.user.role },
      { name: "studentId", type: TYPES.Int, value: attemptStudentId },
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!quizRow.rows.length) {
    return res.status(404).json({ message: "Quiz not found or not ready" });
  }
  const attemptLimit = Math.max(1, Math.min(5, Number(quizRow.rows[0].AttemptLimit || 1)));
  const attemptSummary = await getAttemptSummaryForQuiz(quizIdNum, attemptStudentId);
  const submittedAttempts = attemptSummary.filter((a) => a.submitted);
  const inProgressAttempt = attemptSummary.find((a) => !a.submitted) || null;
  const instructorNameLabel = await resolveInstructorNameLabel(quizRow.rows[0].TeacherId, quizRow.rows[0].InstructorLabel);
  const headerExtraLines = await loadQuizHeaderExtraLines(quizIdNum).catch(() => []);
  const classExportSettings = await loadQuizClassExportSettings(quizIdNum).catch(() => defaultClassExportSettings());
  const assessmentType = await loadQuizAssessmentType(quizIdNum).catch(() => "QUIZ");
  if (assessmentType === "ASSIGNMENT" && roleCode(req) === "STUDENT") {
    return res.status(400).json({ message: "This assignment is PDF-only. Online attempt is disabled.", errorCode: "ASSIGNMENT_PDF_ONLY" });
  }

  const questions = await execQuery(
    `SELECT QuestionId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder,
            ISNULL(Points, 1) AS Points,
            QuestionType
     FROM dbo.QuizQuestion
     WHERE QuizId = @quizId
       AND (@role = 'Manager' OR ISNULL(IsHiddenForStudent, 0) = 0)
     ORDER BY
       CASE UPPER(ISNULL(QuestionType, 'MCQ'))
         WHEN 'MCQ' THEN 0
         WHEN 'SHORT_TEXT' THEN 1
         WHEN 'TRUE_FALSE' THEN 2
         WHEN 'NUMERIC' THEN 3
         WHEN 'LONG' THEN 4
         ELSE 5
       END,
       DisplayOrder,
       QuestionId`,
    [
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "role", type: TYPES.NVarChar, value: req.user.role },
    ]
  );
  if (!questions.rows.length) {
    return res.status(400).json({ message: "Quiz has no questions yet. Add questions before attempting." });
  }

  let attemptId = inProgressAttempt?.attemptId || null;
  let startedAtUtc = inProgressAttempt?.startedAtUtc || null;
  if (!attemptId) {
    const createdAttempt = await execQuery(
      `INSERT INTO dbo.QuizAttempt (TeacherId, QuizId, StudentId, DisclaimerAcknowledgment, StartedAtUtc)
       OUTPUT INSERTED.AttemptId, INSERTED.DisclaimerAcknowledgment, INSERTED.StartedAtUtc
       VALUES (@managerId, @quizId, @studentId, @disclaimerAcknowledgment, SYSUTCDATETIME())`,
      [
        { name: "managerId", type: TYPES.Int, value: quizRow.rows[0].TeacherId ?? null },
        { name: "quizId", type: TYPES.Int, value: quizIdNum },
        { name: "studentId", type: TYPES.Int, value: attemptStudentId },
        { name: "disclaimerAcknowledgment", type: TYPES.Bit, value: 1 },
      ]
    );
    attemptId = createdAttempt.rows[0].AttemptId;
    startedAtUtc = createdAttempt.rows[0].StartedAtUtc || null;
    logUsageEventByActor({
      role: legacyRole(req),
      userId: roleCode(req) === "TEACHER" ? req.user.userId : attemptStudentId,
      eventType: "QUIZ_ATTEMPT",
      quantity: 1,
    }).catch(() => {});
  } else if (!startedAtUtc) {
    const existingAttempt = await execQuery(
      "SELECT StartedAtUtc FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
      [{ name: "attemptId", type: TYPES.Int, value: attemptId }]
    );
    startedAtUtc = existingAttempt.rows[0]?.StartedAtUtc || null;
  }

  const latestAttemptSummary = await getAttemptSummaryForQuiz(quizIdNum, attemptStudentId);
  const latestSubmittedAttempts = latestAttemptSummary.filter((a) => a.submitted).length;
  const attemptsRemaining = Math.max(0, attemptLimit - latestSubmittedAttempts);

  const quiz = {
    quizId: quizIdNum,
    title: quizRow.rows[0].Title,
    description: quizRow.rows[0].Topic,
    createDate: quizRow.rows[0].CreateDate || null,
    lastModifiedDate: quizRow.rows[0].LastModifiedDate || null,
    timeLimitMinutes: Number(quizRow.rows[0].TimeLimitMinutes || 0),
    assessmentType,
    className: classExportSettings.className,
    subject: classExportSettings.subject,
    gradeLevel: classExportSettings.gradeLevel,
    courseCode: classExportSettings.courseCode,
    term: classExportSettings.term,
    showClassNameOnExport: classExportSettings.showClassNameOnExport,
    showSubjectOnExport: classExportSettings.showSubjectOnExport,
    showGradeLevelOnExport: classExportSettings.showGradeLevelOnExport,
    showCourseCodeOnExport: classExportSettings.showCourseCodeOnExport,
    showTermOnExport: classExportSettings.showTermOnExport,
    deadlineUtc: quizRow.rows[0].DeadlineUtc || null,
    totalMarks: formatNullableNumber(quizRow.rows[0].TotalMarks),
    weightPercent: formatNullableNumber(quizRow.rows[0].WeightPercent),
    instructorLabel: instructorNameLabel,
    instructorNameLabel,
    revealAnswersAfterSubmit: await loadQuizRevealAnswersAfterSubmit(quizIdNum).catch(() => false),
    headerExtraLines,
    questions: [],
  };
  for (const q of questions.rows) {
    const options = await execQuery(
      "SELECT ChoiceId, ChoiceText, DisplayOrder FROM dbo.QuizChoice WHERE QuestionId = @qid ORDER BY DisplayOrder, ChoiceId",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    quiz.questions.push({
      questionId: q.QuestionId,
      questionText: q.QuestionText,
      explanation: q.Explanation || null,
      diagramType: q.DiagramType || "none",
      diagramData: q.DiagramData || null,
      questionType: normalizeQuestionType(q.QuestionType),
      points: Number(q.Points || 1),
      isHiddenForStudent: !!q.IsHiddenForStudent,
      options: options.rows.map((o, i) => ({ optionId: o.ChoiceId, label: ["A", "B", "C", "D", "E", "F"][i] || String(i + 1), text: o.ChoiceText })),
    });
  }
  if (arcadeMode && quiz.questions.length) {
    const questionIds = quiz.questions
      .map((question) => Number(question.questionId))
      .filter((questionId) => Number.isFinite(questionId));
    const correctChoiceRows = await execQuery(
      `SELECT QuestionId, ChoiceId, IsCorrect
       FROM dbo.QuizChoice
       WHERE QuestionId IN (${questionIds.map((_, index) => `@qid${index}`).join(", ")})`,
      questionIds.map((questionId, index) => ({
        name: `qid${index}`,
        type: TYPES.Int,
        value: Number(questionId),
      }))
    ).catch(() => ({ rows: [] }));

    const correctByQuestionId = new Map();
    for (const row of correctChoiceRows.rows || []) {
      const questionId = Number(row.QuestionId);
      if (!correctByQuestionId.has(questionId)) correctByQuestionId.set(questionId, new Map());
      correctByQuestionId.get(questionId).set(Number(row.ChoiceId), !!row.IsCorrect);
    }

    quiz.questions = quiz.questions.map((question) => {
      const optionFlags = correctByQuestionId.get(Number(question.questionId)) || new Map();
      return {
        ...question,
        options: (question.options || []).map((option) => ({
          ...option,
          isCorrect: !!optionFlags.get(Number(option.optionId)),
        })),
      };
    });
  }
  const mixMatchMeta = await execQuery(
    `SELECT QuestionId, ISNULL(ShuffleLeft, 0) AS ShuffleLeft, ISNULL(ShuffleRight, 1) AS ShuffleRight, ISNULL(AllowPartialMarks, 1) AS AllowPartialMarks
     FROM dbo.QuizQuestion
     WHERE QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  ).catch(() => ({ rows: [] }));
  const metaByQuestionId = new Map((mixMatchMeta.rows || []).map((meta) => [
    Number(meta.QuestionId),
    {
      shuffleLeft: !!meta.ShuffleLeft,
      shuffleRight: !!meta.ShuffleRight,
      allowPartialMarks: !!meta.AllowPartialMarks,
    },
  ]));
  const matchPairsByQuestionId = await loadMatchPairsByQuestionIds(quiz.questions.map((q) => q.questionId));
  for (const question of quiz.questions) {
    if (normalizeQuestionType(question.questionType) !== "MIX_MATCH_DRAG") continue;
    const pairs = (matchPairsByQuestionId.get(Number(question.questionId)) || []).filter((pair) => pair.isActive);
    const meta = metaByQuestionId.get(Number(question.questionId)) || {};
    const leftItems = pairs.map((pair) => ({ leftMatchPairId: pair.matchPairId, leftText: pair.leftText }));
    const rightItems = pairs.map((pair) => ({ rightMatchPairId: pair.matchPairId, rightText: pair.rightText }));
    question.shuffleLeft = !!meta.shuffleLeft;
    question.shuffleRight = meta.shuffleRight == null ? true : !!meta.shuffleRight;
    question.allowPartialMarks = meta.allowPartialMarks == null ? true : !!meta.allowPartialMarks;
    question.leftItems = question.shuffleLeft
      ? buildDeterministicOrder(leftItems, `${attemptId}:${question.questionId}:left`)
      : leftItems;
    question.rightItems = question.shuffleRight
      ? buildDeterministicOrder(rightItems, `${attemptId}:${question.questionId}:right`)
      : rightItems;
    question.options = [];
  }

  if (!inProgressAttempt && submittedAttempts.length >= attemptLimit) {
    const latestSubmittedAttemptId = submittedAttempts.length
      ? Number(submittedAttempts[submittedAttempts.length - 1].attemptId || 0) || null
      : null;
    return res.status(409).json({
      message: "Maximum attempts reached for this quiz.",
      errorCode: "QUIZ_ATTEMPT_LIMIT_REACHED",
      attemptLimit,
      submittedAttempts: submittedAttempts.length,
      attemptsRemaining: 0,
      attemptSummary,
      latestSubmittedAttemptId,
      quiz,
    });
  }

  res.status(201).json({
    attemptId,
    quiz,
    attemptLimit,
    attemptsRemaining,
    attemptSummary: latestAttemptSummary,
    attemptStartedAtUtc: startedAtUtc,
  });
});

/** POST /api/attempts/:attemptId/disclaimer-ack - persist disclaimer acknowledgment on attempt */
router.post("/attempts/:attemptId/disclaimer-ack", async (req, res) => {
  const attemptIdNum = parseInt(req.params.attemptId, 10);
  if (!Number.isFinite(attemptIdNum)) return res.status(400).json({ message: "Invalid attempt id" });

  const attempt = await execQuery(
    "SELECT AttemptId, StudentId, SubmittedAtUtc FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];

  if (row.SubmittedAtUtc) return res.status(400).json({ message: "Attempt already submitted" });
  if (roleCode(req) === "STUDENT" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (roleCode(req) === "TEACHER") {
    const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
    if (!owns) return res.status(403).json({ message: "Forbidden" });
  }

  await execQuery(
    "UPDATE dbo.QuizAttempt SET DisclaimerAcknowledgment = 1 WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );

  return res.json({ attemptId: attemptIdNum, disclaimerAcknowledged: true });
});

/** POST /api/attempts/:attemptId/answers - upsert one answer (supports LONG partial save). */
router.post("/attempts/:attemptId/answers", async (req, res) => {
  const attemptIdNum = parseInt(req.params.attemptId, 10);
  if (!Number.isFinite(attemptIdNum)) return res.status(400).json({ message: "Invalid attempt id" });
  const body = UpsertAttemptAnswerBody.parse(req.body || {});

  const attempt = await execQuery(
    "SELECT AttemptId, QuizId, StudentId, SubmittedAtUtc, TeacherId FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];
  if (row.SubmittedAtUtc) return res.status(400).json({ message: "Attempt already submitted" });
  if (roleCode(req) === "STUDENT" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (roleCode(req) === "TEACHER") {
    const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
    if (!owns) return res.status(403).json({ message: "Forbidden" });
  }

  const questionResult = await execQuery(
    `SELECT TOP 1 QuestionId, QuestionType
     FROM dbo.QuizQuestion
     WHERE QuizId = @quizId AND QuestionId = @questionId`,
    [
      { name: "quizId", type: TYPES.Int, value: row.QuizId },
      { name: "questionId", type: TYPES.Int, value: body.questionId },
    ]
  );
  const question = questionResult.rows[0];
  if (!question) return res.status(404).json({ message: "Question not found" });

  const qType = normalizeQuestionType(question.QuestionType);
  const textAnswer = qType === "LONG" || qType === "SHORT_TEXT" ? String(body.textAnswer || "").slice(0, 8000) : null;
  const numberAnswer = qType === "NUMERIC" && Number.isFinite(Number(body.numberAnswer)) ? Number(body.numberAnswer) : null;
  const selectedOptionId = qType === "MCQ" || qType === "TRUE_FALSE" ? Number(body.selectedOptionId || 0) || null : null;

  await execQuery(
    `IF EXISTS (
       SELECT 1 FROM dbo.QuizAttemptAnswer WHERE AttemptId = @attemptId AND QuestionId = @questionId
     )
     BEGIN
       UPDATE dbo.QuizAttemptAnswer
       SET SelectedChoiceId = @selectedChoiceId,
           TextAnswer = @textAnswer,
           NumberAnswer = @numberAnswer,
           LastModifiedDate = SYSUTCDATETIME()
       WHERE AttemptId = @attemptId AND QuestionId = @questionId;
     END
     ELSE
     BEGIN
       INSERT INTO dbo.QuizAttemptAnswer
         (TeacherId, AttemptId, QuestionId, SelectedChoiceId, TextAnswer, NumberAnswer, IsCorrect, IsAutoEvaluated, AwardedMarks)
       VALUES
         (@teacherId, @attemptId, @questionId, @selectedChoiceId, @textAnswer, @numberAnswer, 0, 0, 0);
     END`,
    [
      { name: "teacherId", type: TYPES.Int, value: row.TeacherId ?? null },
      { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
      { name: "questionId", type: TYPES.Int, value: body.questionId },
      { name: "selectedChoiceId", type: TYPES.Int, value: selectedOptionId },
      { name: "textAnswer", type: TYPES.NVarChar, value: textAnswer },
      { name: "numberAnswer", type: TYPES.Float, value: numberAnswer },
    ]
  );

  return res.json({ ok: true, attemptId: attemptIdNum, questionId: body.questionId });
});

const SubmitBody = z.object({
  answers: z.array(
    z.object({
      questionId: z.number(),
      selectedOptionId: z.number().nullable().optional(),
      textAnswer: z.string().max(8000).nullable().optional(),
      numberAnswer: z.number().finite().nullable().optional(),
      matchAnswers: z.array(
        z.object({
          leftMatchPairId: z.number().int().positive(),
          selectedRightMatchPairId: z.number().int().positive().nullable().optional(),
        })
      ).optional(),
    })
  ),
});

const UpsertAttemptAnswerBody = z.object({
  questionId: z.number().int().positive(),
  selectedOptionId: z.number().int().positive().nullable().optional(),
  textAnswer: z.string().max(8000).nullable().optional(),
  numberAnswer: z.number().finite().nullable().optional(),
});

/** POST /api/attempts/:attemptId/submit - Submit answers; LONG answers are graded asynchronously. */
router.post("/attempts/:attemptId/submit", async (req, res) => {
  const attemptIdNum = parseInt(req.params.attemptId, 10);
  const body = SubmitBody.parse(req.body || { answers: [] });

  const attempt = await execQuery(
    "SELECT AttemptId, QuizId, StudentId, SubmittedAtUtc, TeacherId FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];
  if (roleCode(req) === "STUDENT" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (roleCode(req) === "TEACHER") {
    const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
    if (!owns) return res.status(403).json({ message: "Forbidden" });
  }
  if (row.SubmittedAtUtc) return res.status(400).json({ message: "Attempt already submitted" });

  const questions = await execQuery(
    `SELECT QuestionId, ISNULL(Points, 1) AS Points, QuestionType, ExpectedAnswerText, AnswerMatchMode, ExpectedAnswerNumber, NumericTolerance,
            ISNULL(AllowPartialMarks, 1) AS AllowPartialMarks
     FROM dbo.QuizQuestion
     WHERE QuizId = @quizId AND ISNULL(IsHiddenForStudent, 0) = 0
     ORDER BY DisplayOrder, QuestionId`,
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );

  let score = 0;
  let total = 0;
  const longAnswerJobs = [];

  await execQuery("DELETE FROM dbo.LongGradingJob WHERE QuizAttemptId = @attemptId", [
    { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
  ]);
  try {
    await execQuery("DELETE FROM dbo.StudentMatchAnswer WHERE AttemptId = @attemptId", [
      { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
    ]);
  } catch {}
  await execQuery("DELETE FROM dbo.QuizAttemptAnswer WHERE AttemptId = @attemptId", [
    { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
  ]);

  const matchPairsByQuestionId = await loadMatchPairsByQuestionIds(questions.rows.map((q) => q.QuestionId));

  for (const q of questions.rows) {
    const points = Number(q.Points || 1);
    total += points;
    const questionType = normalizeQuestionType(q.QuestionType);
    const answerRow = body.answers.find((a) => Number(a.questionId) === Number(q.QuestionId)) || {};
    let selected = null;
    let textAnswer = null;
    let numberAnswer = null;
    let isCorrect = false;
    let isAutoEvaluated = true;
    let awardedMarks = 0;
    let finalScore = null;
    let studentMatchRows = [];

    if (questionType === "MCQ" || questionType === "TRUE_FALSE") {
      const correctOpt = await execQuery(
        "SELECT ChoiceId FROM dbo.QuizChoice WHERE QuestionId = @qid AND IsCorrect = 1",
        [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
      );
      const correctOptionId = correctOpt.rows[0]?.ChoiceId ?? null;
      selected = answerRow?.selectedOptionId ?? null;
      isCorrect = correctOptionId != null && selected === correctOptionId;
      awardedMarks = isCorrect ? points : 0;
      finalScore = awardedMarks;
    } else if (questionType === "SHORT_TEXT") {
      textAnswer = String(answerRow?.textAnswer || "").trim() || null;
      isCorrect = evaluateShortTextAnswer(q.AnswerMatchMode, q.ExpectedAnswerText, textAnswer);
      awardedMarks = isCorrect ? points : 0;
      finalScore = awardedMarks;
    } else if (questionType === "NUMERIC") {
      numberAnswer = Number.isFinite(Number(answerRow?.numberAnswer)) ? Number(answerRow.numberAnswer) : null;
      const expected = Number.isFinite(Number(q.ExpectedAnswerNumber)) ? Number(q.ExpectedAnswerNumber) : null;
      const tolerance = Number.isFinite(Number(q.NumericTolerance)) ? Math.max(0, Number(q.NumericTolerance)) : 0;
      isCorrect = numberAnswer != null && expected != null && Math.abs(numberAnswer - expected) <= tolerance;
      awardedMarks = isCorrect ? points : 0;
      finalScore = awardedMarks;
    } else if (questionType === "LONG") {
      textAnswer = String(answerRow?.textAnswer || "").slice(0, 8000);
      if (!textAnswer.trim()) {
        return res.status(400).json({
          message: req.locale === "fr-CA"
            ? "Veuillez repondre a toutes les questions longues avant de soumettre."
            : "Please answer all long questions before submitting.",
        });
      }
      isAutoEvaluated = false;
      isCorrect = false;
      awardedMarks = 0;
      finalScore = null;
    } else if (questionType === "MIX_MATCH_DRAG") {
      const pairs = (matchPairsByQuestionId.get(Number(q.QuestionId)) || []).filter((pair) => pair.isActive);
      if (pairs.length < 2) {
        return res.status(400).json({ message: "MIX_MATCH_DRAG question is not configured correctly." });
      }
      const answerPairs = Array.isArray(answerRow?.matchAnswers) ? answerRow.matchAnswers : [];
      const answerByLeftId = new Map();
      for (const answer of answerPairs) {
        const leftId = Number(answer?.leftMatchPairId || 0);
        if (!Number.isFinite(leftId) || leftId <= 0 || answerByLeftId.has(leftId)) {
          return res.status(400).json({ message: "Invalid mix-match answer payload." });
        }
        answerByLeftId.set(leftId, Number(answer?.selectedRightMatchPairId || 0) || null);
      }
      const selectedRightIds = new Set();
      let correctPairs = 0;
      for (const pair of pairs) {
        const selectedRightMatchPairId = answerByLeftId.get(pair.matchPairId) ?? null;
        if (!selectedRightMatchPairId) {
          return res.status(400).json({ message: "Please complete all mix-match questions before submitting." });
        }
        if (!pairs.some((candidate) => candidate.matchPairId === selectedRightMatchPairId)) {
          return res.status(400).json({ message: "Invalid mix-match selection." });
        }
        if (selectedRightIds.has(selectedRightMatchPairId)) {
          return res.status(400).json({ message: "Each right-side option may only be used once." });
        }
        selectedRightIds.add(selectedRightMatchPairId);
        const isPairCorrect = selectedRightMatchPairId === pair.matchPairId;
        if (isPairCorrect) correctPairs += 1;
        const selectedRight = pairs.find((candidate) => candidate.matchPairId === selectedRightMatchPairId) || null;
        studentMatchRows.push({
          leftMatchPairId: pair.matchPairId,
          selectedRightMatchPairId,
          selectedRightText: selectedRight?.rightText || "",
          isCorrect: isPairCorrect,
        });
      }
      if (normalizeBooleanFlag(q.AllowPartialMarks, true)) {
        awardedMarks = Number(((correctPairs / pairs.length) * points).toFixed(2));
      } else {
        awardedMarks = correctPairs === pairs.length ? points : 0;
      }
      isCorrect = correctPairs === pairs.length;
      finalScore = awardedMarks;
    }

    score += Number(awardedMarks || 0);
    const inserted = await execQuery(
      `INSERT INTO dbo.QuizAttemptAnswer
         (TeacherId, AttemptId, QuestionId, SelectedChoiceId, TextAnswer, NumberAnswer, IsCorrect, IsAutoEvaluated, AwardedMarks, FinalScore)
       OUTPUT INSERTED.QuizAttemptAnswerId
       VALUES
         (@managerId, @attemptId, @questionId, @selectedChoiceId, @textAnswer, @numberAnswer, @isCorrect, @isAutoEvaluated, @awardedMarks, @finalScore)`,
      [
        { name: "managerId", type: TYPES.Int, value: row.TeacherId ?? null },
        { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
        { name: "questionId", type: TYPES.Int, value: q.QuestionId },
        { name: "selectedChoiceId", type: TYPES.Int, value: selected },
        { name: "textAnswer", type: TYPES.NVarChar, value: textAnswer },
        { name: "numberAnswer", type: TYPES.Float, value: numberAnswer },
        { name: "isCorrect", type: TYPES.Bit, value: isCorrect ? 1 : 0 },
        { name: "isAutoEvaluated", type: TYPES.Bit, value: isAutoEvaluated ? 1 : 0 },
        { name: "awardedMarks", type: TYPES.Float, value: awardedMarks },
        { name: "finalScore", type: TYPES.Decimal, value: finalScore, options: { precision: 6, scale: 2 } },
      ]
    );
    const attemptAnswerId = inserted.rows?.[0]?.QuizAttemptAnswerId;
    if (questionType === "LONG" && attemptAnswerId) {
      longAnswerJobs.push({
        quizAttemptAnswerId: attemptAnswerId,
        questionId: q.QuestionId,
      });
    }
    if (questionType === "MIX_MATCH_DRAG" && studentMatchRows.length) {
      for (const matchRow of studentMatchRows) {
        await execQuery(
          `INSERT INTO dbo.StudentMatchAnswer
             (AttemptId, QuestionId, LeftMatchPairId, SelectedRightMatchPairId, SelectedRightText, IsCorrect)
           VALUES
             (@attemptId, @questionId, @leftMatchPairId, @selectedRightMatchPairId, @selectedRightText, @isCorrect)`,
          [
            { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
            { name: "questionId", type: TYPES.Int, value: q.QuestionId },
            { name: "leftMatchPairId", type: TYPES.Int, value: matchRow.leftMatchPairId },
            { name: "selectedRightMatchPairId", type: TYPES.Int, value: matchRow.selectedRightMatchPairId },
            { name: "selectedRightText", type: TYPES.NVarChar, value: matchRow.selectedRightText || null },
            { name: "isCorrect", type: TYPES.Bit, value: matchRow.isCorrect ? 1 : 0 },
          ]
        );
      }
    }
  }

  const gradingPending = longAnswerJobs.length > 0;
  const gradingStatus = gradingPending ? "Pending" : "Completed";
  const scorePercent = total ? Math.round((score / total) * 10000) / 100 : 0;

  await execQuery(
    `UPDATE dbo.QuizAttempt
     SET SubmittedAtUtc = SYSUTCDATETIME(),
         Score = @score,
         TotalPoints = @total,
         GradingStatus = @gradingStatus,
         GradedAtUtc = CASE WHEN @gradingPending = 1 THEN NULL ELSE SYSUTCDATETIME() END
     WHERE AttemptId = @attemptId`,
    [
      { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
      { name: "score", type: TYPES.Float, value: score },
      { name: "total", type: TYPES.Float, value: total },
      { name: "gradingStatus", type: TYPES.NVarChar, value: gradingStatus },
      { name: "gradingPending", type: TYPES.Bit, value: gradingPending ? 1 : 0 },
    ]
  );

  for (const job of longAnswerJobs) {
    await execQuery(
      `INSERT INTO dbo.LongGradingJob
         (QuizAttemptAnswerId, QuizAttemptId, QuizId, QuestionId, Status, AttemptCount, MaxAttempts, NextRetryAtUtc)
       VALUES
         (@answerId, @attemptId, @quizId, @questionId, 'Queued', 0, 3, SYSUTCDATETIME())`,
      [
        { name: "answerId", type: TYPES.Int, value: job.quizAttemptAnswerId },
        { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
        { name: "quizId", type: TYPES.Int, value: row.QuizId },
        { name: "questionId", type: TYPES.Int, value: job.questionId },
      ]
    );
  }

  await refreshAttemptScore(attemptIdNum);
  await refreshAttemptGradingStatus(attemptIdNum);

  const updatedSummary = await getAttemptSummaryForQuiz(row.QuizId, row.StudentId);
  const attemptLimitRow = await execQuery(
    "SELECT ISNULL(AttemptLimit, 1) AS AttemptLimit FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );
  const attemptLimit = Math.max(1, Math.min(5, Number(attemptLimitRow.rows[0]?.AttemptLimit || 1)));
  const submittedAttempts = updatedSummary.filter((a) => a.submitted).length;
  const attemptsRemaining = Math.max(0, attemptLimit - submittedAttempts);

  return res.json({
    attemptId: attemptIdNum,
    score,
    total,
    scorePercent,
    attemptLimit,
    attemptsRemaining,
    attemptSummary: updatedSummary,
    gradingPending,
    gradingStatus,
  });
});

const OverrideBody = z.object({
  teacherOverrideScore: z.number().finite(),
  teacherOverrideFeedback: z.string().max(800).optional().nullable(),
});

/** POST /api/internal/grade/long - worker-only grading trigger. */
router.post("/internal/grade/long", async (req, res) => {
  const token = parseBearerToken(req.headers.authorization);
  const allowed = [
    String(process.env.LONG_GRADING_SERVICE_TOKEN || "").trim(),
    String(process.env.LONG_GRADING_SERVICE_TOKEN_PREVIOUS || "").trim(),
  ].filter(Boolean);
  if (!token || !allowed.includes(token)) {
    return res.status(401).json({ ok: false, errorCode: "UNAUTHORIZED", message: SAFE_GRADE_ERROR_MESSAGE });
  }

  const jobId = Number(req.body?.longGradingJobId || 0);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return res.status(400).json({ ok: false, errorCode: "INVALID_JOB_ID", message: SAFE_GRADE_ERROR_MESSAGE });
  }

  try {
    const result = await processLongGradingJobById(jobId, {
      correlationId: req.correlationId || null,
      route: req.originalUrl,
      method: req.method,
    });
    if (!result.ok) {
      return res.status(500).json({ ok: false, errorCode: result.errorCode || "UNKNOWN", message: SAFE_GRADE_ERROR_MESSAGE });
    }
    return res.json({ ok: true, longGradingJobId: jobId });
  } catch (err) {
    await logException({
      correlationId: req.correlationId || null,
      source: "attempts.internal.grade.long",
      route: req.originalUrl,
      method: req.method,
      stage: "internal_grade_long_failed",
      error: err,
      meta: { longGradingJobId: jobId },
    });
    return res.status(500).json({ ok: false, errorCode: "UNKNOWN", message: SAFE_GRADE_ERROR_MESSAGE });
  }
});

/** PUT /api/attempts/:attemptId/answers/:attemptAnswerId/override - teacher override for LONG score. */
router.put("/attempts/:attemptId/answers/:attemptAnswerId/override", async (req, res) => {
  if (roleCode(req) !== "TEACHER") return res.status(403).json({ message: "Only teacher can override long answer marks." });
  const attemptIdNum = parseInt(req.params.attemptId, 10);
  const answerIdNum = parseInt(req.params.attemptAnswerId, 10);
  if (!Number.isFinite(attemptIdNum) || !Number.isFinite(answerIdNum)) {
    return res.status(400).json({ message: "Invalid identifiers." });
  }

  const body = OverrideBody.parse(req.body || {});
  const answerResult = await execQuery(
    `SELECT TOP 1 qaa.QuizAttemptAnswerId, qaa.AttemptId, qaa.QuestionId, qa.StudentId, qq.Points, qq.QuestionType
     FROM dbo.QuizAttemptAnswer qaa
     INNER JOIN dbo.QuizAttempt qa ON qa.AttemptId = qaa.AttemptId
     INNER JOIN dbo.QuizQuestion qq ON qq.QuestionId = qaa.QuestionId
     WHERE qaa.AttemptId = @attemptId
       AND qaa.QuizAttemptAnswerId = @answerId`,
    [
      { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
      { name: "answerId", type: TYPES.Int, value: answerIdNum },
    ]
  );
  const row = answerResult.rows[0];
  if (!row) return res.status(404).json({ message: "Attempt answer not found." });
  if (normalizeQuestionType(row.QuestionType) !== "LONG") {
    return res.status(400).json({ message: "Only long question answers can be overridden." });
  }

  const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
  if (!owns) return res.status(403).json({ message: "Forbidden" });

  const maxPoints = Math.max(1, Math.min(100, Number(row.Points || 1)));
  const overrideScore = Number(body.teacherOverrideScore);
  if (!Number.isFinite(overrideScore) || overrideScore < 0 || overrideScore > maxPoints) {
    return res.status(400).json({ message: "Override score must be between 0 and question points." });
  }

  await execQuery(
    `UPDATE dbo.QuizAttemptAnswer
     SET IsTeacherOverridden = 1,
         TeacherOverrideScore = @teacherOverrideScore,
         TeacherOverrideFeedback = @teacherOverrideFeedback,
         FinalScore = @teacherOverrideScore,
         AwardedMarks = @teacherOverrideScore,
         OverriddenAtUtc = SYSUTCDATETIME(),
         OverriddenByTeacherId = @teacherId,
         LastModifiedDate = SYSUTCDATETIME()
     WHERE QuizAttemptAnswerId = @answerId
       AND AttemptId = @attemptId`,
    [
      { name: "teacherOverrideScore", type: TYPES.Decimal, value: overrideScore, options: { precision: 6, scale: 2 } },
      { name: "teacherOverrideFeedback", type: TYPES.NVarChar, value: body.teacherOverrideFeedback || null },
      { name: "teacherId", type: TYPES.Int, value: req.user.userId },
      { name: "answerId", type: TYPES.Int, value: answerIdNum },
      { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
    ]
  );

  await refreshAttemptScore(attemptIdNum);
  await refreshAttemptGradingStatus(attemptIdNum);
  return res.json({ ok: true, attemptId: attemptIdNum, attemptAnswerId: answerIdNum });
});

/** GET /api/attempts/:attemptId/result - Get result with correct answers and explanations (after submit). */
router.get("/attempts/:attemptId/result", async (req, res) => {
  const attemptIdNum = parseInt(req.params.attemptId, 10);

  const attempt = await execQuery(
    "SELECT AttemptId, QuizId, StudentId, SubmittedAtUtc, Score, TotalPoints, ISNULL(GradingStatus, 'Completed') AS GradingStatus FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];
  if (roleCode(req) === "STUDENT" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (roleCode(req) === "TEACHER") {
    const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
    if (!owns) return res.status(403).json({ message: "Forbidden" });
  }
  if (!row.SubmittedAtUtc) return res.status(400).json({ message: "Attempt not yet submitted" });
  const score = row.Score ?? 0;
  const total = row.TotalPoints ?? 0;
  const scorePercent = total ? Math.round((score / total) * 10000) / 100 : 0;

  const answers = await execQuery(
    `SELECT QuizAttemptAnswerId, QuestionId, SelectedChoiceId, TextAnswer, NumberAnswer, AwardedMarks,
            AutoScore, AutoFeedback, FinalScore, IsTeacherOverridden, TeacherOverrideScore, TeacherOverrideFeedback
     FROM dbo.QuizAttemptAnswer
     WHERE AttemptId = @attemptId`,
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  const matchAnswerRows = await execQuery(
    `SELECT StudentMatchAnswerId, QuestionId, LeftMatchPairId, SelectedRightMatchPairId, SelectedRightText, IsCorrect
     FROM dbo.StudentMatchAnswer
     WHERE AttemptId = @attemptId`,
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  ).catch(() => ({ rows: [] }));
  const questions = await execQuery(
    `SELECT QuestionId, QuestionText, Explanation, DiagramType, DiagramData, QuestionType, ExpectedAnswerText, ExpectedAnswerNumber, NumericTolerance
     FROM dbo.QuizQuestion
     WHERE QuizId = @quizId
     ORDER BY DisplayOrder, QuestionId`,
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );
  const matchPairsByQuestionId = await loadMatchPairsByQuestionIds(questions.rows.map((q) => q.QuestionId));
  const details = [];
  for (const q of questions.rows) {
    const questionType = normalizeQuestionType(q.QuestionType);
    let correctOptionId = null;
    if (questionType === "MCQ" || questionType === "TRUE_FALSE") {
      const correctOpt = await execQuery(
        "SELECT ChoiceId FROM dbo.QuizChoice WHERE QuestionId = @qid AND IsCorrect = 1",
        [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
      );
      correctOptionId = correctOpt.rows[0]?.ChoiceId ?? null;
    }
    const ans = answers.rows.find((a) => a.QuestionId === q.QuestionId);
    const selectedOptionId = ans?.SelectedChoiceId ?? null;
    const pairs = questionType === "MIX_MATCH_DRAG" ? (matchPairsByQuestionId.get(Number(q.QuestionId)) || []) : [];
    const matchDetails = questionType === "MIX_MATCH_DRAG"
      ? pairs.map((pair) => {
          const studentRow = (matchAnswerRows.rows || []).find((rowItem) => Number(rowItem.QuestionId) === Number(q.QuestionId) && Number(rowItem.LeftMatchPairId) === Number(pair.matchPairId));
          const selectedRightPair = pairs.find((candidate) => Number(candidate.matchPairId) === Number(studentRow?.SelectedRightMatchPairId || 0)) || null;
          return {
            leftMatchPairId: pair.matchPairId,
            leftText: pair.leftText,
            correctRightMatchPairId: pair.matchPairId,
            correctRightText: pair.rightText,
            selectedRightMatchPairId: studentRow?.SelectedRightMatchPairId != null ? Number(studentRow.SelectedRightMatchPairId) : null,
            selectedRightText: selectedRightPair?.rightText || studentRow?.SelectedRightText || null,
            isCorrect: !!studentRow?.IsCorrect,
          };
        })
      : [];
    details.push({
      questionId: q.QuestionId,
      questionText: q.QuestionText,
      questionType,
      diagramType: q.DiagramType || "none",
      diagramData: q.DiagramData || null,
      correctOptionId,
      selectedOptionId,
      selectedTextAnswer: ans?.TextAnswer ?? null,
      selectedNumberAnswer: ans?.NumberAnswer != null ? Number(ans.NumberAnswer) : null,
      awardedMarks: ans?.AwardedMarks != null ? Number(ans.AwardedMarks) : null,
      autoScore: ans?.AutoScore != null ? Number(ans.AutoScore) : null,
      autoFeedback: ans?.AutoFeedback || null,
      finalScore: ans?.FinalScore != null ? Number(ans.FinalScore) : null,
      isTeacherOverridden: !!ans?.IsTeacherOverridden,
      teacherOverrideScore: ans?.TeacherOverrideScore != null ? Number(ans.TeacherOverrideScore) : null,
      teacherOverrideFeedback: ans?.TeacherOverrideFeedback || null,
      expectedAnswerText: q.ExpectedAnswerText || null,
      expectedAnswerNumber: q.ExpectedAnswerNumber != null ? Number(q.ExpectedAnswerNumber) : null,
      numericTolerance: q.NumericTolerance != null ? Number(q.NumericTolerance) : null,
      matchPairs: matchDetails,
      explanation: q.Explanation,
    });
  }

  const summary = await getAttemptSummaryForQuiz(row.QuizId, row.StudentId);
  const attemptLimitRow = await execQuery(
    "SELECT ISNULL(AttemptLimit, 1) AS AttemptLimit FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );
  const attemptLimit = Math.max(1, Math.min(5, Number(attemptLimitRow.rows[0]?.AttemptLimit || 1)));
  const submittedAttempts = summary.filter((a) => a.submitted).length;
  const attemptsRemaining = Math.max(0, attemptLimit - submittedAttempts);

  res.json({
    score,
    total,
    scorePercent,
    details,
    attemptLimit,
    attemptsRemaining,
    attemptSummary: summary,
    gradingStatus: row.GradingStatus || "Completed",
    gradingPending: ["Pending", "Processing"].includes(String(row.GradingStatus || "")),
  });
});

module.exports = router;

