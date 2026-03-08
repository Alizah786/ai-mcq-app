const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { TYPES } = require("tedious");
const {
  assertStudentCanCreateQuiz,
  assertManagerCanCreateQuiz,
  PaymentRequiredError,
} = require("../services/quizQuota");
const { getSubscriptionStatus } = require("../services/subscription");
const { validateEducationalQuizEntry } = require("../services/contentPolicy");
const { logUsageEventByActor } = require("../services/usageEvents");

const router = express.Router();

router.use(requireAuth);

// Backward compatibility: support legacy /manager-review routes.
router.use("/quizzes/:quizId/manager-review", (req, res, next) => {
  const rest = req.url || "";
  req.url = `/quizzes/${req.params.quizId}/teacher-review${rest}`;
  next();
});

function isAiSource(sourceType) {
  const value = String(sourceType || "").toUpperCase();
  return value.startsWith("AI");
}

function randomJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function normalizeQuestionType(value) {
  const v = String(value || "MCQ").toUpperCase();
  if (v === "SHORT_TEXT" || v === "NUMERIC" || v === "TRUE_FALSE" || v === "LONG" || v === "MCQ" || v === "MIX_MATCH_DRAG") return v;
  return "MCQ";
}

const MIX_MATCH_MAX_PAIRS = 10;

function normalizeBooleanFlag(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function normalizeMatchPairs(pairs = []) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map((pair, index) => ({
    matchPairId: Number(pair?.matchPairId || 0) || null,
    leftText: String(pair?.leftText || "").trim(),
    rightText: String(pair?.rightText || "").trim(),
    displayOrder: Number.isFinite(Number(pair?.displayOrder)) ? Math.trunc(Number(pair.displayOrder)) : index,
    isActive: pair?.isActive == null ? true : normalizeBooleanFlag(pair.isActive, true),
  }));
}

function validateMixMatchPairs(pairs, questionIndexLabel) {
  const normalized = normalizeMatchPairs(pairs);
  if (normalized.length < 2) {
    return `${questionIndexLabel}: MIX_MATCH_DRAG requires at least 2 pairs.`;
  }
  if (normalized.length > MIX_MATCH_MAX_PAIRS) {
    return `${questionIndexLabel}: MIX_MATCH_DRAG supports at most ${MIX_MATCH_MAX_PAIRS} pairs.`;
  }
  const seenLeft = new Set();
  const seenRight = new Set();
  for (let i = 0; i < normalized.length; i++) {
    const pair = normalized[i];
    if (!pair.leftText || !pair.rightText) {
      return `${questionIndexLabel}: each match pair requires both left and right text.`;
    }
    if (pair.leftText.length > 500 || pair.rightText.length > 500) {
      return `${questionIndexLabel}: match pair text must be 500 characters or fewer.`;
    }
    const leftKey = pair.leftText.toLocaleLowerCase();
    const rightKey = pair.rightText.toLocaleLowerCase();
    if (seenLeft.has(leftKey)) {
      return `${questionIndexLabel}: duplicate left text is not allowed.`;
    }
    if (seenRight.has(rightKey)) {
      return `${questionIndexLabel}: duplicate right text is not allowed.`;
    }
    seenLeft.add(leftKey);
    seenRight.add(rightKey);
  }
  return null;
}

function normalizeAnswerMatchMode(value) {
  const v = String(value || "EXACT").toUpperCase();
  if (v === "EXACT" || v === "CONTAINS" || v === "KEYWORDS") return v;
  return "EXACT";
}

function normalizeTimeLimitMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 300) return 300;
  return i;
}

function normalizeQuizHeaderExtraLines(lines = []) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      text: String(line?.text || "").replace(/\s+/g, " ").trim().slice(0, 200),
      showOnHeader: line?.showOnHeader == null ? true : normalizeBooleanFlag(line.showOnHeader, true),
    }))
    .filter((line) => line.text);
}

function parseQuizHeaderExtraLines(rawValue) {
  if (!rawValue) return [];
  try {
    return normalizeQuizHeaderExtraLines(JSON.parse(String(rawValue)));
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
  return parseQuizHeaderExtraLines(result.rows[0]?.HeaderExtraLinesJson || null);
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

async function loadQuizPublishWindow(quizId) {
  if (!(await hasQuizPublishScheduleColumns())) {
    return { publishStartUtc: null, publishEndUtc: null };
  }
  const result = await execQuery(
    "SELECT PublishStartUtc, PublishEndUtc FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  return {
    publishStartUtc: result.rows[0]?.PublishStartUtc || null,
    publishEndUtc: result.rows[0]?.PublishEndUtc || null,
  };
}

let quizPublishScheduleColumnsAvailablePromise = null;

async function hasQuizPublishScheduleColumns() {
  if (!quizPublishScheduleColumnsAvailablePromise) {
    quizPublishScheduleColumnsAvailablePromise = execQuery(
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
  return quizPublishScheduleColumnsAvailablePromise;
}

function parsePublishScheduleBody(body = {}) {
  const publishNow = body.publishNow !== false;
  if (publishNow) {
    return { publishNow: true, publishStartUtc: null, publishEndUtc: null };
  }
  const publishStartUtc = body.publishStartUtc ? new Date(String(body.publishStartUtc)) : null;
  const publishEndUtc = body.publishEndUtc ? new Date(String(body.publishEndUtc)) : null;
  if (!publishStartUtc || Number.isNaN(publishStartUtc.getTime())) {
    throw new Error("Quiz start date/time is required when Publish now is unchecked.");
  }
  if (publishEndUtc && Number.isNaN(publishEndUtc.getTime())) {
    throw new Error("Quiz expiry date/time is invalid.");
  }
  if (publishEndUtc && publishEndUtc.getTime() <= publishStartUtc.getTime()) {
    throw new Error("Quiz expiry date/time must be after quiz start date/time.");
  }
  return {
    publishNow: false,
    publishStartUtc: publishStartUtc.toISOString(),
    publishEndUtc: publishEndUtc ? publishEndUtc.toISOString() : null,
  };
}

function validateQuestionPayload(questions = []) {
  let longCount = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] || {};
    const questionType = normalizeQuestionType(q.questionType);
    if (questionType === "LONG") longCount += 1;
    const options = Array.isArray(q.options) ? q.options : [];
    if (questionType === "MCQ" || questionType === "TRUE_FALSE") {
      if (!options.length) return `Question ${i + 1}: MCQ requires at least one option.`;
      if (questionType === "MCQ" && options.length > 4) {
        return `Question ${i + 1}: MCQ supports maximum 4 options.`;
      }
      const correctCount = options.filter((o) => !!o.isCorrect).length;
      if (correctCount !== 1) return `Question ${i + 1}: MCQ must have exactly one correct option.`;
      if (questionType === "TRUE_FALSE" && options.length !== 2) {
        return `Question ${i + 1}: TRUE_FALSE must have exactly two options (True/False).`;
      }
      continue;
    }
    if (questionType === "SHORT_TEXT") {
      if (!String(q.expectedAnswerText || "").trim()) {
        return `Question ${i + 1}: SHORT_TEXT requires expected answer text.`;
      }
      continue;
    }
    if (questionType === "LONG") {
      const questionText = String(q.questionText || "");
      const explanation = String(q.explanation || "");
      const points = Number(q.points);
      if (questionText.trim().length < 20 || questionText.trim().length > 4000) {
        return `Question ${i + 1}: LONG question text must be 20 to 4000 characters.`;
      }
      if (explanation.length > 3000) {
        return `Question ${i + 1}: explanation must be 3000 characters or fewer.`;
      }
      if (!Number.isFinite(points) || points < 1 || points > 100) {
        return `Question ${i + 1}: LONG points must be between 1 and 100.`;
      }
      continue;
    }
    if (questionType === "NUMERIC") {
      if (!Number.isFinite(Number(q.expectedAnswerNumber))) {
        return `Question ${i + 1}: NUMERIC requires expected answer number.`;
      }
      if (q.numericTolerance != null && Number(q.numericTolerance) < 0) {
        return `Question ${i + 1}: numeric tolerance cannot be negative.`;
      }
      continue;
    }
    if (questionType === "MIX_MATCH_DRAG") {
      const pairError = validateMixMatchPairs(q.pairs, `Question ${i + 1}`);
      if (pairError) return pairError;
    }
  }
  if (longCount > 5) {
    return "A quiz can have a maximum of 5 long questions.";
  }
  return null;
}

function normalizeChoiceList(questionType, options = []) {
  const qType = normalizeQuestionType(questionType);
  const max =
    qType === "TRUE_FALSE"
      ? 2
      : qType === "MCQ"
        ? 4
        : 0;
  if (max <= 0) return [];
  return (Array.isArray(options) ? options : [])
    .slice(0, max)
    .map((o, idx) => ({
      text: String(o?.text || "").trim().slice(0, 1000),
      isCorrect: !!o?.isCorrect,
      label: String(o?.label || "").trim().slice(0, 5) || null,
      displayOrder: Number.isFinite(Number(o?.displayOrder)) ? Number(o.displayOrder) : idx + 1,
      optionId: Number(o?.optionId || 0) || null,
    }))
    .filter((o) => o.text);
}

function withOptionLabels(options = []) {
  const labels = ["A", "B", "C", "D", "E", "F"];
  return (options || []).map((o, i) => ({
    ...o,
    label: o.label || labels[i] || String(i + 1),
  }));
}

async function loadQuestionTypeMetadata(quizId) {
  try {
    const result = await execQuery(
      `SELECT QuestionId,
              ISNULL(ShuffleLeft, 0) AS ShuffleLeft,
              ISNULL(ShuffleRight, 1) AS ShuffleRight,
              ISNULL(AllowPartialMarks, 1) AS AllowPartialMarks
       FROM dbo.QuizQuestion
       WHERE QuizId = @quizId`,
      [{ name: "quizId", type: TYPES.Int, value: quizId }]
    );
    const map = new Map();
    for (const row of result.rows || []) {
      map.set(Number(row.QuestionId), {
        shuffleLeft: !!row.ShuffleLeft,
        shuffleRight: !!row.ShuffleRight,
        allowPartialMarks: !!row.AllowPartialMarks,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadMatchPairRows(questionIds = []) {
  const ids = Array.from(new Set((questionIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return [];
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
    return result.rows || [];
  } catch {
    return [];
  }
}

function attachMixMatchDataToQuestions(questions, metadataMap, pairRows) {
  const pairsByQuestionId = new Map();
  for (const row of pairRows || []) {
    const questionId = Number(row.QuestionId);
    if (!pairsByQuestionId.has(questionId)) pairsByQuestionId.set(questionId, []);
    pairsByQuestionId.get(questionId).push({
      matchPairId: Number(row.MatchPairId),
      leftText: row.LeftText || "",
      rightText: row.RightText || "",
      displayOrder: Number(row.DisplayOrder || 0),
      isActive: !!row.IsActive,
    });
  }
  for (const question of questions || []) {
    const meta = metadataMap.get(Number(question.questionId)) || {};
    question.shuffleLeft = !!meta.shuffleLeft;
    question.shuffleRight = meta.shuffleRight == null ? true : !!meta.shuffleRight;
    question.allowPartialMarks = meta.allowPartialMarks == null ? true : !!meta.allowPartialMarks;
    question.pairs = pairsByQuestionId.get(Number(question.questionId)) || [];
  }
}

async function replaceMatchPairs(questionId, teacherId, pairs = []) {
  await execQuery("DELETE FROM dbo.MatchPair WHERE QuestionId = @questionId", [
    { name: "questionId", type: TYPES.Int, value: questionId },
  ]);
  const normalizedPairs = normalizeMatchPairs(pairs);
  for (let i = 0; i < normalizedPairs.length; i++) {
    const pair = normalizedPairs[i];
    await execQuery(
      `INSERT INTO dbo.MatchPair (QuestionId, LeftText, RightText, DisplayOrder, IsActive, UpdatedDate)
       VALUES (@questionId, @leftText, @rightText, @displayOrder, @isActive, NULL)`,
      [
        { name: "questionId", type: TYPES.Int, value: questionId },
        { name: "leftText", type: TYPES.NVarChar, value: pair.leftText },
        { name: "rightText", type: TYPES.NVarChar, value: pair.rightText },
        { name: "displayOrder", type: TYPES.Int, value: i },
        { name: "isActive", type: TYPES.Bit, value: pair.isActive ? 1 : 0 },
      ]
    );
  }
}

async function getActiveDisclaimerByType(type) {
  const result = await execQuery(
    `SELECT TOP 1 DisclaimerId, Title, DisclaimerText, DisclaimerType, Version, IsActive
     FROM dbo.Disclaimer
     WHERE DisclaimerType = @type
       AND IsActive = 1
     ORDER BY DisclaimerId DESC`,
    [{ name: "type", type: TYPES.NVarChar, value: type }]
  );
  return result.rows[0] || null;
}

/** GET /api/disclaimers/active - returns active manual and ai disclaimers */
router.get("/disclaimers/active", async (_req, res) => {
  const manual = await getActiveDisclaimerByType("MANUAL");
  const ai = await getActiveDisclaimerByType("AI");
  return res.json({ manual, ai });
});

async function canAccessClass(req, classId) {
  if (req.user.role === "Manager") {
    const r = await execQuery(
      `SELECT 1
       FROM dbo.Class c
       JOIN dbo.Student s ON s.StudentId = c.StudentId
       WHERE c.ClassId = @classId AND s.TeacherId = @managerId`,
      [
        { name: "classId", type: TYPES.Int, value: classId },
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
      ]
    );
    return !!r.rows.length;
  }

  const r = await execQuery(
    "SELECT 1 FROM dbo.Class WHERE ClassId = @classId AND StudentId = @studentId",
    [
      { name: "classId", type: TYPES.Int, value: classId },
      { name: "studentId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  return !!r.rows.length;
}

async function getMaxMcqsPerQuizForClass(classId) {
  const owner = await execQuery(
    "SELECT TOP 1 StudentId, TeacherId FROM dbo.Class WHERE ClassId = @classId",
    [{ name: "classId", type: TYPES.Int, value: classId }]
  );
  const studentId = owner.rows[0]?.StudentId;
  const teacherId = owner.rows[0]?.TeacherId;
  if (!studentId) return 20;

  const studentSub = await getSubscriptionStatus("Student", studentId);
  let max = Number(studentSub?.maxMcqsPerQuiz || 20);
  if (teacherId) {
    try {
      const teacherSub = await getSubscriptionStatus("Teacher", teacherId);
      const teacherMax = Number(teacherSub?.maxMcqsPerQuiz || max);
      if (Number.isFinite(teacherMax) && teacherMax > 0) {
        max = Math.min(max, teacherMax);
      }
    } catch {
      // Keep student max when teacher lookup is unavailable.
    }
  }
  if (!Number.isFinite(max) || max < 1) return 20;
  return max;
}

async function getQuizScopeForManager(managerId, quizId) {
  const quiz = await execQuery(
    `SELECT q.QuizId, q.ClassId, q.TeacherId, q.Title, q.Topic, q.Difficulty, q.SourceType, q.Status,
            q.ParentQuizId, q.IsTeacherEdited, q.RequiresTeacherReview, q.TeacherReviewed, q.TeacherReviewedByTeacherId, q.TeacherReviewedAtUtc,
            q.DisclaimerId, q.AttemptLimit, q.TimeLimitMinutes
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     JOIN dbo.Student s ON s.StudentId = c.StudentId
     WHERE q.QuizId = @quizId
       AND s.TeacherId = @managerId`,
    [
      { name: "quizId", type: TYPES.Int, value: quizId },
      { name: "managerId", type: TYPES.Int, value: managerId },
    ]
  );
  return quiz.rows[0] || null;
}

async function loadQuizContent(quizId) {
  const headerExtraLines = await loadQuizHeaderExtraLines(quizId).catch(() => []);
  const assessmentType = await loadQuizAssessmentType(quizId).catch(() => "QUIZ");
  const revealAnswersAfterSubmit = await loadQuizRevealAnswersAfterSubmit(quizId).catch(() => false);
  const publishWindow = await loadQuizPublishWindow(quizId).catch(() => ({ publishStartUtc: null, publishEndUtc: null }));
  try {
    const proc = await execQuery("EXEC dbo.usp_Quiz_LoadContent @QuizId", [
      { name: "QuizId", type: TYPES.Int, value: quizId },
    ]);
    if (proc.rows.length) {
      const quizRow = proc.rows[0];
      const result = {
        quizId: quizRow.QuizId,
        classId: quizRow.ClassId,
        title: quizRow.Title,
        description: quizRow.Topic,
        difficulty: quizRow.Difficulty || null,
        timeLimitMinutes: Number(quizRow.TimeLimitMinutes || 0),
        sourceType: quizRow.SourceType || null,
        status: quizRow.Status,
        parentQuizId: quizRow.ParentQuizId || null,
        isTeacherEdited: !!quizRow.IsTeacherEdited,
        requiresTeacherReview: !!quizRow.RequiresTeacherReview,
        teacherReviewed: !!quizRow.TeacherReviewed,
        teacherReviewedAtUtc: quizRow.TeacherReviewedAtUtc || null,
        isManagerEdited: !!quizRow.IsTeacherEdited,
        requiresManagerReview: !!quizRow.RequiresTeacherReview,
        managerReviewed: !!quizRow.TeacherReviewed,
        managerReviewedAtUtc: quizRow.TeacherReviewedAtUtc || null,
        assessmentType,
        revealAnswersAfterSubmit,
        publishStartUtc: publishWindow.publishStartUtc,
        publishEndUtc: publishWindow.publishEndUtc,
        headerExtraLines,
        questions: [],
      };

      const questionMap = new Map();
      for (const row of proc.rows) {
        if (row.QuestionId == null) continue;
        let question = questionMap.get(row.QuestionId);
        if (!question) {
          question = {
            questionId: row.QuestionId,
            questionText: row.QuestionText,
            explanation: row.Explanation || "",
            diagramType: row.DiagramType || "none",
            diagramData: row.DiagramData || "",
            points: Number(row.Points || 1),
            questionType: normalizeQuestionType(row.QuestionType),
            expectedAnswerText: row.ExpectedAnswerText || "",
            answerMatchMode: row.AnswerMatchMode || "EXACT",
            expectedAnswerNumber: row.ExpectedAnswerNumber != null ? Number(row.ExpectedAnswerNumber) : null,
            numericTolerance: row.NumericTolerance != null ? Number(row.NumericTolerance) : null,
            isHiddenForStudent: !!row.IsHiddenForStudent,
            options: [],
          };
          questionMap.set(row.QuestionId, question);
          result.questions.push(question);
        }
        if (row.ChoiceId == null) continue;
        question.options.push({
          optionId: row.ChoiceId,
          text: row.ChoiceText,
          isCorrect: !!row.IsCorrect,
        });
      }
      result.questions = result.questions.map((question) => ({
        ...question,
        options: withOptionLabels(normalizeChoiceList(question.questionType, question.options)),
      }));
      await hydrateMissingChoiceOptions(result.questions);
      const metadataMap = await loadQuestionTypeMetadata(quizId);
      const pairRows = await loadMatchPairRows(result.questions.map((q) => q.questionId));
      attachMixMatchDataToQuestions(result.questions, metadataMap, pairRows);
      return result;
    }
  } catch (error) {
    const message = String(error?.message || "");
    const missingProc =
      message.includes("Could not find stored procedure") || message.includes("usp_Quiz_LoadContent");
    if (!missingProc) throw error;
  }

  const quiz = await execQuery(
    `SELECT QuizId, ClassId, Title, Topic, Difficulty, SourceType, Status, ParentQuizId,
            IsTeacherEdited, RequiresTeacherReview, TeacherReviewed, TeacherReviewedAtUtc,
            ISNULL(TimeLimitMinutes, 0) AS TimeLimitMinutes
     FROM dbo.Quiz
     WHERE QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  const quizRow = quiz.rows[0] || null;
  if (!quizRow) return null;

  const questions = await execQuery(
    `SELECT QuestionId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder, ISNULL(Points, 1) AS Points,
            QuestionType, ExpectedAnswerText, AnswerMatchMode, ExpectedAnswerNumber, NumericTolerance
     FROM dbo.QuizQuestion
     WHERE QuizId = @quizId
     ORDER BY DisplayOrder, QuestionId`,
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  const result = {
    quizId: quizRow.QuizId,
    classId: quizRow.ClassId,
    title: quizRow.Title,
    description: quizRow.Topic,
    difficulty: quizRow.Difficulty || null,
    timeLimitMinutes: Number(quizRow.TimeLimitMinutes || 0),
    sourceType: quizRow.SourceType || null,
    status: quizRow.Status,
    parentQuizId: quizRow.ParentQuizId || null,
    isTeacherEdited: !!quizRow.IsTeacherEdited,
    requiresTeacherReview: !!quizRow.RequiresTeacherReview,
    teacherReviewed: !!quizRow.TeacherReviewed,
    teacherReviewedAtUtc: quizRow.TeacherReviewedAtUtc || null,
    isManagerEdited: !!quizRow.IsTeacherEdited,
    requiresManagerReview: !!quizRow.RequiresTeacherReview,
    managerReviewed: !!quizRow.TeacherReviewed,
    managerReviewedAtUtc: quizRow.TeacherReviewedAtUtc || null,
    assessmentType,
    revealAnswersAfterSubmit,
    publishStartUtc: publishWindow.publishStartUtc,
    publishEndUtc: publishWindow.publishEndUtc,
    headerExtraLines,
    questions: [],
  };
  for (const q of questions.rows) {
    const opts = await execQuery(
      "SELECT ChoiceId, ChoiceText, IsCorrect, DisplayOrder FROM dbo.QuizChoice WHERE QuestionId = @qid ORDER BY DisplayOrder, ChoiceId",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    result.questions.push({
      questionId: q.QuestionId,
      questionText: q.QuestionText,
      explanation: q.Explanation || "",
      diagramType: q.DiagramType || "none",
      diagramData: q.DiagramData || "",
      points: Number(q.Points || 1),
      questionType: normalizeQuestionType(q.QuestionType),
      expectedAnswerText: q.ExpectedAnswerText || "",
      answerMatchMode: q.AnswerMatchMode || "EXACT",
      expectedAnswerNumber: q.ExpectedAnswerNumber != null ? Number(q.ExpectedAnswerNumber) : null,
      numericTolerance: q.NumericTolerance != null ? Number(q.NumericTolerance) : null,
      isHiddenForStudent: !!q.IsHiddenForStudent,
      options: withOptionLabels(
        normalizeChoiceList(
          normalizeQuestionType(q.QuestionType),
          opts.rows.map((o, i) => ({
            optionId: o.ChoiceId,
            label: ["A", "B", "C", "D", "E", "F"][i] || String(i + 1),
            text: o.ChoiceText,
            isCorrect: !!o.IsCorrect,
          }))
        )
      ),
      pairs: [],
    });
  }
  const metadataMap = await loadQuestionTypeMetadata(quizId);
  const pairRows = await loadMatchPairRows(result.questions.map((q) => q.questionId));
  attachMixMatchDataToQuestions(result.questions, metadataMap, pairRows);
  return result;
}

async function listQuizAssignmentStudents(quizId, managerId, classNameFilter) {
  try {
    const proc = await execQuery(
      "EXEC dbo.usp_QuizAssignment_ListStudents @QuizId, @ManagerId, @ClassName",
      [
        { name: "QuizId", type: TYPES.Int, value: quizId },
        { name: "ManagerId", type: TYPES.Int, value: managerId },
        { name: "ClassName", type: TYPES.NVarChar, value: classNameFilter || null },
      ]
    );
    if (!proc.rows.length) return null;

    const firstQuizRow = proc.rows.find((row) => row.QuizId != null);
    if (!firstQuizRow) return null;

    const classOptions = [];
    const classOptionSet = new Set();
    const students = [];
    const studentSet = new Set();

    for (const row of proc.rows) {
      const classOption = String(row.ClassOption || "").trim();
      if (classOption && !classOptionSet.has(classOption)) {
        classOptionSet.add(classOption);
        classOptions.push(classOption);
      }
      if (row.StudentId == null || studentSet.has(row.StudentId)) continue;
      studentSet.add(row.StudentId);
      students.push({
        studentId: row.StudentId,
        studentCode: row.FullName,
        userName: row.Email,
        isActive: !!row.IsActive,
        assigned: !!row.Assigned,
      });
    }

    return {
      quizId: firstQuizRow.QuizId,
      quizTitle: firstQuizRow.QuizTitle,
      quizClassName: firstQuizRow.QuizClassName || "",
      selectedClassName: classNameFilter || "",
      classOptions,
      students,
    };
  } catch (error) {
    const message = String(error?.message || "");
    const missingProc =
      message.includes("Could not find stored procedure") ||
      message.includes("usp_QuizAssignment_ListStudents");
    if (!missingProc) throw error;
    return null;
  }
}

async function replaceQuizAssignments(quizId, managerId, quizMeta, studentIds) {
  try {
    const proc = await execQuery(
      "EXEC dbo.usp_QuizAssignment_ReplaceAssignments @QuizId, @ManagerId, @ClassName, @Subject, @GradeLevel, @StudentIdsJson",
      [
        { name: "QuizId", type: TYPES.Int, value: quizId },
        { name: "ManagerId", type: TYPES.Int, value: managerId },
        { name: "ClassName", type: TYPES.NVarChar, value: quizMeta.ClassName },
        { name: "Subject", type: TYPES.NVarChar, value: quizMeta.Subject || null },
        { name: "GradeLevel", type: TYPES.NVarChar, value: quizMeta.GradeLevel || null },
        { name: "StudentIdsJson", type: TYPES.NVarChar, value: JSON.stringify(studentIds || []) },
      ]
    );
    return Number(proc.rows?.[0]?.CreatedClasses || 0);
  } catch (error) {
    const message = String(error?.message || "");
    const missingProc =
      message.includes("Could not find stored procedure") ||
      message.includes("usp_QuizAssignment_ReplaceAssignments");
    if (!missingProc) throw error;
    return null;
  }
}

async function replaceQuizContent(quizId, managerId, questions, options = {}) {
  const useStoredProc = options?.useStoredProc !== false;
  const hasMixMatch = (questions || []).some((q) => normalizeQuestionType(q?.questionType) === "MIX_MATCH_DRAG");
  if (useStoredProc && !hasMixMatch) {
    try {
      await execQuery("EXEC dbo.usp_QuizContent_Replace @TeacherId, @QuizId, @QuestionsJson", [
        { name: "TeacherId", type: TYPES.Int, value: managerId },
        { name: "QuizId", type: TYPES.Int, value: quizId },
        { name: "QuestionsJson", type: TYPES.NVarChar, value: JSON.stringify(questions || []) },
      ]);
      return;
    } catch (error) {
      const message = String(error?.message || "");
      const missingProc =
        message.includes("Could not find stored procedure") ||
        message.includes("usp_QuizContent_Replace");
      if (!missingProc) throw error;
    }
  }

  try {
    await execQuery("DELETE FROM dbo.StudentMatchAnswer WHERE QuestionId IN (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId = @quizId)", [
      { name: "quizId", type: TYPES.Int, value: quizId },
    ]);
  } catch {}
  try {
    await execQuery("DELETE FROM dbo.MatchPair WHERE QuestionId IN (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId = @quizId)", [
      { name: "quizId", type: TYPES.Int, value: quizId },
    ]);
  } catch {}
  await execQuery("DELETE FROM dbo.QuizChoice WHERE QuestionId IN (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId = @quizId)", [
    { name: "quizId", type: TYPES.Int, value: quizId },
  ]);
  await execQuery("DELETE FROM dbo.QuizQuestion WHERE QuizId = @quizId", [{ name: "quizId", type: TYPES.Int, value: quizId }]);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const questionType = normalizeQuestionType(q.questionType);
    const points =
      questionType === "LONG"
        ? Math.max(1, Math.min(100, Number(q.points || 1)))
        : Math.max(1, Math.min(100, Number(q.points || 1)));
    const answerMatchMode = questionType === "SHORT_TEXT" ? normalizeAnswerMatchMode(q.answerMatchMode) : null;
    const expectedAnswerText = questionType === "SHORT_TEXT" ? (String(q.expectedAnswerText || "").trim() || null) : null;
    const expectedAnswerNumber =
      questionType === "NUMERIC" && Number.isFinite(Number(q.expectedAnswerNumber))
        ? Number(q.expectedAnswerNumber)
        : null;
    const numericTolerance =
      questionType === "NUMERIC" && Number.isFinite(Number(q.numericTolerance))
        ? Math.max(0, Number(q.numericTolerance))
        : null;
    const inserted = await execQuery(
        `INSERT INTO dbo.QuizQuestion (
          TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder,
          QuestionType, ExpectedAnswerText, AnswerMatchMode, ExpectedAnswerNumber, NumericTolerance, Points,
          ShuffleLeft, ShuffleRight, AllowPartialMarks
        )
       OUTPUT INSERTED.QuestionId
       VALUES (
         @managerId, @quizId, @text, @explanation, @diagramType, @diagramData, @isHiddenForStudent, @displayOrder,
         @questionType, @expectedAnswerText, @answerMatchMode, @expectedAnswerNumber, @numericTolerance, @points,
         @shuffleLeft, @shuffleRight, @allowPartialMarks
       )`,
      [
        { name: "managerId", type: TYPES.Int, value: managerId },
        { name: "quizId", type: TYPES.Int, value: quizId },
        { name: "text", type: TYPES.NVarChar, value: q.questionText },
        { name: "explanation", type: TYPES.NVarChar, value: q.explanation || null },
        { name: "diagramType", type: TYPES.NVarChar, value: q.diagramType || "none" },
        { name: "diagramData", type: TYPES.NVarChar, value: q.diagramData || null },
        { name: "isHiddenForStudent", type: TYPES.Bit, value: q.isHiddenForStudent ? 1 : 0 },
        { name: "displayOrder", type: TYPES.Int, value: i + 1 },
        { name: "questionType", type: TYPES.NVarChar, value: questionType },
        { name: "expectedAnswerText", type: TYPES.NVarChar, value: expectedAnswerText },
        { name: "answerMatchMode", type: TYPES.NVarChar, value: answerMatchMode },
        { name: "expectedAnswerNumber", type: TYPES.Float, value: expectedAnswerNumber },
        { name: "numericTolerance", type: TYPES.Float, value: numericTolerance },
        { name: "points", type: TYPES.Int, value: points },
        { name: "shuffleLeft", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" && normalizeBooleanFlag(q.shuffleLeft, false) ? 1 : 0 },
        { name: "shuffleRight", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" ? (normalizeBooleanFlag(q.shuffleRight, true) ? 1 : 0) : 1 },
        { name: "allowPartialMarks", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" ? (normalizeBooleanFlag(q.allowPartialMarks, true) ? 1 : 0) : 1 },
      ]
    );
    const questionId = inserted.rows[0].QuestionId;
    if (questionType === "MIX_MATCH_DRAG") {
      await replaceMatchPairs(questionId, managerId, q.pairs || []);
      continue;
    }
    if (questionType !== "MCQ" && questionType !== "TRUE_FALSE") continue;
    const normalizedOptions = normalizeChoiceList(questionType, q.options || []);
    for (let j = 0; j < normalizedOptions.length; j++) {
      const o = normalizedOptions[j];
      await execQuery(
        `INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
         VALUES (@managerId, @qid, @text, @isCorrect, @displayOrder)`,
        [
          { name: "managerId", type: TYPES.Int, value: managerId },
          { name: "qid", type: TYPES.Int, value: questionId },
          { name: "text", type: TYPES.NVarChar, value: o.text },
          { name: "isCorrect", type: TYPES.Bit, value: o.isCorrect ? 1 : 0 },
          { name: "displayOrder", type: TYPES.Int, value: j + 1 },
        ]
      );
    }
  }
}

async function hydrateMissingChoiceOptions(questions = []) {
  if (!Array.isArray(questions) || !questions.length) return questions;
  for (const question of questions) {
    const qType = normalizeQuestionType(question?.questionType);
    if (qType !== "MCQ" && qType !== "TRUE_FALSE") continue;
    if (Array.isArray(question.options) && question.options.length > 0) continue;
    const questionId = Number(question?.questionId || 0);
    if (!questionId) continue;
    const opts = await execQuery(
      "SELECT ChoiceId, ChoiceText, IsCorrect, DisplayOrder FROM dbo.QuizChoice WHERE QuestionId = @qid ORDER BY DisplayOrder, ChoiceId",
      [{ name: "qid", type: TYPES.Int, value: questionId }]
    );
    question.options = withOptionLabels(
      normalizeChoiceList(
        qType,
        (opts.rows || []).map((o, i) => ({
          optionId: o.ChoiceId,
          label: ["A", "B", "C", "D", "E", "F"][i] || String(i + 1),
          text: o.ChoiceText,
          isCorrect: !!o.IsCorrect,
        }))
      )
    );
  }
  return questions;
}

async function getManagerReviewContext(managerId, quizId) {
  const scoped = await getQuizScopeForManager(managerId, quizId);
  if (!scoped) return null;

  const sourceQuizId = scoped.ParentQuizId ? Number(scoped.ParentQuizId) : Number(scoped.QuizId);
  const sourceQuiz = await getQuizScopeForManager(managerId, sourceQuizId);
  if (!sourceQuiz) return null;

  let workingQuiz = scoped.ParentQuizId ? scoped : null;
  const needsManagerReview =
    !!sourceQuiz.RequiresTeacherReview || isAiSource(sourceQuiz.SourceType);

  if (!workingQuiz && needsManagerReview) {
    const fallbackDisclaimer = sourceQuiz.DisclaimerId
      ? null
      : await getActiveDisclaimerByType(isAiSource(sourceQuiz.SourceType) ? "AI" : "MANUAL");
    const disclaimerId = Number(sourceQuiz.DisclaimerId || fallbackDisclaimer?.DisclaimerId || 0) || null;
    if (!disclaimerId) {
      throw new Error("Unable to create teacher review draft because no active disclaimer is configured.");
    }

    const resolved = await execQuery(
      `SET XACT_ABORT ON;
       SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
       BEGIN TRAN;
         DECLARE @workingQuizId INT = NULL;
         DECLARE @wasCreated BIT = 0;

         SELECT TOP 1 @workingQuizId = q.QuizId
         FROM dbo.Quiz q WITH (UPDLOCK, HOLDLOCK)
         OUTER APPLY (
           SELECT COUNT(1) AS QuestionCount
           FROM dbo.QuizQuestion qq
           WHERE qq.QuizId = q.QuizId
         ) qc
         WHERE q.ParentQuizId = @parentQuizId
         ORDER BY
           CASE WHEN q.Status = 'Draft' THEN 0 ELSE 1 END,
           CASE WHEN ISNULL(qc.QuestionCount, 0) > 0 THEN 0 ELSE 1 END,
           q.QuizId DESC;

         IF @workingQuizId IS NULL
         BEGIN
           INSERT INTO dbo.Quiz
             (TeacherId, ClassId, Title, Topic, Difficulty, SourceType, Status, ParentQuizId, IsTeacherEdited, RequiresTeacherReview, TeacherReviewed, DisclaimerId, AttemptLimit, TimeLimitMinutes)
           VALUES
             (@managerId, @classId, @title, @topic, @difficulty, @sourceType, 'Draft', @parentQuizId, 1, 1, 0, @disclaimerId, @attemptLimit, @timeLimitMinutes);
           SET @workingQuizId = SCOPE_IDENTITY();
           SET @wasCreated = 1;
         END

         SELECT TOP 1
           q.QuizId, q.ClassId, q.TeacherId, q.Title, q.Topic, q.Difficulty, q.SourceType, q.Status, q.ParentQuizId,
           q.IsTeacherEdited, q.RequiresTeacherReview, q.TeacherReviewed, q.TeacherReviewedByTeacherId, q.TeacherReviewedAtUtc,
           q.DisclaimerId, q.AttemptLimit, q.TimeLimitMinutes,
           ISNULL(qc.QuestionCount, 0) AS QuestionCount,
           @wasCreated AS WasCreated
         FROM dbo.Quiz q
         OUTER APPLY (
           SELECT COUNT(1) AS QuestionCount
           FROM dbo.QuizQuestion qq
           WHERE qq.QuizId = q.QuizId
         ) qc
         WHERE q.QuizId = @workingQuizId;
       COMMIT;`,
      [
        { name: "managerId", type: TYPES.Int, value: managerId },
        { name: "classId", type: TYPES.Int, value: sourceQuiz.ClassId },
        { name: "title", type: TYPES.NVarChar, value: sourceQuiz.Title },
        { name: "topic", type: TYPES.NVarChar, value: sourceQuiz.Topic || null },
        { name: "difficulty", type: TYPES.NVarChar, value: sourceQuiz.Difficulty || null },
        { name: "sourceType", type: TYPES.NVarChar, value: sourceQuiz.SourceType || "AI_Topic" },
        { name: "parentQuizId", type: TYPES.Int, value: sourceQuizId },
        { name: "disclaimerId", type: TYPES.Int, value: disclaimerId },
        { name: "attemptLimit", type: TYPES.Int, value: Number(sourceQuiz.AttemptLimit || 1) || 1 },
        { name: "timeLimitMinutes", type: TYPES.Int, value: Number(sourceQuiz.TimeLimitMinutes || 0) || 0 },
      ]
    );
    workingQuiz = resolved.rows[0];

    const shouldHydrateFromSource =
      Number(workingQuiz?.WasCreated || 0) === 1 || Number(workingQuiz?.QuestionCount || 0) === 0;
    if (shouldHydrateFromSource) {
      const sourceContent = await loadQuizContent(sourceQuizId);
      const sourceQuestions = sourceContent?.questions || [];
      if (sourceQuestions.length > 0) {
        await replaceQuizContent(workingQuiz.QuizId, managerId, sourceQuestions, { useStoredProc: false });
        await execQuery(
          `INSERT INTO dbo.QuizChangeLog (TeacherId, QuizId, FieldName, ActionType, OldValue, NewValue)
           VALUES (@managerId, @quizId, @fieldName, @actionType, @oldValue, @newValue)`,
          [
            { name: "managerId", type: TYPES.Int, value: managerId },
            { name: "quizId", type: TYPES.Int, value: workingQuiz.QuizId },
            { name: "fieldName", type: TYPES.NVarChar, value: Number(workingQuiz?.WasCreated || 0) === 1 ? "ReviewCloneCreated" : "ReviewCloneRepaired" },
            { name: "actionType", type: TYPES.NVarChar, value: "ManagerEdit" },
            { name: "oldValue", type: TYPES.NVarChar, value: null },
            { name: "newValue", type: TYPES.NVarChar, value: `Synced from original AI quiz ${sourceQuizId}` },
          ]
        );
      }
    }
  }

  const activeQuizId = Number((workingQuiz || sourceQuiz).QuizId);
  const original = await loadQuizContent(sourceQuizId);
  const working = await loadQuizContent(activeQuizId);
  const logs = await execQuery(
    `SELECT TOP 100 LogId, TeacherId, QuizId, QuestionId, FieldName, ActionType, OldValue, NewValue, LoggedAtUtc
     FROM dbo.QuizChangeLog
     WHERE QuizId = @quizId
     ORDER BY LoggedAtUtc DESC, LogId DESC`,
    [{ name: "quizId", type: TYPES.Int, value: activeQuizId }]
  );

  return {
    sourceQuizId,
    workingQuizId: activeQuizId,
    needsManagerReview,
    original,
    working,
    changeLog: logs.rows.map((r) => ({
      logId: r.LogId,
      managerId: r.TeacherId,
      quizId: r.QuizId,
      questionId: r.QuestionId || null,
      fieldName: r.FieldName || "",
      actionType: r.ActionType || "",
      oldValue: r.OldValue || "",
      newValue: r.NewValue || "",
      loggedAtUtc: r.LoggedAtUtc || null,
    })),
  };
}

/** GET /api/classes/:classId/quizzes - list all quizzes in class (Draft + Published) */
router.get("/classes/:classId/quizzes", async (req, res) => {
  const classIdNum = parseInt(req.params.classId, 10);
  const owner = await canAccessClass(req, classIdNum);
  if (!owner) return res.status(404).json({ message: "Class not found" });
  const q = await execQuery(
    `SELECT QuizId, ClassId, Title, Topic, Status, CreateDate, LastModifiedDate,
            ISNULL(AttemptLimit, 1) AS AttemptLimit,
            ISNULL(TimeLimitMinutes, 0) AS TimeLimitMinutes,
            ISNULL(RequiresTeacherReview, 0) AS RequiresTeacherReview,
            ISNULL(TeacherReviewed, 0) AS TeacherReviewed,
            ISNULL(IsTeacherEdited, 0) AS IsTeacherEdited
     FROM dbo.Quiz
     WHERE ClassId = @classId
       AND (
         @role = 'Manager'
         OR (
           Status = 'Ready'
           AND (ISNULL(RequiresTeacherReview, 0) = 0 OR ISNULL(TeacherReviewed, 0) = 1)
         )
       )
     ORDER BY Title`,
    [
      { name: "classId", type: TYPES.Int, value: classIdNum },
      { name: "role", type: TYPES.NVarChar, value: req.user.role },
    ]
  );
  res.json({
    quizzes: q.rows.map((r) => ({
      quizId: r.QuizId,
      classId: r.ClassId,
      title: r.Title,
      description: r.Topic,
      status: r.Status,
      attemptLimit: Number(r.AttemptLimit || 1),
      timeLimitMinutes: Number(r.TimeLimitMinutes || 0),
      requiresTeacherReview: !!r.RequiresTeacherReview,
      teacherReviewed: !!r.TeacherReviewed,
      isTeacherEdited: !!r.IsTeacherEdited,
      requiresManagerReview: !!r.RequiresTeacherReview,
      managerReviewed: !!r.TeacherReviewed,
      isManagerEdited: !!r.IsTeacherEdited,
      createDate: r.CreateDate || null,
      lastModifiedDate: r.LastModifiedDate || null,
      createdAtUtc: r.CreateDate || null,
    })),
  });
});

const CreateQuizBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  assessmentType: z.enum(["QUIZ", "ASSIGNMENT"]).optional(),
  disclaimerAcknowledged: z.boolean().optional(),
  disclaimerId: z.number().int().positive().optional(),
  attemptLimit: z.number().int().min(1).max(5).optional(),
  timeLimitMinutes: z.number().int().min(0).max(300).optional(),
  revealAnswersAfterSubmit: z.boolean().optional(),
  mcqCount: z.number().int().min(0).max(25).optional(),
  mcqDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  shortCount: z.number().int().min(0).max(25).optional(),
  shortDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  trueFalseCount: z.number().int().min(0).max(25).optional(),
  trueFalseDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  mixMatchCount: z.number().int().min(0).max(25).optional(),
  mixMatchDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  longCount: z.number().int().min(0).max(5).optional(),
  longDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
});

const UpdateQuizAssignmentsBody = z.object({
  studentIds: z.array(z.number().int().positive()).max(200),
});

const UpdateQuestionVisibilityBody = z.object({
  isHiddenForStudent: z.boolean(),
});

/** POST /api/classes/:classId/quizzes - Class owner can create draft quiz. */
router.post("/classes/:classId/quizzes", async (req, res) => {
  try {
    const { classId } = req.params;
    const body = CreateQuizBody.parse(req.body);
    if (!body.disclaimerAcknowledged) {
      return res.status(400).json({ message: "Disclaimer must be acknowledged before creating the quiz." });
    }
    if (!body.disclaimerId) {
      return res.status(400).json({ message: "Disclaimer selection is required." });
    }
    const disclaimer = await execQuery(
      `SELECT DisclaimerId
       FROM dbo.Disclaimer
       WHERE DisclaimerId = @disclaimerId
         AND DisclaimerType = 'MANUAL'
         AND IsActive = 1`,
      [{ name: "disclaimerId", type: TYPES.Int, value: body.disclaimerId }]
    );
    if (!disclaimer.rows.length) {
      return res.status(400).json({ message: "Invalid manual disclaimer selected." });
    }
    const classIdNum = parseInt(classId, 10);
    const createPolicyError = validateEducationalQuizEntry({
      quizTitle: body.title,
      topic: body.description || null,
      questionText: null,
      explanation: null,
      options: [],
    });
    if (createPolicyError) {
      return res.status(400).json({ message: `${createPolicyError} Educational content only.` });
    }
    const owner = await canAccessClass(req, classIdNum);
    if (!owner) return res.status(403).json({ message: "Forbidden" });

    const classOwner = await execQuery(
      "SELECT StudentId, TeacherId FROM dbo.Class WHERE ClassId = @classId",
      [{ name: "classId", type: TYPES.Int, value: classIdNum }]
    );
    const targetStudentId = classOwner.rows[0]?.StudentId;
    const targetTeacherId = classOwner.rows[0]?.TeacherId ?? null;
    if (!targetStudentId) return res.status(404).json({ message: "Class not found" });
    const actorRole = String(req.user.displayRole || req.user.role || "").toUpperCase();
    const isTeacherActor = actorRole === "TEACHER" || actorRole === "MANAGER";
    if (isTeacherActor) {
      await assertManagerCanCreateQuiz(req.user.userId, 1);
    } else {
      await assertStudentCanCreateQuiz(targetStudentId, 1);
    }

    const assessmentType = normalizeAssessmentType(body.assessmentType || "QUIZ");
    const hasRevealAnswersColumn = await hasQuizRevealAnswersAfterSubmitColumn();
    const inserted = await execQuery(
      (await hasQuizAssessmentTypeColumn())
        ? `INSERT INTO dbo.Quiz (TeacherId, ClassId, Title, Topic, SourceType, AssessmentType, Status, DisclaimerId, AttemptLimit, TimeLimitMinutes${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""})
           OUTPUT INSERTED.QuizId, INSERTED.Title, INSERTED.Topic, INSERTED.Status, INSERTED.AttemptLimit, INSERTED.TimeLimitMinutes, INSERTED.AssessmentType
           VALUES (@managerId, @classId, @title, @topic, 'Manual', @assessmentType, 'Draft', @disclaimerId, @attemptLimit, @timeLimitMinutes${hasRevealAnswersColumn ? ", @revealAnswersAfterSubmit" : ""})`
        : `INSERT INTO dbo.Quiz (TeacherId, ClassId, Title, Topic, SourceType, Status, DisclaimerId, AttemptLimit, TimeLimitMinutes${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""})
           OUTPUT INSERTED.QuizId, INSERTED.Title, INSERTED.Topic, INSERTED.Status, INSERTED.AttemptLimit, INSERTED.TimeLimitMinutes
           VALUES (@managerId, @classId, @title, @topic, 'Manual', 'Draft', @disclaimerId, @attemptLimit, @timeLimitMinutes${hasRevealAnswersColumn ? ", @revealAnswersAfterSubmit" : ""})`,
      [
        { name: "managerId", type: TYPES.Int, value: targetTeacherId },
        { name: "classId", type: TYPES.Int, value: classIdNum },
        { name: "title", type: TYPES.NVarChar, value: body.title },
        { name: "topic", type: TYPES.NVarChar, value: body.description || null },
        { name: "assessmentType", type: TYPES.NVarChar, value: assessmentType },
        { name: "disclaimerId", type: TYPES.Int, value: body.disclaimerId },
        { name: "attemptLimit", type: TYPES.Int, value: body.attemptLimit || 1 },
        { name: "timeLimitMinutes", type: TYPES.Int, value: normalizeTimeLimitMinutes(body.timeLimitMinutes || 0) },
        ...(hasRevealAnswersColumn
          ? [{ name: "revealAnswersAfterSubmit", type: TYPES.Bit, value: body.revealAnswersAfterSubmit ? 1 : 0 }]
          : []),
      ]
    );
    const row = inserted.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to create quiz" });

    const mcqCount = Math.max(0, Math.min(25, Number(body.mcqCount || 0)));
    const shortCount = Math.max(0, Math.min(25, Number(body.shortCount || 0)));
    const trueFalseCount = Math.max(0, Math.min(25, Number(body.trueFalseCount || 0)));
    const mixMatchCount = Math.max(0, Math.min(25, Number(body.mixMatchCount || 0)));
    const longCount = Math.max(0, Math.min(5, Number(body.longCount || 0)));
    const totalSeededQuestions = mcqCount + shortCount + trueFalseCount + mixMatchCount + longCount;
    if (totalSeededQuestions > 25) {
      return res.status(400).json({ message: "Maximum number of questions for manual quiz is 25." });
    }
    let displayOrder = 1;
    for (let i = 0; i < mcqCount; i++) {
      const qInsert = await execQuery(
        `INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, QuestionType, DisplayOrder)
         OUTPUT INSERTED.QuestionId
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, 'MCQ', @displayOrder)`,
        [
          { name: "teacherId", type: TYPES.Int, value: targetTeacherId },
          { name: "quizId", type: TYPES.Int, value: row.QuizId },
          { name: "questionText", type: TYPES.NVarChar, value: `MCQ ${i + 1} (${body.mcqDifficulty || "Medium"}) - Enter question text` },
          { name: "explanation", type: TYPES.NVarChar, value: null },
          { name: "displayOrder", type: TYPES.Int, value: displayOrder++ },
        ]
      );
      const questionId = qInsert.rows[0]?.QuestionId;
      if (!questionId) continue;
      const defaultOptions = ["Option A", "Option B", "Option C", "Option D"];
      for (let j = 0; j < defaultOptions.length; j++) {
        await execQuery(
          `INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES (@teacherId, @questionId, @choiceText, @isCorrect, @displayOrder)`,
          [
            { name: "teacherId", type: TYPES.Int, value: targetTeacherId },
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "choiceText", type: TYPES.NVarChar, value: defaultOptions[j] },
            { name: "isCorrect", type: TYPES.Bit, value: j === 0 ? 1 : 0 },
            { name: "displayOrder", type: TYPES.Int, value: j + 1 },
          ]
        );
      }
    }

    for (let i = 0; i < shortCount; i++) {
      await execQuery(
        `INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, QuestionType, ExpectedAnswerText, AnswerMatchMode, DisplayOrder)
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, 'SHORT_TEXT', @expectedAnswerText, 'EXACT', @displayOrder)`,
        [
          { name: "teacherId", type: TYPES.Int, value: targetTeacherId },
          { name: "quizId", type: TYPES.Int, value: row.QuizId },
          { name: "questionText", type: TYPES.NVarChar, value: `Short Question ${i + 1} (${body.shortDifficulty || "Medium"}) - Enter question text` },
          { name: "explanation", type: TYPES.NVarChar, value: null },
          { name: "expectedAnswerText", type: TYPES.NVarChar, value: "Sample answer" },
          { name: "displayOrder", type: TYPES.Int, value: displayOrder++ },
        ]
      );
    }

    for (let i = 0; i < trueFalseCount; i++) {
      const qInsert = await execQuery(
        `INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, QuestionType, DisplayOrder)
         OUTPUT INSERTED.QuestionId
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, 'TRUE_FALSE', @displayOrder)`,
        [
          { name: "teacherId", type: TYPES.Int, value: targetTeacherId },
          { name: "quizId", type: TYPES.Int, value: row.QuizId },
          { name: "questionText", type: TYPES.NVarChar, value: `True/False ${i + 1} (${body.trueFalseDifficulty || "Medium"}) - Enter statement` },
          { name: "explanation", type: TYPES.NVarChar, value: null },
          { name: "displayOrder", type: TYPES.Int, value: displayOrder++ },
        ]
      );
      const questionId = qInsert.rows[0]?.QuestionId;
      if (!questionId) continue;
      const tfOptions = ["True", "False"];
      for (let j = 0; j < tfOptions.length; j++) {
        await execQuery(
          `INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES (@teacherId, @questionId, @choiceText, @isCorrect, @displayOrder)`,
          [
            { name: "teacherId", type: TYPES.Int, value: targetTeacherId },
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "choiceText", type: TYPES.NVarChar, value: tfOptions[j] },
            { name: "isCorrect", type: TYPES.Bit, value: j === 0 ? 1 : 0 },
            { name: "displayOrder", type: TYPES.Int, value: j + 1 },
          ]
        );
      }
    }

    for (let i = 0; i < mixMatchCount; i++) {
      const qInsert = await execQuery(
        `INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, QuestionType, DisplayOrder, Points, ShuffleLeft, ShuffleRight, AllowPartialMarks)
         OUTPUT INSERTED.QuestionId
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, 'MIX_MATCH_DRAG', @displayOrder, @points, 0, 1, 1)`,
        [
          { name: "teacherId", type: TYPES.Int, value: targetTeacherId },
          { name: "quizId", type: TYPES.Int, value: row.QuizId },
          { name: "questionText", type: TYPES.NVarChar, value: `Mix Match ${i + 1} (${body.mixMatchDifficulty || "Medium"}) - Enter question text` },
          { name: "explanation", type: TYPES.NVarChar, value: null },
          { name: "displayOrder", type: TYPES.Int, value: displayOrder++ },
          { name: "points", type: TYPES.Int, value: 1 },
        ]
      );
      const questionId = qInsert.rows[0]?.QuestionId;
      if (!questionId) continue;
      const starterPairs = [
        { leftText: "Left item 1", rightText: "Right item 1" },
        { leftText: "Left item 2", rightText: "Right item 2" },
      ];
      for (let j = 0; j < starterPairs.length; j++) {
        await execQuery(
          `INSERT INTO dbo.MatchPair (QuestionId, LeftText, RightText, DisplayOrder, IsActive, UpdatedDate)
           VALUES (@questionId, @leftText, @rightText, @displayOrder, 1, NULL)`,
          [
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "leftText", type: TYPES.NVarChar, value: starterPairs[j].leftText },
            { name: "rightText", type: TYPES.NVarChar, value: starterPairs[j].rightText },
            { name: "displayOrder", type: TYPES.Int, value: j },
          ]
        );
      }
    }

    for (let i = 0; i < longCount; i++) {
      await execQuery(
        `INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, QuestionType, DisplayOrder, Points)
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, 'LONG', @displayOrder, @points)`,
        [
          { name: "teacherId", type: TYPES.Int, value: targetTeacherId },
          { name: "quizId", type: TYPES.Int, value: row.QuizId },
          { name: "questionText", type: TYPES.NVarChar, value: `Long Question ${i + 1} (${body.longDifficulty || "Medium"}) - Enter question text` },
          { name: "explanation", type: TYPES.NVarChar, value: null },
          { name: "displayOrder", type: TYPES.Int, value: displayOrder++ },
          { name: "points", type: TYPES.Int, value: 10 },
        ]
      );
    }

    res.status(201).json({
      quizId: row.QuizId,
      title: row.Title,
      description: row.Topic,
      status: row.Status,
      assessmentType,
      attemptLimit: Number(row.AttemptLimit || 1),
      timeLimitMinutes: Number(row.TimeLimitMinutes || 0),
      questionCount: totalSeededQuestions,
    });
    logUsageEventByActor({
      role: req.user.role,
      userId: req.user.userId,
      eventType: "QUIZ_CREATED",
      quantity: 1,
    }).catch(() => {});
    if (totalSeededQuestions > 0) {
      logUsageEventByActor({
        role: req.user.role,
        userId: req.user.userId,
        eventType: "MANUAL_QUESTION",
        quantity: totalSeededQuestions,
      }).catch(() => {});
    }
  } catch (e) {
    if (e instanceof PaymentRequiredError) {
      return res.status(402).json({ message: e.message, paymentRequired: true, redirectTo: "/pricing" });
    }
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Failed to create quiz", detail: e.message });
  }
});

const UpdateQuizBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  timeLimitMinutes: z.number().int().min(0).max(300).optional(),
  assessmentType: z.enum(["QUIZ", "ASSIGNMENT"]).optional(),
  revealAnswersAfterSubmit: z.boolean().optional(),
  headerExtraLines: z.array(
    z.object({
      text: z.string().max(200),
      showOnHeader: z.boolean().optional(),
    })
  ).max(20).optional(),
});

/** PUT /api/quizzes/:quizId - Update draft quiz (any class member). */
router.put("/quizzes/:quizId", async (req, res) => {
  const { quizId } = req.params;
  const body = UpdateQuizBody.parse(req.body);
  const quizIdNum = parseInt(quizId, 10);
  const hasHeaderExtraLinesColumn = await hasQuizHeaderExtraLinesColumn();
  const hasAssessmentTypeColumn = await hasQuizAssessmentTypeColumn();
  const hasRevealAnswersColumn = await hasQuizRevealAnswersAfterSubmitColumn();
  const quiz = await execQuery(
    "SELECT QuizId, Status, ClassId, TeacherId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft" && body.timeLimitMinutes === undefined) {
    return res.status(400).json({ message: "Only draft quizzes can be edited" });
  }
  const updatePolicyError = validateEducationalQuizEntry({
    quizTitle: body.title || null,
    topic: body.description || null,
    questionText: null,
    explanation: null,
    options: [],
  });
  if (updatePolicyError) {
    return res.status(400).json({ message: `${updatePolicyError} Educational content only.` });
  }
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });
  if (body.title != null) {
    await execQuery("UPDATE dbo.Quiz SET Title = @title WHERE QuizId = @quizId", [
      { name: "title", type: TYPES.NVarChar, value: body.title },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  if (body.description !== undefined) {
    await execQuery("UPDATE dbo.Quiz SET Topic = @topic WHERE QuizId = @quizId", [
      { name: "topic", type: TYPES.NVarChar, value: body.description || null },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  if (body.timeLimitMinutes !== undefined) {
    await execQuery("UPDATE dbo.Quiz SET TimeLimitMinutes = @timeLimitMinutes WHERE QuizId = @quizId", [
      { name: "timeLimitMinutes", type: TYPES.Int, value: normalizeTimeLimitMinutes(body.timeLimitMinutes) },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  if (hasAssessmentTypeColumn && body.assessmentType !== undefined) {
    await execQuery("UPDATE dbo.Quiz SET AssessmentType = @assessmentType WHERE QuizId = @quizId", [
      { name: "assessmentType", type: TYPES.NVarChar, value: normalizeAssessmentType(body.assessmentType) },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  if (hasRevealAnswersColumn && body.revealAnswersAfterSubmit !== undefined) {
    await execQuery("UPDATE dbo.Quiz SET RevealAnswersAfterSubmit = @revealAnswersAfterSubmit WHERE QuizId = @quizId", [
      { name: "revealAnswersAfterSubmit", type: TYPES.Bit, value: body.revealAnswersAfterSubmit ? 1 : 0 },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  if (hasHeaderExtraLinesColumn && body.headerExtraLines !== undefined) {
    const normalizedHeaderExtraLines = normalizeQuizHeaderExtraLines(body.headerExtraLines);
    await execQuery("UPDATE dbo.Quiz SET HeaderExtraLinesJson = @headerExtraLinesJson WHERE QuizId = @quizId", [
      {
        name: "headerExtraLinesJson",
        type: TYPES.NVarChar,
        value: normalizedHeaderExtraLines.length ? JSON.stringify(normalizedHeaderExtraLines) : null,
      },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  const updated = await execQuery(
    hasHeaderExtraLinesColumn
      ? `SELECT QuizId, Title, Topic, Status, ISNULL(TimeLimitMinutes, 0) AS TimeLimitMinutes${hasAssessmentTypeColumn ? ", AssessmentType" : ""}${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""}, HeaderExtraLinesJson FROM dbo.Quiz WHERE QuizId = @quizId`
      : `SELECT QuizId, Title, Topic, Status, ISNULL(TimeLimitMinutes, 0) AS TimeLimitMinutes${hasAssessmentTypeColumn ? ", AssessmentType" : ""}${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""} FROM dbo.Quiz WHERE QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  const row = updated.rows[0];
  res.json({
    quizId: row.QuizId,
    title: row.Title,
    description: row.Topic,
    status: row.Status,
    assessmentType: normalizeAssessmentType(row.AssessmentType),
    timeLimitMinutes: Number(row.TimeLimitMinutes || 0),
    revealAnswersAfterSubmit: !!row.RevealAnswersAfterSubmit,
    headerExtraLines: parseQuizHeaderExtraLines(row.HeaderExtraLinesJson || null),
  });
});

const UpdateQuizTimeLimitBody = z.object({
  timeLimitMinutes: z.number().int().min(0).max(300),
});

const PublishQuizBody = z
  .object({
    publishNow: z.boolean().optional(),
    publishStartUtc: z.string().datetime().optional().nullable(),
    publishEndUtc: z.string().datetime().optional().nullable(),
  })
  .optional();

/** PUT /api/quizzes/:quizId/time-limit - update quiz countdown time in minutes (0 disables timer) */
router.put("/quizzes/:quizId/time-limit", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });
  const body = UpdateQuizTimeLimitBody.parse(req.body);
  const quiz = await execQuery(
    "SELECT QuizId, ClassId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });
  await execQuery(
    "UPDATE dbo.Quiz SET TimeLimitMinutes = @timeLimitMinutes WHERE QuizId = @quizId",
    [
      { name: "timeLimitMinutes", type: TYPES.Int, value: normalizeTimeLimitMinutes(body.timeLimitMinutes) },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]
  );
  return res.json({ quizId: quizIdNum, timeLimitMinutes: normalizeTimeLimitMinutes(body.timeLimitMinutes) });
});

/** POST /api/quizzes/:quizId/publish - Any class member can publish. */
router.post("/quizzes/:quizId/publish", async (req, res) => {
  const payload = PublishQuizBody.parse(req.body || {});
  const quizIdNum = parseInt(req.params.quizId, 10);
  const quiz = await execQuery(
    `SELECT QuizId, Status, ClassId,
            ISNULL(RequiresTeacherReview, 0) AS RequiresTeacherReview,
            ISNULL(TeacherReviewed, 0) AS TeacherReviewed
     FROM dbo.Quiz WHERE QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });

  const questionCount = await execQuery(
    "SELECT COUNT(1) AS Cnt FROM dbo.QuizQuestion WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  const totalQuestions = Number(questionCount.rows[0]?.Cnt || 0);
  if (totalQuestions < 1) {
    return res.status(400).json({ message: "Cannot publish an empty quiz. Add at least one question." });
  }

  if (quiz.rows[0].RequiresTeacherReview && !quiz.rows[0].TeacherReviewed) {
    return res.status(400).json({
      message: "This AI quiz requires teacher review approval before publish. Use teacher review publish.",
    });
  }

  let schedule;
  try {
    schedule = parsePublishScheduleBody(payload || {});
  } catch (error) {
    return res.status(400).json({ message: error.message || "Invalid publish schedule." });
  }

  const hasScheduleColumns = await hasQuizPublishScheduleColumns();

  await execQuery(
    hasScheduleColumns
      ? `UPDATE dbo.Quiz
         SET Status = 'Ready',
             PublishStartUtc = @publishStartUtc,
             PublishEndUtc = @publishEndUtc
         WHERE QuizId = @quizId`
      : "UPDATE dbo.Quiz SET Status = 'Ready' WHERE QuizId = @quizId",
    hasScheduleColumns
      ? [
          { name: "publishStartUtc", type: TYPES.DateTime2, value: schedule.publishStartUtc ? new Date(schedule.publishStartUtc) : null },
          { name: "publishEndUtc", type: TYPES.DateTime2, value: schedule.publishEndUtc ? new Date(schedule.publishEndUtc) : null },
          { name: "quizId", type: TYPES.Int, value: quizIdNum },
        ]
      : [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  res.json({
    quizId: quizIdNum,
    status: "Ready",
    publishNow: schedule.publishNow,
    publishStartUtc: schedule.publishStartUtc,
    publishEndUtc: schedule.publishEndUtc,
  });
});

/** POST /api/quizzes/:quizId/new-draft - manager can clone any quiz into a new draft. */
router.post("/quizzes/:quizId/new-draft", async (req, res) => {
  if (req.user.role !== "Manager") {
    return res.status(403).json({ message: "Only teacher can create a new draft." });
  }

  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) {
    return res.status(400).json({ message: "Invalid quiz id" });
  }

  const hasAssessmentTypeColumn = await hasQuizAssessmentTypeColumn();
  const hasHeaderExtraLinesColumn = await hasQuizHeaderExtraLinesColumn();
  const hasRevealAnswersColumn = await hasQuizRevealAnswersAfterSubmitColumn();
  const source = await execQuery(
    hasHeaderExtraLinesColumn
      ? `SELECT QuizId, ClassId, TeacherId, Title, Topic, Difficulty, SourceType, Status, ParentQuizId,
                DisclaimerId, AttemptLimit, TimeLimitMinutes${hasAssessmentTypeColumn ? ", AssessmentType" : ""}${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""},
                HeaderExtraLinesJson
         FROM dbo.Quiz
         WHERE QuizId = @quizId`
      : `SELECT QuizId, ClassId, TeacherId, Title, Topic, Difficulty, SourceType, Status, ParentQuizId,
                DisclaimerId, AttemptLimit, TimeLimitMinutes${hasAssessmentTypeColumn ? ", AssessmentType" : ""}${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""}
         FROM dbo.Quiz
         WHERE QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!source.rows.length) {
    return res.status(404).json({ message: "Quiz not found" });
  }

  const sourceQuiz = source.rows[0];
  const owner = await canAccessClass(req, sourceQuiz.ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });

  const sourceQuizId = Number(sourceQuiz.QuizId);
  const parentQuizId = Number(sourceQuiz.ParentQuizId || sourceQuizId) || sourceQuizId;
  const fallbackDisclaimer = sourceQuiz.DisclaimerId
    ? null
    : await getActiveDisclaimerByType(isAiSource(sourceQuiz.SourceType) ? "AI" : "MANUAL");
  const disclaimerId = Number(sourceQuiz.DisclaimerId || fallbackDisclaimer?.DisclaimerId || 0) || null;
  if (!disclaimerId) {
    return res.status(400).json({ message: "No active disclaimer is configured for this quiz type." });
  }

  const insertResult = await execQuery(
    hasHeaderExtraLinesColumn
      ? `INSERT INTO dbo.Quiz
           (TeacherId, ClassId, Title, Topic, Difficulty, SourceType${hasAssessmentTypeColumn ? ", AssessmentType" : ""},
            Status, ParentQuizId, DisclaimerId, AttemptLimit, TimeLimitMinutes${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""}, HeaderExtraLinesJson)
         OUTPUT INSERTED.QuizId
         VALUES
           (@teacherId, @classId, @title, @topic, @difficulty, @sourceType${hasAssessmentTypeColumn ? ", @assessmentType" : ""},
            'Draft', @parentQuizId, @disclaimerId, @attemptLimit, @timeLimitMinutes${hasRevealAnswersColumn ? ", @revealAnswersAfterSubmit" : ""}, @headerExtraLinesJson)`
      : `INSERT INTO dbo.Quiz
           (TeacherId, ClassId, Title, Topic, Difficulty, SourceType${hasAssessmentTypeColumn ? ", AssessmentType" : ""},
            Status, ParentQuizId, DisclaimerId, AttemptLimit, TimeLimitMinutes${hasRevealAnswersColumn ? ", RevealAnswersAfterSubmit" : ""})
         OUTPUT INSERTED.QuizId
         VALUES
           (@teacherId, @classId, @title, @topic, @difficulty, @sourceType${hasAssessmentTypeColumn ? ", @assessmentType" : ""},
            'Draft', @parentQuizId, @disclaimerId, @attemptLimit, @timeLimitMinutes${hasRevealAnswersColumn ? ", @revealAnswersAfterSubmit" : ""})`,
    [
      { name: "teacherId", type: TYPES.Int, value: Number(sourceQuiz.TeacherId || req.user.userId) },
      { name: "classId", type: TYPES.Int, value: Number(sourceQuiz.ClassId) },
      { name: "title", type: TYPES.NVarChar, value: String(sourceQuiz.Title || "Untitled Quiz").trim() || "Untitled Quiz" },
      { name: "topic", type: TYPES.NVarChar, value: sourceQuiz.Topic || null },
      { name: "difficulty", type: TYPES.NVarChar, value: sourceQuiz.Difficulty || null },
      { name: "sourceType", type: TYPES.NVarChar, value: sourceQuiz.SourceType || "AI_Topic" },
      ...(hasAssessmentTypeColumn
        ? [{ name: "assessmentType", type: TYPES.NVarChar, value: normalizeAssessmentType(sourceQuiz.AssessmentType) }]
        : []),
      { name: "parentQuizId", type: TYPES.Int, value: parentQuizId },
      { name: "disclaimerId", type: TYPES.Int, value: disclaimerId },
      { name: "attemptLimit", type: TYPES.Int, value: Number(sourceQuiz.AttemptLimit || 1) || 1 },
      { name: "timeLimitMinutes", type: TYPES.Int, value: normalizeTimeLimitMinutes(sourceQuiz.TimeLimitMinutes) },
      ...(hasRevealAnswersColumn
        ? [{ name: "revealAnswersAfterSubmit", type: TYPES.Bit, value: sourceQuiz.RevealAnswersAfterSubmit ? 1 : 0 }]
        : []),
      ...(hasHeaderExtraLinesColumn
        ? [{ name: "headerExtraLinesJson", type: TYPES.NVarChar, value: sourceQuiz.HeaderExtraLinesJson || null }]
        : []),
    ]
  );

  const newQuizId = Number(insertResult.rows?.[0]?.QuizId || 0);
  if (!newQuizId) {
    return res.status(500).json({ message: "Failed to create draft quiz." });
  }

  const sourceContent = await loadQuizContent(sourceQuizId);
  await replaceQuizContent(newQuizId, req.user.userId, sourceContent?.questions || [], { useStoredProc: false });

  return res.status(201).json({
    quizId: newQuizId,
    sourceQuizId,
    status: "Draft",
  });
});

const ManagerReviewSaveBody = z.object({
  questions: z.array(
    z.object({
      questionText: z.string().min(1).max(4000),
      explanation: z.string().max(3000).optional().nullable(),
      diagramType: z.enum(["none", "svg", "mermaid"]).optional().nullable(),
      diagramData: z.string().max(20000).optional().nullable(),
      questionType: z.enum(["MCQ", "SHORT_TEXT", "TRUE_FALSE", "NUMERIC", "LONG", "MIX_MATCH_DRAG"]).optional(),
      points: z.number().int().min(1).max(100).optional().nullable(),
      expectedAnswerText: z.string().max(500).optional().nullable(),
      answerMatchMode: z.enum(["EXACT", "CONTAINS", "KEYWORDS"]).optional().nullable(),
      expectedAnswerNumber: z.number().finite().optional().nullable(),
      numericTolerance: z.number().min(0).finite().optional().nullable(),
      shuffleLeft: z.boolean().optional().nullable(),
      shuffleRight: z.boolean().optional().nullable(),
      allowPartialMarks: z.boolean().optional().nullable(),
      isHiddenForStudent: z.boolean().optional(),
      pairs: z
        .array(
          z.object({
            matchPairId: z.number().int().positive().optional().nullable(),
            leftText: z.string().max(500),
            rightText: z.string().max(500),
            displayOrder: z.number().int().min(0).optional().nullable(),
            isActive: z.boolean().optional().nullable(),
          })
        )
        .max(MIX_MATCH_MAX_PAIRS)
        .optional(),
      options: z
        .array(
          z.object({
            label: z.string().max(5).optional(),
            text: z.string().min(1).max(1000),
            isCorrect: z.boolean(),
          })
        )
        .min(0)
        .max(20),
    })
  ),
});

const ManagerReviewPublishBody = z.object({
  approved: z.boolean(),
  publishNow: z.boolean().optional(),
  publishStartUtc: z.string().datetime().optional().nullable(),
  publishEndUtc: z.string().datetime().optional().nullable(),
});

/** GET /api/quizzes/:quizId/teacher-review - teacher review context (original + working version + change log) */
router.get("/quizzes/:quizId/teacher-review", async (req, res) => {
  if (req.user.role !== "Manager") {
    return res.status(403).json({ message: "Only teacher can review AI quizzes." });
  }
  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });

  const context = await getManagerReviewContext(req.user.userId, quizIdNum);
  if (!context) return res.status(404).json({ message: "Quiz not found" });
  const maxMcqsPerQuiz = await getMaxMcqsPerQuizForClass(context?.working?.classId || context?.original?.classId);

  return res.json({
    reviewMode: !!context.needsManagerReview,
    sourceQuizId: context.sourceQuizId,
    workingQuizId: context.workingQuizId,
    maxMcqsPerQuiz,
    original: context.original,
    working: context.working,
    changeLog: context.changeLog,
  });
});

/** PUT /api/quizzes/:quizId/teacher-review/content - teacher edits working reviewed quiz and logs changes */
router.put("/quizzes/:quizId/teacher-review/content", async (req, res) => {
  if (req.user.role !== "Manager") {
    return res.status(403).json({ message: "Only teacher can edit reviewed quizzes." });
  }
  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });
  const body = ManagerReviewSaveBody.parse(req.body);

  const context = await getManagerReviewContext(req.user.userId, quizIdNum);
  if (!context || !context.needsManagerReview) {
    return res.status(400).json({ message: "Quiz does not require teacher review mode." });
  }
  const maxMcqsPerQuiz = await getMaxMcqsPerQuizForClass(context?.working?.classId || context?.original?.classId);
  if (body.questions.length > maxMcqsPerQuiz) {
    return res.status(400).json({
      message: `Maximum number of MCQ's per quiz for your plan is ${maxMcqsPerQuiz}.`,
    });
  }
  const questionValidationError = validateQuestionPayload(body.questions);
  if (questionValidationError) {
    return res.status(400).json({ message: questionValidationError });
  }

  for (let i = 0; i < body.questions.length; i++) {
    const q = body.questions[i];
    const policyError = validateEducationalQuizEntry({
      quizTitle: null,
      topic: null,
      questionText: q.questionText,
      explanation: q.explanation || null,
      options: Array.isArray(q.options) ? q.options.map((o) => o.text) : [],
    });
    if (policyError) {
      return res.status(400).json({
        message: `Question ${i + 1} rejected: ${policyError} Educational content only.`,
      });
    }
  }

  const oldSnapshot = JSON.stringify(context.working?.questions || []);
  await replaceQuizContent(context.workingQuizId, req.user.userId, body.questions, { useStoredProc: false });
  const updatedWorking = await loadQuizContent(context.workingQuizId);
  const newSnapshot = JSON.stringify(updatedWorking?.questions || []);

  if (oldSnapshot !== newSnapshot) {
    await execQuery(
      `INSERT INTO dbo.QuizChangeLog (TeacherId, QuizId, FieldName, ActionType, OldValue, NewValue)
       VALUES (@managerId, @quizId, @fieldName, @actionType, @oldValue, @newValue)`,
      [
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
        { name: "quizId", type: TYPES.Int, value: context.workingQuizId },
        { name: "fieldName", type: TYPES.NVarChar, value: "QuizContent" },
        { name: "actionType", type: TYPES.NVarChar, value: "ManagerEdit" },
        { name: "oldValue", type: TYPES.NVarChar, value: oldSnapshot },
        { name: "newValue", type: TYPES.NVarChar, value: newSnapshot },
      ]
    );
  }

  await execQuery(
    `UPDATE dbo.Quiz
     SET IsTeacherEdited = 1,
         RequiresTeacherReview = 1,
         TeacherReviewed = 0,
         TeacherReviewedByTeacherId = NULL,
         TeacherReviewedAtUtc = NULL
     WHERE QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: context.workingQuizId }]
  );

  const logs = await execQuery(
    `SELECT TOP 100 LogId, TeacherId, QuizId, QuestionId, FieldName, ActionType, OldValue, NewValue, LoggedAtUtc
     FROM dbo.QuizChangeLog
     WHERE QuizId = @quizId
     ORDER BY LoggedAtUtc DESC, LogId DESC`,
    [{ name: "quizId", type: TYPES.Int, value: context.workingQuizId }]
  );

  return res.json({
    sourceQuizId: context.sourceQuizId,
    workingQuizId: context.workingQuizId,
    questionCount: updatedWorking?.questions?.length || 0,
    changeLog: logs.rows.map((r) => ({
      logId: r.LogId,
      managerId: r.TeacherId,
      quizId: r.QuizId,
      questionId: r.QuestionId || null,
      fieldName: r.FieldName || "",
      actionType: r.ActionType || "",
      oldValue: r.OldValue || "",
      newValue: r.NewValue || "",
      loggedAtUtc: r.LoggedAtUtc || null,
    })),
  });
});

/** POST /api/quizzes/:quizId/teacher-review/publish - teacher approval + publish for reviewed AI quiz */
router.post("/quizzes/:quizId/teacher-review/publish", async (req, res) => {
  if (req.user.role !== "Manager") {
    return res.status(403).json({ message: "Only teacher can publish reviewed quizzes." });
  }
  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });
  const body = ManagerReviewPublishBody.parse(req.body);
  if (!body.approved) {
    return res.status(400).json({ message: "Teacher approval checkbox is required before publish." });
  }

  const context = await getManagerReviewContext(req.user.userId, quizIdNum);
  if (!context || !context.needsManagerReview) {
    return res.status(400).json({ message: "Quiz does not require teacher review mode." });
  }

  const questionCount = await execQuery(
    "SELECT COUNT(1) AS Cnt FROM dbo.QuizQuestion WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: context.workingQuizId }]
  );
  const totalQuestions = Number(questionCount.rows[0]?.Cnt || 0);
  if (totalQuestions < 1) {
    return res.status(400).json({ message: "Cannot publish an empty quiz. Add at least one question." });
  }

  let schedule;
  try {
    schedule = parsePublishScheduleBody(body || {});
  } catch (error) {
    return res.status(400).json({ message: error.message || "Invalid publish schedule." });
  }
  const hasScheduleColumns = await hasQuizPublishScheduleColumns();

  await execQuery(
    hasScheduleColumns
      ? `UPDATE dbo.Quiz
         SET Status = 'Ready',
             IsTeacherEdited = 1,
             RequiresTeacherReview = 0,
             TeacherReviewed = 1,
             TeacherReviewedByTeacherId = @managerId,
             TeacherReviewedAtUtc = SYSUTCDATETIME(),
             PublishStartUtc = @publishStartUtc,
             PublishEndUtc = @publishEndUtc
         WHERE QuizId = @quizId`
      : `UPDATE dbo.Quiz
         SET Status = 'Ready',
             IsTeacherEdited = 1,
             RequiresTeacherReview = 0,
             TeacherReviewed = 1,
             TeacherReviewedByTeacherId = @managerId,
             TeacherReviewedAtUtc = SYSUTCDATETIME()
         WHERE QuizId = @quizId`,
    hasScheduleColumns
      ? [
          { name: "managerId", type: TYPES.Int, value: req.user.userId },
          { name: "publishStartUtc", type: TYPES.DateTime2, value: schedule.publishStartUtc ? new Date(schedule.publishStartUtc) : null },
          { name: "publishEndUtc", type: TYPES.DateTime2, value: schedule.publishEndUtc ? new Date(schedule.publishEndUtc) : null },
          { name: "quizId", type: TYPES.Int, value: context.workingQuizId },
        ]
      : [
          { name: "managerId", type: TYPES.Int, value: req.user.userId },
          { name: "quizId", type: TYPES.Int, value: context.workingQuizId },
        ]
  );

  await execQuery(
    `INSERT INTO dbo.QuizChangeLog (TeacherId, QuizId, FieldName, ActionType, OldValue, NewValue)
     VALUES (@managerId, @quizId, @fieldName, @actionType, @oldValue, @newValue)`,
    [
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
      { name: "quizId", type: TYPES.Int, value: context.workingQuizId },
      { name: "fieldName", type: TYPES.NVarChar, value: "PublishApproval" },
      { name: "actionType", type: TYPES.NVarChar, value: "ManagerPublish" },
      { name: "oldValue", type: TYPES.NVarChar, value: "Pending review" },
      { name: "newValue", type: TYPES.NVarChar, value: "Approved and published by teacher" },
    ]
  );

  return res.json({
    sourceQuizId: context.sourceQuizId,
    workingQuizId: context.workingQuizId,
    status: "Ready",
    teacherReviewed: true,
    managerReviewed: true,
    publishNow: schedule.publishNow,
    publishStartUtc: schedule.publishStartUtc,
    publishEndUtc: schedule.publishEndUtc,
  });
});

/** DELETE /api/quizzes/:quizId - Delete quiz (owner only). */
router.delete("/quizzes/:quizId", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, ClassId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });

  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });

  await execQuery(
    `SET XACT_ABORT ON;
     BEGIN TRAN;

       DECLARE @TargetQuizIds TABLE (QuizId INT PRIMARY KEY);
       ;WITH quiz_tree AS (
         SELECT QuizId
         FROM dbo.Quiz
         WHERE QuizId = @quizId
         UNION ALL
         SELECT q.QuizId
         FROM dbo.Quiz q
         JOIN quiz_tree qt ON q.ParentQuizId = qt.QuizId
       )
       INSERT INTO @TargetQuizIds (QuizId)
       SELECT DISTINCT QuizId FROM quiz_tree OPTION (MAXRECURSION 100);

       DECLARE @TargetQuestionIds TABLE (QuestionId INT PRIMARY KEY);
       INSERT INTO @TargetQuestionIds (QuestionId)
       SELECT qq.QuestionId
       FROM dbo.QuizQuestion qq
       JOIN @TargetQuizIds t ON t.QuizId = qq.QuizId;

       DECLARE @TargetAttemptIds TABLE (AttemptId INT PRIMARY KEY);
       INSERT INTO @TargetAttemptIds (AttemptId)
       SELECT qa.AttemptId
       FROM dbo.QuizAttempt qa
       JOIN @TargetQuizIds t ON t.QuizId = qa.QuizId;

       -- Clear external refs first
       UPDATE aj
       SET aj.ResultQuizId = NULL
       FROM dbo.AIGenerationJob aj
       JOIN @TargetQuizIds t ON t.QuizId = aj.ResultQuizId;

       -- Dependent rows
       DELETE qa
       FROM dbo.QuizAssignment qa
       JOIN @TargetQuizIds t ON t.QuizId = qa.QuizId;

       DELETE qd
       FROM dbo.QuizDocument qd
       JOIN @TargetQuizIds t ON t.QuizId = qd.QuizId;

       DELETE qcl
       FROM dbo.QuizChangeLog qcl
       JOIN @TargetQuizIds t ON t.QuizId = qcl.QuizId;

       DELETE lg
       FROM dbo.LongGradingJob lg
       JOIN @TargetAttemptIds a ON a.AttemptId = lg.QuizAttemptId;

       DELETE sma
       FROM dbo.StudentMatchAnswer sma
       JOIN @TargetAttemptIds a ON a.AttemptId = sma.AttemptId;

       DELETE sma2
       FROM dbo.StudentMatchAnswer sma2
       JOIN @TargetQuestionIds q ON q.QuestionId = sma2.QuestionId;

       DELETE qaa
       FROM dbo.QuizAttemptAnswer qaa
       JOIN @TargetAttemptIds a ON a.AttemptId = qaa.AttemptId;

       DELETE qa2
       FROM dbo.QuizAttempt qa2
       JOIN @TargetQuizIds t ON t.QuizId = qa2.QuizId;

       DELETE mp
       FROM dbo.MatchPair mp
       JOIN @TargetQuestionIds q ON q.QuestionId = mp.QuestionId;

       DELETE qc
       FROM dbo.QuizChoice qc
       JOIN @TargetQuestionIds q ON q.QuestionId = qc.QuestionId;

       DELETE qq2
       FROM dbo.QuizQuestion qq2
       JOIN @TargetQuizIds t ON t.QuizId = qq2.QuizId;

       DELETE q3
       FROM dbo.Quiz q3
       JOIN @TargetQuizIds t ON t.QuizId = q3.QuizId;

       SELECT COUNT(1) AS DeletedQuizCount FROM @TargetQuizIds;
     COMMIT;`,
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );

  return res.json({ message: "Quiz deleted", quizId: quizIdNum });
});

/** GET /api/quizzes/:quizId - Get quiz for editing (questions + options including isCorrect). Draft only, class member. */
router.get("/quizzes/:quizId", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const hasAssessmentTypeColumn = await hasQuizAssessmentTypeColumn();
  const hasRevealAnswersColumn = await hasQuizRevealAnswersAfterSubmitColumn();
  const classExportSettings = await loadQuizClassExportSettings(quizIdNum).catch(() => defaultClassExportSettings());
  const quiz = await execQuery(
    hasAssessmentTypeColumn
      ? `SELECT q.QuizId, q.Title, q.Topic, q.SourceType, q.AssessmentType, q.Status, q.ClassId,
                q.InstructorLabel, c.TeacherId, ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes${hasRevealAnswersColumn ? ", q.RevealAnswersAfterSubmit" : ""}
         FROM dbo.Quiz q
         LEFT JOIN dbo.Class c ON c.ClassId = q.ClassId
         WHERE q.QuizId = @quizId`
      : `SELECT q.QuizId, q.Title, q.Topic, q.SourceType, q.Status, q.ClassId,
                q.InstructorLabel, c.TeacherId, ISNULL(q.TimeLimitMinutes, 0) AS TimeLimitMinutes${hasRevealAnswersColumn ? ", q.RevealAnswersAfterSubmit" : ""}
         FROM dbo.Quiz q
         LEFT JOIN dbo.Class c ON c.ClassId = q.ClassId
         WHERE q.QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });
  const content = await loadQuizContent(quizIdNum);
  if (!content) return res.status(404).json({ message: "Quiz not found" });
  const instructorNameLabel = await resolveInstructorNameLabel(quiz.rows[0].TeacherId, quiz.rows[0].InstructorLabel);
  res.json({
    quizId: content.quizId,
    title: content.title,
    description: content.description,
    sourceType: content.sourceType || null,
    assessmentType: content.assessmentType || normalizeAssessmentType(quiz.rows[0]?.AssessmentType),
    status: content.status,
    timeLimitMinutes: Number(content.timeLimitMinutes || 0),
    revealAnswersAfterSubmit: !!content.revealAnswersAfterSubmit,
    publishStartUtc: content.publishStartUtc || null,
    publishEndUtc: content.publishEndUtc || null,
    headerExtraLines: content.headerExtraLines || [],
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
    instructorLabel: instructorNameLabel,
    instructorNameLabel,
    maxMcqsPerQuiz: await getMaxMcqsPerQuizForClass(quiz.rows[0].ClassId),
    questions: content.questions.map((q) => ({
      questionId: q.questionId,
      questionText: q.questionText,
      explanation: q.explanation,
      diagramType: q.diagramType || "none",
      diagramData: q.diagramData || null,
      points: Number(q.points || 1),
      questionType: normalizeQuestionType(q.questionType),
      expectedAnswerText: q.expectedAnswerText || "",
      answerMatchMode: q.answerMatchMode || "EXACT",
      expectedAnswerNumber: q.expectedAnswerNumber != null ? Number(q.expectedAnswerNumber) : null,
      numericTolerance: q.numericTolerance != null ? Number(q.numericTolerance) : null,
      isHiddenForStudent: !!q.isHiddenForStudent,
      options: (q.options || []).map((o, i) => ({
        optionId: o.optionId,
        label: o.label || ["A", "B", "C", "D", "E", "F"][i] || String(i + 1),
        text: o.text,
        isCorrect: !!o.isCorrect,
      })),
    })),
  });
});

const QuizContentBody = z.object({
  questions: z.array(
    z.object({
      questionText: z.string().min(1).max(4000),
      explanation: z.string().max(3000).optional().nullable(),
      diagramType: z.enum(["none", "svg", "mermaid"]).optional().nullable(),
      diagramData: z.string().max(20000).optional().nullable(),
      questionType: z.enum(["MCQ", "SHORT_TEXT", "TRUE_FALSE", "NUMERIC", "LONG"]).optional(),
      points: z.number().int().min(1).max(100).optional().nullable(),
      expectedAnswerText: z.string().max(500).optional().nullable(),
      answerMatchMode: z.enum(["EXACT", "CONTAINS", "KEYWORDS"]).optional().nullable(),
      expectedAnswerNumber: z.number().finite().optional().nullable(),
      numericTolerance: z.number().min(0).finite().optional().nullable(),
      isHiddenForStudent: z.boolean().optional(),
      options: z
        .array(
          z.object({
            label: z.string().max(5),
            text: z.string().min(1).max(1000),
            isCorrect: z.boolean(),
          })
        )
        .min(0)
        .max(20),
    })
  ),
});

/** PUT /api/quizzes/:quizId/content - Save quiz content (input quiz). Draft only, class member. Replaces all questions/options. */
router.put("/quizzes/:quizId/content", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, Status, ClassId, SourceType, TeacherId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });
  const body = QuizContentBody.parse(req.body);
  const sourceType = String(quiz.rows[0].SourceType || "");
  const isManualOrImport = !isAiSource(sourceType);
  if (isManualOrImport && body.questions.length > 25) {
    return res.status(400).json({
      message: "Maximum number of MCQ's for manual/import quiz is 25.",
    });
  }
  const questionValidationError = validateQuestionPayload(body.questions);
  if (questionValidationError) {
    return res.status(400).json({ message: questionValidationError });
  }
  for (let i = 0; i < body.questions.length; i++) {
    const q = body.questions[i];
    const policyError = validateEducationalQuizEntry({
      quizTitle: null,
      topic: null,
      questionText: q.questionText,
      explanation: q.explanation || null,
      options: Array.isArray(q.options) ? q.options.map((o) => o.text) : [],
    });
    if (policyError) {
      return res.status(400).json({
        message: `Question ${i + 1} rejected: ${policyError} Educational content only.`,
      });
    }
  }
  try {
    await replaceQuizContent(quizIdNum, quiz.rows[0].TeacherId ?? null, body.questions, { useStoredProc: false });
    return res.json({ quizId: quizIdNum, questionCount: body.questions.length });
  } catch (error) {
    if (isLongLimitError(error)) {
      return res.status(400).json({ message: "A quiz can have a maximum of 5 long questions." });
    }
    throw error;
  }
});

const LongQuestionBody = z.object({
  questionType: z.enum(["MCQ", "SHORT_TEXT", "TRUE_FALSE", "NUMERIC", "LONG", "MIX_MATCH_DRAG"]),
  questionText: z.string().min(1).max(4000),
  explanation: z.string().max(3000).optional().nullable(),
  points: z.number().int().min(1).max(100).optional().nullable(),
  diagramType: z.enum(["none", "svg", "mermaid"]).optional().nullable(),
  diagramData: z.string().max(20000).optional().nullable(),
  expectedAnswerText: z.string().max(500).optional().nullable(),
  answerMatchMode: z.enum(["EXACT", "CONTAINS", "KEYWORDS"]).optional().nullable(),
  expectedAnswerNumber: z.number().finite().optional().nullable(),
  numericTolerance: z.number().min(0).finite().optional().nullable(),
  shuffleLeft: z.boolean().optional().nullable(),
  shuffleRight: z.boolean().optional().nullable(),
  allowPartialMarks: z.boolean().optional().nullable(),
  pairs: z.array(
    z.object({
      matchPairId: z.number().int().positive().optional().nullable(),
      leftText: z.string().max(500),
      rightText: z.string().max(500),
      displayOrder: z.number().int().min(0).optional().nullable(),
      isActive: z.boolean().optional().nullable(),
    })
  ).max(MIX_MATCH_MAX_PAIRS).optional(),
  options: z
    .array(
      z.object({
        text: z.string().min(1).max(1000),
        isCorrect: z.boolean(),
      })
    )
    .max(20)
    .optional(),
});

function isLongLimitError(err) {
  return String(err?.message || "").toUpperCase().includes("LONG_LIMIT_REACHED");
}

async function createQuizQuestionViaProc(quizId, teacherId, body, qType, points, options) {
  if (qType === "MIX_MATCH_DRAG") return null;
  try {
    const proc = await execQuery(
      `EXEC dbo.usp_QuizQuestion_Create
         @TeacherId,
         @QuizId,
         @QuestionText,
         @Explanation,
         @DiagramType,
         @DiagramData,
         @QuestionType,
         @ExpectedAnswerText,
         @AnswerMatchMode,
         @ExpectedAnswerNumber,
         @NumericTolerance,
         @Points,
         @OptionsJson`,
      [
        { name: "TeacherId", type: TYPES.Int, value: teacherId ?? null },
        { name: "QuizId", type: TYPES.Int, value: quizId },
        { name: "QuestionText", type: TYPES.NVarChar, value: String(body.questionText || "").trim() },
        { name: "Explanation", type: TYPES.NVarChar, value: body.explanation || null },
        { name: "DiagramType", type: TYPES.NVarChar, value: body.diagramType || "none" },
        { name: "DiagramData", type: TYPES.NVarChar, value: body.diagramData || null },
        { name: "QuestionType", type: TYPES.NVarChar, value: qType },
        { name: "ExpectedAnswerText", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? (body.expectedAnswerText || "").trim() : null },
        { name: "AnswerMatchMode", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? normalizeAnswerMatchMode(body.answerMatchMode) : null },
        { name: "ExpectedAnswerNumber", type: TYPES.Float, value: qType === "NUMERIC" ? Number(body.expectedAnswerNumber) : null },
        { name: "NumericTolerance", type: TYPES.Float, value: qType === "NUMERIC" && Number.isFinite(Number(body.numericTolerance)) ? Number(body.numericTolerance) : null },
        { name: "Points", type: TYPES.Int, value: points },
        { name: "OptionsJson", type: TYPES.NVarChar, value: JSON.stringify(options || []) },
      ]
    );
    return proc.rows?.[0]?.QuestionId || null;
  } catch (error) {
    const message = String(error?.message || "");
    const missingProc =
      message.includes("Could not find stored procedure") ||
      message.includes("usp_QuizQuestion_Create");
    if (!missingProc) throw error;
    return null;
  }
}

async function updateQuizQuestionViaProc(quizId, questionId, teacherId, body, qType, points, options) {
  if (qType === "MIX_MATCH_DRAG") return null;
  try {
    const proc = await execQuery(
      `EXEC dbo.usp_QuizQuestion_Update
         @QuizId,
         @QuestionId,
         @TeacherId,
         @QuestionText,
         @Explanation,
         @DiagramType,
         @DiagramData,
         @QuestionType,
         @ExpectedAnswerText,
         @AnswerMatchMode,
         @ExpectedAnswerNumber,
         @NumericTolerance,
         @Points,
         @OptionsJson`,
      [
        { name: "QuizId", type: TYPES.Int, value: quizId },
        { name: "QuestionId", type: TYPES.Int, value: questionId },
        { name: "TeacherId", type: TYPES.Int, value: teacherId ?? null },
        { name: "QuestionText", type: TYPES.NVarChar, value: String(body.questionText || "").trim() },
        { name: "Explanation", type: TYPES.NVarChar, value: body.explanation || null },
        { name: "DiagramType", type: TYPES.NVarChar, value: body.diagramType || "none" },
        { name: "DiagramData", type: TYPES.NVarChar, value: body.diagramData || null },
        { name: "QuestionType", type: TYPES.NVarChar, value: qType },
        { name: "ExpectedAnswerText", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? (body.expectedAnswerText || "").trim() : null },
        { name: "AnswerMatchMode", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? normalizeAnswerMatchMode(body.answerMatchMode) : null },
        { name: "ExpectedAnswerNumber", type: TYPES.Float, value: qType === "NUMERIC" ? Number(body.expectedAnswerNumber) : null },
        { name: "NumericTolerance", type: TYPES.Float, value: qType === "NUMERIC" && Number.isFinite(Number(body.numericTolerance)) ? Number(body.numericTolerance) : null },
        { name: "Points", type: TYPES.Int, value: points },
        { name: "OptionsJson", type: TYPES.NVarChar, value: JSON.stringify(options || []) },
      ]
    );
    return proc.rows?.[0]?.QuestionId || null;
  } catch (error) {
    const message = String(error?.message || "");
    const missingProc =
      message.includes("Could not find stored procedure") ||
      message.includes("usp_QuizQuestion_Update");
    if (!missingProc) throw error;
    return null;
  }
}

/** POST /api/quizzes/:quizId/questions - create one question (LONG supported). */
router.post("/quizzes/:quizId/questions", async (req, res) => {
  if (req.user.role !== "Manager") return res.status(403).json({ message: "Only teacher can create questions." });
  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });

  const quiz = await execQuery(
    "SELECT QuizId, ClassId, Status, TeacherId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });

  const body = LongQuestionBody.parse(req.body || {});
  const qType = normalizeQuestionType(body.questionType);
  const points = Math.max(1, Math.min(100, Number(body.points || 1)));
  const options = Array.isArray(body.options) ? body.options : [];

  if (qType === "LONG") {
    if (String(body.questionText || "").trim().length < 20) {
      return res.status(400).json({ message: "Question text must be at least 20 characters for LONG type." });
    }
  }
  if ((qType === "MCQ" || qType === "TRUE_FALSE") && options.length < 1) {
    return res.status(400).json({ message: "MCQ requires options." });
  }
  if (qType === "MCQ" && options.length > 4) {
    return res.status(400).json({ message: "MCQ supports maximum 4 options." });
  }
  if (qType === "TRUE_FALSE" && options.length !== 2) {
    return res.status(400).json({ message: "TRUE_FALSE requires exactly two options." });
  }
  if ((qType === "MCQ" || qType === "TRUE_FALSE") && options.filter((o) => !!o.isCorrect).length !== 1) {
    return res.status(400).json({ message: "Question must have exactly one correct option." });
  }
  if (qType === "SHORT_TEXT" && !String(body.expectedAnswerText || "").trim()) {
    return res.status(400).json({ message: "SHORT_TEXT requires expected answer text." });
  }
  if (qType === "NUMERIC" && !Number.isFinite(Number(body.expectedAnswerNumber))) {
    return res.status(400).json({ message: "NUMERIC requires expected answer number." });
  }
  if (qType === "MIX_MATCH_DRAG") {
    const pairError = validateMixMatchPairs(body.pairs, "Question");
    if (pairError) return res.status(400).json({ message: pairError });
  }

  try {
    const procQuestionId = await createQuizQuestionViaProc(
      quizIdNum,
      quiz.rows[0].TeacherId ?? null,
      body,
      qType,
      points,
      options
    );
    if (procQuestionId) {
      return res.status(201).json({ questionId: procQuestionId });
    }

    const inserted = await execQuery(
      `SET XACT_ABORT ON;
       BEGIN TRAN;
         DECLARE @displayOrder INT = (
           SELECT ISNULL(MAX(DisplayOrder), 0) + 1
           FROM dbo.QuizQuestion
           WHERE QuizId = @quizId
         );
         DECLARE @longCount INT = (
           SELECT COUNT(1)
           FROM dbo.QuizQuestion WITH (UPDLOCK, HOLDLOCK)
           WHERE QuizId = @quizId
             AND UPPER(ISNULL(QuestionType, 'MCQ')) = 'LONG'
         );
         IF (@questionType = 'LONG' AND @longCount >= 5)
           RAISERROR('LONG_LIMIT_REACHED', 16, 1);

         INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, DisplayOrder, QuestionType, ExpectedAnswerText, AnswerMatchMode, ExpectedAnswerNumber, NumericTolerance, Points, ShuffleLeft, ShuffleRight, AllowPartialMarks)
         OUTPUT INSERTED.QuestionId
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, @diagramType, @diagramData, @displayOrder, @questionType, @expectedAnswerText, @answerMatchMode, @expectedAnswerNumber, @numericTolerance, @points, @shuffleLeft, @shuffleRight, @allowPartialMarks);
       COMMIT;`,
      [
        { name: "teacherId", type: TYPES.Int, value: quiz.rows[0].TeacherId ?? null },
        { name: "quizId", type: TYPES.Int, value: quizIdNum },
        { name: "questionText", type: TYPES.NVarChar, value: String(body.questionText || "").trim() },
        { name: "explanation", type: TYPES.NVarChar, value: body.explanation || null },
        { name: "diagramType", type: TYPES.NVarChar, value: body.diagramType || "none" },
        { name: "diagramData", type: TYPES.NVarChar, value: body.diagramData || null },
        { name: "questionType", type: TYPES.NVarChar, value: qType },
        { name: "expectedAnswerText", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? (body.expectedAnswerText || "").trim() : null },
        { name: "answerMatchMode", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? normalizeAnswerMatchMode(body.answerMatchMode) : null },
        { name: "expectedAnswerNumber", type: TYPES.Float, value: qType === "NUMERIC" ? Number(body.expectedAnswerNumber) : null },
        { name: "numericTolerance", type: TYPES.Float, value: qType === "NUMERIC" && Number.isFinite(Number(body.numericTolerance)) ? Number(body.numericTolerance) : null },
        { name: "points", type: TYPES.Int, value: points },
        { name: "shuffleLeft", type: TYPES.Bit, value: qType === "MIX_MATCH_DRAG" && normalizeBooleanFlag(body.shuffleLeft, false) ? 1 : 0 },
        { name: "shuffleRight", type: TYPES.Bit, value: qType === "MIX_MATCH_DRAG" ? (normalizeBooleanFlag(body.shuffleRight, true) ? 1 : 0) : 1 },
        { name: "allowPartialMarks", type: TYPES.Bit, value: qType === "MIX_MATCH_DRAG" ? (normalizeBooleanFlag(body.allowPartialMarks, true) ? 1 : 0) : 1 },
      ]
    );
    const questionId = inserted.rows?.[0]?.QuestionId;
    if (!questionId) return res.status(500).json({ message: "Failed to create question." });

    if (qType === "MIX_MATCH_DRAG") {
      await replaceMatchPairs(questionId, quiz.rows[0].TeacherId ?? null, body.pairs || []);
    }
    if (qType === "MCQ" || qType === "TRUE_FALSE") {
      for (let i = 0; i < options.length; i++) {
        await execQuery(
          `INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES (@teacherId, @questionId, @choiceText, @isCorrect, @displayOrder)`,
          [
            { name: "teacherId", type: TYPES.Int, value: quiz.rows[0].TeacherId ?? null },
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "choiceText", type: TYPES.NVarChar, value: options[i].text },
            { name: "isCorrect", type: TYPES.Bit, value: options[i].isCorrect ? 1 : 0 },
            { name: "displayOrder", type: TYPES.Int, value: i + 1 },
          ]
        );
      }
    }
    return res.status(201).json({ questionId });
  } catch (err) {
    if (isLongLimitError(err)) {
      return res.status(400).json({ message: "A quiz can have a maximum of 5 long questions." });
    }
    return res.status(500).json({ message: "Failed to create question." });
  }
});

/** PUT /api/quizzes/:quizId/questions/:questionId - update one question (LONG supported). */
router.put("/quizzes/:quizId/questions/:questionId", async (req, res) => {
  if (req.user.role !== "Manager") return res.status(403).json({ message: "Only teacher can update questions." });
  const quizIdNum = parseInt(req.params.quizId, 10);
  const questionIdNum = parseInt(req.params.questionId, 10);
  if (!Number.isFinite(quizIdNum) || !Number.isFinite(questionIdNum)) {
    return res.status(400).json({ message: "Invalid identifiers." });
  }

  const quiz = await execQuery(
    "SELECT QuizId, ClassId, Status, TeacherId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });

  const exists = await execQuery(
    "SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId = @quizId AND QuestionId = @questionId",
    [
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "questionId", type: TYPES.Int, value: questionIdNum },
    ]
  );
  if (!exists.rows.length) return res.status(404).json({ message: "Question not found" });

  const body = LongQuestionBody.parse(req.body || {});
  const qType = normalizeQuestionType(body.questionType);
  const points = Math.max(1, Math.min(100, Number(body.points || 1)));
  const options = Array.isArray(body.options) ? body.options : [];

  if (qType === "LONG" && String(body.questionText || "").trim().length < 20) {
    return res.status(400).json({ message: "Question text must be at least 20 characters for LONG type." });
  }
  if ((qType === "MCQ" || qType === "TRUE_FALSE") && options.length < 1) {
    return res.status(400).json({ message: "MCQ requires options." });
  }
  if (qType === "MCQ" && options.length > 4) {
    return res.status(400).json({ message: "MCQ supports maximum 4 options." });
  }
  if (qType === "TRUE_FALSE" && options.length !== 2) {
    return res.status(400).json({ message: "TRUE_FALSE requires exactly two options." });
  }
  if ((qType === "MCQ" || qType === "TRUE_FALSE") && options.filter((o) => !!o.isCorrect).length !== 1) {
    return res.status(400).json({ message: "Question must have exactly one correct option." });
  }
  if (qType === "MIX_MATCH_DRAG") {
    const pairError = validateMixMatchPairs(body.pairs, "Question");
    if (pairError) return res.status(400).json({ message: pairError });
  }

  try {
    const procQuestionId = await updateQuizQuestionViaProc(
      quizIdNum,
      questionIdNum,
      quiz.rows[0].TeacherId ?? null,
      body,
      qType,
      points,
      options
    );
    if (procQuestionId) {
      return res.json({ questionId: procQuestionId });
    }

    await execQuery(
      `SET XACT_ABORT ON;
       BEGIN TRAN;
         DECLARE @longCount INT = (
           SELECT COUNT(1)
           FROM dbo.QuizQuestion WITH (UPDLOCK, HOLDLOCK)
           WHERE QuizId = @quizId
             AND QuestionId <> @questionId
             AND UPPER(ISNULL(QuestionType, 'MCQ')) = 'LONG'
         );
         IF (@questionType = 'LONG' AND @longCount >= 5)
           RAISERROR('LONG_LIMIT_REACHED', 16, 1);

         UPDATE dbo.QuizQuestion
         SET QuestionText = @questionText,
             Explanation = @explanation,
             DiagramType = @diagramType,
             DiagramData = @diagramData,
             QuestionType = @questionType,
             ExpectedAnswerText = @expectedAnswerText,
             AnswerMatchMode = @answerMatchMode,
             ExpectedAnswerNumber = @expectedAnswerNumber,
             NumericTolerance = @numericTolerance,
             Points = @points,
             ShuffleLeft = @shuffleLeft,
             ShuffleRight = @shuffleRight,
             AllowPartialMarks = @allowPartialMarks,
             LastModifiedDate = SYSUTCDATETIME()
         WHERE QuizId = @quizId AND QuestionId = @questionId;
       COMMIT;`,
      [
        { name: "quizId", type: TYPES.Int, value: quizIdNum },
        { name: "questionId", type: TYPES.Int, value: questionIdNum },
        { name: "questionText", type: TYPES.NVarChar, value: String(body.questionText || "").trim() },
        { name: "explanation", type: TYPES.NVarChar, value: body.explanation || null },
        { name: "diagramType", type: TYPES.NVarChar, value: body.diagramType || "none" },
        { name: "diagramData", type: TYPES.NVarChar, value: body.diagramData || null },
        { name: "questionType", type: TYPES.NVarChar, value: qType },
        { name: "expectedAnswerText", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? (body.expectedAnswerText || "").trim() : null },
        { name: "answerMatchMode", type: TYPES.NVarChar, value: qType === "SHORT_TEXT" ? normalizeAnswerMatchMode(body.answerMatchMode) : null },
        { name: "expectedAnswerNumber", type: TYPES.Float, value: qType === "NUMERIC" ? Number(body.expectedAnswerNumber) : null },
        { name: "numericTolerance", type: TYPES.Float, value: qType === "NUMERIC" && Number.isFinite(Number(body.numericTolerance)) ? Number(body.numericTolerance) : null },
        { name: "points", type: TYPES.Int, value: points },
        { name: "shuffleLeft", type: TYPES.Bit, value: qType === "MIX_MATCH_DRAG" && normalizeBooleanFlag(body.shuffleLeft, false) ? 1 : 0 },
        { name: "shuffleRight", type: TYPES.Bit, value: qType === "MIX_MATCH_DRAG" ? (normalizeBooleanFlag(body.shuffleRight, true) ? 1 : 0) : 1 },
        { name: "allowPartialMarks", type: TYPES.Bit, value: qType === "MIX_MATCH_DRAG" ? (normalizeBooleanFlag(body.allowPartialMarks, true) ? 1 : 0) : 1 },
      ]
    );

    if (qType === "MIX_MATCH_DRAG") {
      await replaceMatchPairs(questionIdNum, quiz.rows[0].TeacherId ?? null, body.pairs || []);
    }
    await execQuery("DELETE FROM dbo.QuizChoice WHERE QuestionId = @questionId", [
      { name: "questionId", type: TYPES.Int, value: questionIdNum },
    ]);
    if (qType === "MCQ" || qType === "TRUE_FALSE") {
      for (let i = 0; i < options.length; i++) {
        await execQuery(
          `INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES (@teacherId, @questionId, @choiceText, @isCorrect, @displayOrder)`,
          [
            { name: "teacherId", type: TYPES.Int, value: quiz.rows[0].TeacherId ?? null },
            { name: "questionId", type: TYPES.Int, value: questionIdNum },
            { name: "choiceText", type: TYPES.NVarChar, value: options[i].text },
            { name: "isCorrect", type: TYPES.Bit, value: options[i].isCorrect ? 1 : 0 },
            { name: "displayOrder", type: TYPES.Int, value: i + 1 },
          ]
        );
      }
    }
    return res.json({ questionId: questionIdNum });
  } catch (err) {
    if (isLongLimitError(err)) {
      return res.status(400).json({ message: "A quiz can have a maximum of 5 long questions." });
    }
    return res.status(500).json({ message: "Failed to update question." });
  }
});

/** GET /api/quizzes/:quizId/assignments/students - manager sees assignable students with current selections */
router.get("/quizzes/:quizId/assignments/students", async (req, res) => {
  if (req.user.role !== "Manager") return res.status(403).json({ message: "Only teacher can manage assignments." });

  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });
  const classNameFilter = String(req.query.className || "").trim();

  const procResult = await listQuizAssignmentStudents(quizIdNum, req.user.userId, classNameFilter);
  if (procResult) {
    return res.json(procResult);
  }

  const quizScope = await execQuery(
    `SELECT q.QuizId, q.Title, c.ClassName AS QuizClassName
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     JOIN dbo.Student s ON s.StudentId = c.StudentId
     WHERE q.QuizId = @quizId AND s.TeacherId = @managerId`,
    [
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  const quiz = quizScope.rows[0];
  if (!quiz) return res.status(404).json({ message: "Quiz not found" });

  const classOptions = await execQuery(
    `SELECT DISTINCT c.ClassName
     FROM dbo.Class c
     JOIN dbo.Student s ON s.StudentId = c.StudentId
     WHERE s.TeacherId = @managerId
       AND ISNULL(c.ClassName, '') <> ''
     ORDER BY c.ClassName`,
    [{ name: "managerId", type: TYPES.Int, value: req.user.userId }]
  );

  const students = await execQuery(
    `SELECT StudentId, FullName, Email, IsActive
     FROM dbo.Student
     WHERE TeacherId = @managerId
       AND (
         @className IS NULL OR @className = ''
         OR EXISTS (
           SELECT 1
           FROM dbo.Class c
           WHERE c.StudentId = dbo.Student.StudentId
             AND c.ClassName = @className
         )
       )
     ORDER BY FullName, StudentId`,
    [
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
      { name: "className", type: TYPES.NVarChar, value: classNameFilter || null },
    ]
  );
  const assigned = await execQuery(
    "SELECT StudentId FROM dbo.QuizAssignment WHERE TeacherId = @managerId AND QuizId = @quizId",
    [
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]
  );
  const assignedSet = new Set(assigned.rows.map((r) => Number(r.StudentId)));

  return res.json({
    quizId: quiz.QuizId,
    quizTitle: quiz.Title,
    quizClassName: quiz.QuizClassName || "",
    selectedClassName: classNameFilter || "",
    classOptions: classOptions.rows.map((r) => String(r.ClassName || "").trim()).filter(Boolean),
    students: students.rows.map((s) => ({
      studentId: s.StudentId,
      studentCode: s.FullName,
      userName: s.Email,
      isActive: !!s.IsActive,
      assigned: assignedSet.has(Number(s.StudentId)),
    })),
  });
});

/** PUT /api/quizzes/:quizId/assignments - manager updates quiz assignments */
router.put("/quizzes/:quizId/assignments", async (req, res) => {
  if (req.user.role !== "Manager") return res.status(403).json({ message: "Only teacher can manage assignments." });

  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });

  const body = UpdateQuizAssignmentsBody.parse(req.body);
  const studentIds = Array.from(new Set((body.studentIds || []).map(Number))).filter((n) => Number.isFinite(n) && n > 0);

  const quizScope = await execQuery(
    `SELECT q.QuizId, c.ClassName, c.Subject, c.GradeLevel
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     JOIN dbo.Student s ON s.StudentId = c.StudentId
     WHERE q.QuizId = @quizId AND s.TeacherId = @managerId`,
    [
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!quizScope.rows.length) return res.status(404).json({ message: "Quiz not found" });
  const quizMeta = quizScope.rows[0];

  if (studentIds.length) {
    const params = studentIds.map((sid, idx) => ({ name: `s${idx}`, type: TYPES.Int, value: sid }));
    const inClause = studentIds.map((_, idx) => `@s${idx}`).join(", ");
    const valid = await execQuery(
      `SELECT StudentId FROM dbo.Student WHERE TeacherId = @managerId AND StudentId IN (${inClause})`,
      [{ name: "managerId", type: TYPES.Int, value: req.user.userId }, ...params]
    );
    if (valid.rows.length !== studentIds.length) {
      return res.status(400).json({ message: "One or more students are outside your teacher scope." });
    }
  }

  const procCreatedClasses = await replaceQuizAssignments(quizIdNum, req.user.userId, quizMeta, studentIds);
  if (procCreatedClasses != null) {
    return res.json({ quizId: quizIdNum, assignedCount: studentIds.length, createdClasses: procCreatedClasses });
  }

  await execQuery(
    "DELETE FROM dbo.QuizAssignment WHERE TeacherId = @managerId AND QuizId = @quizId",
    [
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]
  );

  let createdClasses = 0;
  for (const sid of studentIds) {
    const hasClass = await execQuery(
      "SELECT TOP 1 ClassId FROM dbo.Class WHERE StudentId = @studentId AND ClassName = @className ORDER BY ClassId",
      [
        { name: "studentId", type: TYPES.Int, value: sid },
        { name: "className", type: TYPES.NVarChar, value: quizMeta.ClassName },
      ]
    );
    if (!hasClass.rows.length) {
      let joinCode = randomJoinCode();
      for (let attempt = 0; attempt < 20; attempt++) {
        const existing = await execQuery("SELECT 1 FROM dbo.Class WHERE JoinCode = @code", [
          { name: "code", type: TYPES.NVarChar, value: joinCode },
        ]);
        if (!existing.rows.length) break;
        joinCode = randomJoinCode();
      }

      await execQuery(
        `INSERT INTO dbo.Class (TeacherId, StudentId, ClassName, Subject, GradeLevel, JoinCode)
         VALUES (@managerId, @studentId, @className, @subject, @gradeLevel, @joinCode)`,
        [
          { name: "managerId", type: TYPES.Int, value: req.user.userId },
          { name: "studentId", type: TYPES.Int, value: sid },
          { name: "className", type: TYPES.NVarChar, value: quizMeta.ClassName },
          { name: "subject", type: TYPES.NVarChar, value: quizMeta.Subject || null },
          { name: "gradeLevel", type: TYPES.NVarChar, value: quizMeta.GradeLevel || null },
          { name: "joinCode", type: TYPES.NVarChar, value: joinCode },
        ]
      );
      createdClasses += 1;
    }
  }

  for (const sid of studentIds) {
    await execQuery(
      `INSERT INTO dbo.QuizAssignment (TeacherId, QuizId, StudentId)
       VALUES (@managerId, @quizId, @studentId)`,
      [
        { name: "managerId", type: TYPES.Int, value: req.user.userId },
        { name: "quizId", type: TYPES.Int, value: quizIdNum },
        { name: "studentId", type: TYPES.Int, value: sid },
      ]
    );
  }

  return res.json({ quizId: quizIdNum, assignedCount: studentIds.length, createdClasses });
});

/** PUT /api/questions/:questionId/visibility - manager can hide/unhide a question for students */
router.put("/questions/:questionId/visibility", async (req, res) => {
  if (req.user.role !== "Manager") {
    return res.status(403).json({ message: "Only teacher can change question visibility." });
  }

  const questionIdNum = parseInt(req.params.questionId, 10);
  if (!Number.isFinite(questionIdNum)) return res.status(400).json({ message: "Invalid question id" });

  const body = UpdateQuestionVisibilityBody.parse(req.body);

  const scope = await execQuery(
    `SELECT qq.QuestionId
     FROM dbo.QuizQuestion qq
     JOIN dbo.Quiz q ON q.QuizId = qq.QuizId
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     JOIN dbo.Student s ON s.StudentId = c.StudentId
     WHERE qq.QuestionId = @questionId
       AND s.TeacherId = @managerId`,
    [
      { name: "questionId", type: TYPES.Int, value: questionIdNum },
      { name: "managerId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!scope.rows.length) return res.status(404).json({ message: "Question not found" });

  await execQuery(
    "UPDATE dbo.QuizQuestion SET IsHiddenForStudent = @isHiddenForStudent WHERE QuestionId = @questionId",
    [
      { name: "isHiddenForStudent", type: TYPES.Bit, value: body.isHiddenForStudent ? 1 : 0 },
      { name: "questionId", type: TYPES.Int, value: questionIdNum },
    ]
  );

  return res.json({ questionId: questionIdNum, isHiddenForStudent: !!body.isHiddenForStudent });
});

module.exports = router;

