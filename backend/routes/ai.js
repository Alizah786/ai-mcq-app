const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { processAIGenerationJob, getAICapability } = require("../services/aiGenerator");
const { getSubscriptionStatus } = require("../services/subscription");
const {
  assertStudentCanCreateQuiz,
  assertManagerCanCreateQuiz,
  PaymentRequiredError,
} = require("../services/quizQuota");
const { logUsageEventByActor } = require("../services/usageEvents");

const router = express.Router();
router.use(requireAuth);
const SAFE_AI_FAILURE_MESSAGE = "AI could not generate this quiz right now. You can create quiz manually or import from Excel.";

function validateAiTopic(topicRaw) {
  const topic = String(topicRaw || "").trim();
  if (topic.length < 3) return "Topic must be at least 3 characters.";
  if (topic.length > 120) return "Topic must be 120 characters or less.";
  if (/[\r\n]/.test(topic)) return "Topic must be a single line.";
  if (/[,;|]/.test(topic)) {
    return "Use one focused topic only (no comma-separated or list topics).";
  }
  if (/\s-\s*ai quiz$/i.test(topic) || /\bai quiz\b/i.test(topic)) {
    return "Do not include 'AI Quiz' in topic. Enter only the subject.";
  }
  const words = topic.split(/\s+/).filter(Boolean);
  if (words.length > 12) return "Topic is too broad. Keep it under 12 words.";
  return null;
}

const CreateAIJobBody = z.object({
  classId: z.number().int().positive(),
  assessmentType: z.enum(["QUIZ", "ASSIGNMENT"]).optional(),
  topic: z.string().trim().min(3).max(120),
  deadlineDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).optional(),
  referenceText: z.string().trim().min(120).max(20000).optional(),
  totalMarks: z.number().int().min(0).max(10000).optional(),
  weightPercent: z.number().min(0).max(100).optional(),
  documentId: z.number().int().positive().optional(),
  numQuestions: z.number().int().min(1).max(20).optional(),
  mcqCount: z.number().int().min(0).max(20).optional(),
  mcqDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  shortCount: z.number().int().min(0).max(20).optional(),
  shortDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  trueFalseCount: z.number().int().min(0).max(20).optional(),
  trueFalseDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  mixMatchCount: z.number().int().min(0).max(20).optional(),
  mixMatchDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  longCount: z.number().int().min(0).max(5).optional(),
  longDifficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  attemptLimit: z.number().int().min(1).max(5).optional(),
  timeLimitMinutes: z.number().int().min(0).max(300).optional(),
  revealAnswersAfterSubmit: z.boolean().optional(),
  disclaimerAcknowledged: z.literal(true),
  disclaimerId: z.number().int().positive(),
  studentId: z.number().int().positive().optional(),
});

function normalizeDeadlineDateToUtcIso(deadlineValue) {
  const raw = String(deadlineValue || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T23:59:59.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }
  return null;
}

const ListDictionaryQuery = z.object({
  classId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const CreateFromDictionaryBody = z.object({
  classId: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  attemptLimit: z.number().int().min(1).max(5).optional(),
  timeLimitMinutes: z.number().int().min(0).max(300).optional(),
  revealAnswersAfterSubmit: z.boolean().optional(),
});

const CreateMixedFromDictionaryBody = z.object({
  classId: z.number().int().positive(),
  dictionaryIds: z.array(z.number().int().positive()).min(2).max(10),
  title: z.string().trim().min(1).max(200).optional(),
  attemptLimit: z.number().int().min(1).max(5).optional(),
  timeLimitMinutes: z.number().int().min(0).max(300).optional(),
  revealAnswersAfterSubmit: z.boolean().optional(),
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

function normalizeDictionaryQuestions(payload) {
  const raw = Array.isArray(payload?.questions) ? payload.questions : [];
  const questions = [];
  for (const q of raw) {
    const qTypeRaw = String(q?.questionType || "MCQ").trim().toUpperCase();
    const questionType =
      qTypeRaw === "SHORT_TEXT"
        ? "SHORT_TEXT"
        : qTypeRaw === "TRUE_FALSE"
          ? "TRUE_FALSE"
          : qTypeRaw === "MIX_MATCH_DRAG"
            ? "MIX_MATCH_DRAG"
            : qTypeRaw === "NUMERIC"
              ? "NUMERIC"
            : qTypeRaw === "LONG"
              ? "LONG"
              : "MCQ";
    const questionText = String(q?.questionText || "").trim();
    const options = Array.isArray(q?.options)
      ? q.options
          .map((o) => {
            if (typeof o === "string") return o.trim();
            if (o && typeof o === "object" && typeof o.text === "string") return o.text.trim();
            return String(o || "").trim();
          })
          .filter(Boolean)
      : [];
    if (!questionText) continue;
    const expectedOptionCount = questionType === "TRUE_FALSE" ? 2 : 4;
    const correctIndex =
      Number.isInteger(q?.correctIndex) && q.correctIndex >= 0 && q.correctIndex < expectedOptionCount ? q.correctIndex : 0;
    const expectedAnswerText = String(q?.expectedAnswerText || "").trim();
    const expectedAnswerNumber = Number.isFinite(Number(q?.expectedAnswerNumber)) ? Number(q.expectedAnswerNumber) : null;
    const numericTolerance = Number.isFinite(Number(q?.numericTolerance)) ? Number(q.numericTolerance) : null;
    if ((questionType === "MCQ" || questionType === "TRUE_FALSE") && options.length < expectedOptionCount) continue;
    if (questionType === "SHORT_TEXT" && !expectedAnswerText) continue;
    if (questionType === "NUMERIC" && expectedAnswerNumber == null) continue;
    const pairs = Array.isArray(q?.pairs)
      ? q.pairs
          .map((pair, idx) => ({
            leftText: String(pair?.leftText || "").trim(),
            rightText: String(pair?.rightText || "").trim(),
            displayOrder: idx,
            isActive: true,
          }))
          .filter((pair) => pair.leftText && pair.rightText)
      : [];
    if (questionType === "MIX_MATCH_DRAG" && pairs.length < 2) continue;
    if (questionType === "LONG" && questionText.length < 20) continue;
    questions.push({
      questionType,
      questionText,
      explanation: String(q?.explanation || "").trim() || null,
      diagramType: ["none", "svg", "mermaid"].includes(String(q?.diagramType || "").toLowerCase())
        ? String(q.diagramType).toLowerCase()
        : "none",
      diagramData: String(q?.diagramData || "").trim() || null,
      options: questionType === "MCQ" ? options.slice(0, 4) : questionType === "TRUE_FALSE" ? options.slice(0, 2) : [],
      correctIndex: questionType === "MCQ" || questionType === "TRUE_FALSE" ? correctIndex : null,
      expectedAnswerText: questionType === "SHORT_TEXT" ? expectedAnswerText : null,
      expectedAnswerNumber: questionType === "NUMERIC" ? expectedAnswerNumber : null,
      numericTolerance: questionType === "NUMERIC" ? numericTolerance : null,
      points: questionType === "LONG" || questionType === "MIX_MATCH_DRAG" ? Math.max(1, Math.min(100, Number(q?.points || (questionType === "MIX_MATCH_DRAG" ? 1 : 10)))) : null,
      pairs: questionType === "MIX_MATCH_DRAG" ? pairs.slice(0, 10) : [],
      shuffleLeft: questionType === "MIX_MATCH_DRAG" ? !!q?.shuffleLeft : false,
      shuffleRight: questionType === "MIX_MATCH_DRAG" ? (q?.shuffleRight == null ? true : !!q.shuffleRight) : true,
      allowPartialMarks: questionType === "MIX_MATCH_DRAG" ? (q?.allowPartialMarks == null ? true : !!q.allowPartialMarks) : true,
    });
  }
  return questions;
}

function normalizeDedupText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildDictionaryQuestionSignature(question = {}) {
  const questionType = String(question.questionType || "MCQ").toUpperCase();
  const base = [
    questionType,
    normalizeDedupText(question.questionText),
    normalizeDedupText(question.diagramType),
    normalizeDedupText(question.diagramData),
  ];
  if (questionType === "MCQ" || questionType === "TRUE_FALSE") {
    const options = (Array.isArray(question.options) ? question.options : []).map((option) => normalizeDedupText(option));
    base.push(String(Number(question.correctIndex ?? -1)));
    base.push(options.join("|"));
  } else if (questionType === "SHORT_TEXT" || questionType === "LONG") {
    base.push(normalizeDedupText(question.expectedAnswerText));
  } else if (questionType === "NUMERIC") {
    base.push(String(Number.isFinite(Number(question.expectedAnswerNumber)) ? Number(question.expectedAnswerNumber) : ""));
    base.push(String(Number.isFinite(Number(question.numericTolerance)) ? Number(question.numericTolerance) : ""));
  } else if (questionType === "MIX_MATCH_DRAG") {
    const pairs = (Array.isArray(question.pairs) ? question.pairs : [])
      .map((pair) => `${normalizeDedupText(pair.leftText)}=>${normalizeDedupText(pair.rightText)}`)
      .sort();
    base.push(pairs.join("|"));
  }
  return base.join("::");
}

function dedupeDictionaryQuestions(questions = []) {
  const seen = new Set();
  const uniqueQuestions = [];
  let removedCount = 0;
  for (const question of questions) {
    const signature = buildDictionaryQuestionSignature(question);
    if (!signature) {
      uniqueQuestions.push(question);
      continue;
    }
    if (seen.has(signature)) {
      removedCount += 1;
      continue;
    }
    seen.add(signature);
    uniqueQuestions.push(question);
  }
  return { uniqueQuestions, removedCount };
}

async function resolveMaxMcqsPerQuiz(studentId, teacherId, actorRole = "Student") {
  const studentSub = await getSubscriptionStatus("Student", studentId);
  let max = Number(studentSub?.maxMcqsPerQuiz || 20);
  if (teacherId) {
    try {
      const teacherSub = await getSubscriptionStatus("Teacher", teacherId);
      const teacherMax = Number(teacherSub?.maxMcqsPerQuiz || max);
      if (Number.isFinite(teacherMax) && teacherMax > 0) {
        if (String(actorRole) === "Manager") {
          // Teacher flow should respect teacher plan cap for per-quiz question count.
          max = teacherMax;
        } else {
          max = Math.min(max, teacherMax);
        }
      }
    } catch {
      // Keep student max if teacher subscription lookup fails.
    }
  }
  if (!Number.isFinite(max) || max < 1) return 20;
  return max;
}

/** GET /api/ai/capability - checks if current AI provider is usable */
router.get("/ai/capability", async (req, res) => {
  const cap = await getAICapability();
  return res.json(cap);
});

/** POST /api/ai/jobs - create a background AI generation job */
router.post("/ai/jobs", async (req, res) => {
  try {
    const cap = await getAICapability();
    if (!cap.canGenerate) {
      return res.status(400).json({ message: cap.reason || "AI provider is not available" });
    }

    const body = CreateAIJobBody.parse(req.body);
    const disclaimer = await execQuery(
      `SELECT DisclaimerId
       FROM dbo.Disclaimer
       WHERE DisclaimerId = @disclaimerId
         AND DisclaimerType = 'AI'
         AND IsActive = 1`,
      [{ name: "disclaimerId", type: TYPES.Int, value: body.disclaimerId }]
    );
    if (!disclaimer.rows.length) {
      return res.status(400).json({ message: "Invalid AI disclaimer selected." });
    }
    const topicValidationError = validateAiTopic(body.topic);
    if (topicValidationError) {
      return res.status(400).json({ message: topicValidationError });
    }

    let targetStudentId = req.user.userId;
    let targetTeacherId = null;
    if (req.user.role === "Manager") {
      if (!body.studentId) return res.status(400).json({ message: "studentId is required for teacher." });
      const studentScope = await execQuery(
        "SELECT TeacherId FROM dbo.Student WHERE StudentId = @studentId AND TeacherId = @managerId AND IsActive = 1",
        [
          { name: "studentId", type: TYPES.Int, value: body.studentId },
          { name: "managerId", type: TYPES.Int, value: req.user.userId },
        ]
      );
      if (!studentScope.rows.length) return res.status(403).json({ message: "Forbidden student scope" });
      targetStudentId = body.studentId;
      targetTeacherId = studentScope.rows[0].TeacherId ?? req.user.userId;
    } else {
      const studentOwn = await execQuery(
        "SELECT TeacherId FROM dbo.Student WHERE StudentId = @studentId AND IsActive = 1",
        [{ name: "studentId", type: TYPES.Int, value: targetStudentId }]
      );
      if (!studentOwn.rows.length) return res.status(404).json({ message: "Student not found" });
      targetTeacherId = studentOwn.rows[0].TeacherId ?? null;
    }

    const classCheck = await execQuery(
      "SELECT 1 FROM dbo.Class WHERE ClassId = @classId AND StudentId = @studentId",
      [
        { name: "classId", type: TYPES.Int, value: body.classId },
        { name: "studentId", type: TYPES.Int, value: targetStudentId },
      ]
    );
    if (!classCheck.rows.length) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (body.documentId) {
      const docCheck = await execQuery(
        `SELECT TOP 1 DocumentId, Status, StudentId, ClassId, TeacherId
         FROM dbo.DocumentUpload
         WHERE DocumentId = @documentId
           AND DeletedAtUtc IS NULL`,
        [{ name: "documentId", type: TYPES.Int, value: body.documentId }]
      );
      const doc = docCheck.rows[0];
      if (!doc) {
        return res.status(400).json({ message: "Selected document was not found." });
      }
      if (String(doc.Status || "") !== "Extracted") {
        return res.status(400).json({ message: "Document is not ready yet. Wait until extraction completes." });
      }
      if (Number(doc.ClassId || 0) !== Number(body.classId || 0)) {
        return res.status(400).json({ message: "Document does not belong to selected class." });
      }
      if (req.user.role === "Manager" && Number(doc.TeacherId || 0) !== Number(req.user.userId || 0)) {
        return res.status(403).json({ message: "Forbidden document scope" });
      }
      if (req.user.role !== "Manager" && Number(doc.StudentId || 0) !== Number(targetStudentId || 0)) {
        return res.status(403).json({ message: "Forbidden document scope" });
      }
    }
    const assessmentType = String(body.assessmentType || "QUIZ").toUpperCase() === "ASSIGNMENT" ? "ASSIGNMENT" : "QUIZ";
    const normalizedDeadlineUtc = normalizeDeadlineDateToUtcIso(body.deadlineDate);
    if (assessmentType === "ASSIGNMENT" && !normalizedDeadlineUtc) {
      return res.status(400).json({ message: "Assignment deadline is required." });
    }
    const maxMcqsPerQuiz = await resolveMaxMcqsPerQuiz(targetStudentId, targetTeacherId, req.user.role);
    const requestedMcqCount = assessmentType === "ASSIGNMENT" ? 0 : Number(body.mcqCount ?? body.numQuestions ?? 5);
    const requestedShortCount = assessmentType === "ASSIGNMENT" ? 0 : Number(body.shortCount ?? 0);
    const requestedTrueFalseCount = assessmentType === "ASSIGNMENT" ? 0 : Number(body.trueFalseCount ?? 0);
    const requestedMixMatchCount = assessmentType === "ASSIGNMENT" ? 0 : Number(body.mixMatchCount ?? 0);
    const requestedLongCount = assessmentType === "ASSIGNMENT" ? Number(body.longCount ?? body.numQuestions ?? 5) : Number(body.longCount ?? 0);
    const requestedTotalCount = requestedMcqCount + requestedShortCount + requestedTrueFalseCount + requestedMixMatchCount + requestedLongCount;
    if (requestedTotalCount < 1) {
      return res.status(400).json({ message: "At least one question is required." });
    }
    if (assessmentType === "ASSIGNMENT" && (requestedMcqCount > 0 || requestedShortCount > 0 || requestedTrueFalseCount > 0 || requestedMixMatchCount > 0)) {
      return res.status(400).json({ message: "Assignment mode supports long questions only." });
    }
    if (requestedTotalCount > maxMcqsPerQuiz) {
      return res.status(400).json({
        message: `Number of AI questions exceeds your plan limit (${maxMcqsPerQuiz}) for a single quiz.`,
      });
    }
    if (req.user.role === "Manager") {
      // Teacher flow should be governed by teacher plan quota.
      await assertManagerCanCreateQuiz(req.user.userId, requestedTotalCount, "ai");
    } else {
      await assertStudentCanCreateQuiz(targetStudentId, requestedTotalCount, "ai");
    }
    const mcqDifficulty = body.mcqDifficulty || body.difficulty || "Medium";
    const shortDifficulty = body.shortDifficulty || body.difficulty || "Medium";
    const trueFalseDifficulty = body.trueFalseDifficulty || body.difficulty || "Medium";
    const mixMatchDifficulty = body.mixMatchDifficulty || body.difficulty || "Medium";
    const longDifficulty = body.longDifficulty || body.difficulty || "Medium";
    const promptPayload = JSON.stringify({
      assessmentType,
      topic: body.topic,
      mcqCount: requestedMcqCount,
      mcqDifficulty,
      shortCount: requestedShortCount,
      shortDifficulty,
      trueFalseCount: requestedTrueFalseCount,
      trueFalseDifficulty,
      mixMatchCount: requestedMixMatchCount,
      mixMatchDifficulty,
      longCount: requestedLongCount,
      longDifficulty,
      timeLimitMinutes: Number(body.timeLimitMinutes || 0),
      revealAnswersAfterSubmit: !!body.revealAnswersAfterSubmit,
      referenceText: body.referenceText ? String(body.referenceText).slice(0, 20000) : "",
      deadlineUtc: normalizedDeadlineUtc,
      totalMarks: body.totalMarks == null ? null : Number(body.totalMarks),
      weightPercent: body.weightPercent == null ? null : Number(body.weightPercent),
    });

    const created = await execQuery(
      `INSERT INTO dbo.AIGenerationJob (TeacherId, StudentId, ClassId, DocumentId, Topic, Prompt, NumQuestions, Difficulty, AttemptLimit, Status)
       OUTPUT INSERTED.JobId, INSERTED.Status, INSERTED.CreateDate, INSERTED.LastModifiedDate
      VALUES (@managerId, @studentId, @classId, @documentId, @topic, @prompt, @numQuestions, @difficulty, @attemptLimit, 'Queued')`,
      [
        { name: "managerId", type: TYPES.Int, value: targetTeacherId },
        { name: "studentId", type: TYPES.Int, value: targetStudentId },
        { name: "classId", type: TYPES.Int, value: body.classId },
        { name: "documentId", type: TYPES.Int, value: body.documentId || null },
        { name: "topic", type: TYPES.NVarChar, value: body.topic },
        { name: "prompt", type: TYPES.NVarChar, value: promptPayload },
        { name: "numQuestions", type: TYPES.Int, value: requestedTotalCount },
        { name: "difficulty", type: TYPES.NVarChar, value: mcqDifficulty },
        { name: "attemptLimit", type: TYPES.Int, value: body.attemptLimit || 1 },
      ]
    );
    const row = created.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to create AI job" });

    setImmediate(() => {
      processAIGenerationJob(row.JobId).catch(() => {});
    });
    logUsageEventByActor({
      role: req.user.role,
      userId: req.user.userId,
      eventType: "AI_JOB",
      quantity: requestedTotalCount,
    }).catch(() => {});

    return res.status(202).json({
      jobId: row.JobId,
      status: row.Status,
      provider: cap.provider,
      createDate: row.CreateDate || null,
      lastModifiedDate: row.LastModifiedDate || null,
      createdAtUtc: row.CreateDate || null,
    });
  } catch (e) {
    if (e instanceof PaymentRequiredError) {
      return res.status(402).json({ message: e.message, paymentRequired: true, redirectTo: "/pricing" });
    }
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    return res.status(500).json({ message: "Failed to create AI job", detail: e.message });
  }
});

/** GET /api/ai/jobs/:jobId - job status polling endpoint */
router.get("/ai/jobs/:jobId", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  if (!Number.isFinite(jobId)) return res.status(400).json({ message: "Invalid job id" });

  const r = await execQuery(
    `SELECT j.JobId, j.StudentId, j.ClassId, j.Topic, j.NumQuestions, j.Difficulty, j.Status, j.ResultQuizId, j.ErrorMessage, j.CreateDate, j.LastModifiedDate, j.CompletedAtUtc,
            s.TeacherId
     FROM dbo.AIGenerationJob j
     JOIN dbo.Student s ON s.StudentId = j.StudentId
     WHERE j.JobId = @jobId`,
    [{ name: "jobId", type: TYPES.Int, value: jobId }]
  );
  const row = r.rows[0];
  if (!row) return res.status(404).json({ message: "Job not found" });
  if (req.user.role === "Student" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (req.user.role === "Manager" && row.TeacherId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });

  return res.json({
    jobId: row.JobId,
    classId: row.ClassId,
    topic: row.Topic,
    numQuestions: row.NumQuestions,
    difficulty: row.Difficulty,
    status: row.Status,
    resultQuizId: row.ResultQuizId,
    errorMessage: row.Status === "Failed" ? (SAFE_AI_FAILURE_MESSAGE) : row.ErrorMessage,
    createDate: row.CreateDate || null,
    lastModifiedDate: row.LastModifiedDate || null,
    createdAtUtc: row.CreateDate || null,
    completedAtUtc: row.CompletedAtUtc,
    studentId: row.StudentId,
  });
});

/** GET /api/ai/dictionary - list reusable AI quiz history entries in scope */
router.get("/ai/dictionary", async (req, res) => {
  try {
    const query = ListDictionaryQuery.parse(req.query || {});
    const limit = query.limit || 30;
    const classId = query.classId || null;

    if (classId) {
      const ok = await canAccessClass(req, classId);
      if (!ok) return res.status(403).json({ message: "Forbidden" });
    }

    let rows = { rows: [] };
    if (req.user.role === "Manager") {
      rows = await execQuery(
        `SELECT TOP (${limit})
            d.AIQuizDictionaryId, d.ClassId, d.Topic, d.Difficulty, d.QuestionCount, d.SourceProvider, d.ModelName, d.CreateDate,
            c.ClassName
         FROM dbo.AIQuizDictionary d
         LEFT JOIN dbo.Class c ON c.ClassId = d.ClassId
         WHERE d.IsActive = 1
           AND d.TeacherId = @managerId
           AND (@classId IS NULL OR d.ClassId = @classId)
         ORDER BY d.CreateDate DESC, d.AIQuizDictionaryId DESC`,
        [
          { name: "managerId", type: TYPES.Int, value: req.user.userId },
          { name: "classId", type: TYPES.Int, value: classId },
        ]
      );
    } else {
      rows = await execQuery(
        `SELECT TOP (${limit})
            d.AIQuizDictionaryId, d.ClassId, d.Topic, d.Difficulty, d.QuestionCount, d.SourceProvider, d.ModelName, d.CreateDate,
            c.ClassName
         FROM dbo.AIQuizDictionary d
         LEFT JOIN dbo.Class c ON c.ClassId = d.ClassId
         WHERE d.IsActive = 1
           AND d.StudentId = @studentId
           AND (@classId IS NULL OR d.ClassId = @classId)
         ORDER BY d.CreateDate DESC, d.AIQuizDictionaryId DESC`,
        [
          { name: "studentId", type: TYPES.Int, value: req.user.userId },
          { name: "classId", type: TYPES.Int, value: classId },
        ]
      );
    }

    return res.json({
      items: rows.rows.map((r) => ({
        aiQuizDictionaryId: r.AIQuizDictionaryId,
        classId: r.ClassId,
        className: r.ClassName || "",
        topic: r.Topic || "",
        difficulty: r.Difficulty || "",
        questionCount: Number(r.QuestionCount || 0),
        sourceProvider: r.SourceProvider || "",
        modelName: r.ModelName || "",
        createDate: r.CreateDate || null,
      })),
    });
  } catch (e) {
    if (e?.name === "ZodError") {
      return res.status(400).json({ message: "Invalid query.", errors: e.errors });
    }
    if (String(e?.message || "").toLowerCase().includes("aiquizdictionary")) {
      return res.status(500).json({ message: "AI history is not initialized. Run migration 2026-02-22_add_ai_quiz_dictionary.sql." });
    }
    return res.status(500).json({ message: "Failed to load AI history.", detail: e.message });
  }
});

/** POST /api/ai/dictionary/:dictionaryId/create-quiz - clone a historical AI payload into a new draft quiz */
router.post("/ai/dictionary/:dictionaryId/create-quiz", async (req, res) => {
  try {
    const dictionaryId = Number(req.params.dictionaryId);
    if (!Number.isFinite(dictionaryId) || dictionaryId <= 0) {
      return res.status(400).json({ message: "Invalid dictionary id." });
    }
    const body = CreateFromDictionaryBody.parse(req.body || {});

    const aiDisclaimer = await execQuery(
      `SELECT TOP 1 DisclaimerId
       FROM dbo.Disclaimer
       WHERE DisclaimerType = 'AI' AND IsActive = 1
       ORDER BY DisclaimerId DESC`
    );
    const aiDisclaimerId = aiDisclaimer.rows[0]?.DisclaimerId;
    if (!aiDisclaimerId) {
      return res.status(400).json({ message: "Active AI disclaimer not found." });
    }

    const row = await execQuery(
      `SELECT d.AIQuizDictionaryId, d.TeacherId, d.StudentId, d.ClassId, d.Topic, d.Difficulty, d.QuestionCount, d.DictionaryPayloadJson,
              c.StudentId AS ClassStudentId, c.TeacherId AS ClassTeacherId
       FROM dbo.AIQuizDictionary d
       LEFT JOIN dbo.Class c ON c.ClassId = d.ClassId
       WHERE d.AIQuizDictionaryId = @id AND d.IsActive = 1`,
      [{ name: "id", type: TYPES.Int, value: dictionaryId }]
    );
    const item = row.rows[0];
    if (!item) return res.status(404).json({ message: "History item not found." });

    let targetClassId = Number(body.classId || item.ClassId || 0);
    if (!targetClassId) return res.status(400).json({ message: "Target class is required." });

    const allowed = await canAccessClass(req, targetClassId);
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const classMeta = await execQuery(
      `SELECT ClassId, StudentId, TeacherId
       FROM dbo.Class
       WHERE ClassId = @classId`,
      [{ name: "classId", type: TYPES.Int, value: targetClassId }]
    );
    const cls = classMeta.rows[0];
    if (!cls) return res.status(404).json({ message: "Class not found." });

    const maxMcqsPerQuiz = await resolveMaxMcqsPerQuiz(cls.StudentId, cls.TeacherId, req.user.role);

    let payload = null;
    try {
      payload = JSON.parse(String(item.DictionaryPayloadJson || "{}"));
    } catch {
      return res.status(400).json({ message: "Stored AI history payload is invalid." });
    }

    const questions = normalizeDictionaryQuestions(payload);
    if (!questions.length) {
      return res.status(400).json({ message: "History item has no usable questions." });
    }
    if (questions.length > maxMcqsPerQuiz) {
      return res.status(400).json({
        message: `Selected AI history has ${questions.length} questions. Plan limit is ${maxMcqsPerQuiz} questions per quiz.`,
      });
    }
    if (req.user.role === "Manager") {
      // Teacher flow should be governed by teacher plan quota.
      await assertManagerCanCreateQuiz(req.user.userId, questions.length, "ai");
    } else {
      await assertStudentCanCreateQuiz(cls.StudentId, questions.length, "ai");
    }

    const topic = String(item.Topic || payload?.meta?.topic || "AI Topic").trim() || "AI Topic";
    const assessmentType = String(payload?.meta?.assessmentType || "QUIZ").toUpperCase() === "ASSIGNMENT" ? "ASSIGNMENT" : "QUIZ";
    const difficulty = String(item.Difficulty || payload?.meta?.difficulty || "Medium").trim() || "Medium";
    const historyDeadlineUtcRaw = String(payload?.meta?.deadlineUtc || "").trim();
    const historyDeadlineUtc = historyDeadlineUtcRaw ? new Date(historyDeadlineUtcRaw) : null;
    const historyTotalMarksRaw = Number(payload?.meta?.totalMarks);
    const historyTotalMarks = Number.isFinite(historyTotalMarksRaw) ? Math.max(0, Math.min(10000, Math.trunc(historyTotalMarksRaw))) : null;
    const historyWeightPercentRaw = Number(payload?.meta?.weightPercent);
    const historyWeightPercent = Number.isFinite(historyWeightPercentRaw) ? Math.max(0, Math.min(100, historyWeightPercentRaw)) : null;
    const quizTitle = String(body.title || `${topic} - AI ${assessmentType === "ASSIGNMENT" ? "Assignment" : "Quiz"} (History)`).trim().slice(0, 200);

    const createdQuiz = await execQuery(
      `INSERT INTO dbo.Quiz
         (TeacherId, ClassId, Title, Topic, Difficulty, SourceType, AssessmentType, Status, DisclaimerId, AIQuizDictionaryId, AttemptLimit, TimeLimitMinutes, DeadlineUtc, TotalMarks, WeightPercent, RevealAnswersAfterSubmit, RequiresTeacherReview, TeacherReviewed, IsTeacherEdited)
       OUTPUT INSERTED.QuizId, INSERTED.Title
       VALUES
         (@teacherId, @classId, @title, @topic, @difficulty, 'AI_History', @assessmentType, 'Draft', @disclaimerId, @dictionaryId, @attemptLimit, @timeLimitMinutes, @deadlineUtc, @totalMarks, @weightPercent, @revealAnswersAfterSubmit, 1, 0, 1)`,
      [
        { name: "teacherId", type: TYPES.Int, value: cls.TeacherId ?? null },
        { name: "classId", type: TYPES.Int, value: targetClassId },
        { name: "title", type: TYPES.NVarChar, value: quizTitle },
        { name: "topic", type: TYPES.NVarChar, value: topic },
        { name: "difficulty", type: TYPES.NVarChar, value: difficulty },
        { name: "assessmentType", type: TYPES.NVarChar, value: assessmentType },
        { name: "disclaimerId", type: TYPES.Int, value: aiDisclaimerId },
        { name: "dictionaryId", type: TYPES.Int, value: dictionaryId },
        { name: "attemptLimit", type: TYPES.Int, value: body.attemptLimit || 1 },
        { name: "timeLimitMinutes", type: TYPES.Int, value: Number(body.timeLimitMinutes || 0) },
        { name: "deadlineUtc", type: TYPES.DateTime2, value: historyDeadlineUtc && !Number.isNaN(historyDeadlineUtc.getTime()) ? historyDeadlineUtc : null },
        { name: "totalMarks", type: TYPES.Int, value: historyTotalMarks },
        { name: "weightPercent", type: TYPES.Decimal, value: historyWeightPercent, options: { precision: 5, scale: 2 } },
        { name: "revealAnswersAfterSubmit", type: TYPES.Bit, value: body.revealAnswersAfterSubmit ? 1 : 0 },
      ]
    );
    const quizId = createdQuiz.rows[0]?.QuizId;
    if (!quizId) return res.status(500).json({ message: "Failed to create quiz from history." });

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qTypeRaw = String(q.questionType || "MCQ").toUpperCase();
      const questionType =
        qTypeRaw === "SHORT_TEXT"
          ? "SHORT_TEXT"
          : qTypeRaw === "TRUE_FALSE"
            ? "TRUE_FALSE"
            : qTypeRaw === "MIX_MATCH_DRAG"
              ? "MIX_MATCH_DRAG"
              : qTypeRaw === "NUMERIC"
                ? "NUMERIC"
              : qTypeRaw === "LONG"
                ? "LONG"
                : "MCQ";
      const insertedQ = await execQuery(
        `INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, DisplayOrder, QuestionType, ExpectedAnswerText, AnswerMatchMode, ExpectedAnswerNumber, NumericTolerance, Points, ShuffleLeft, ShuffleRight, AllowPartialMarks)
         OUTPUT INSERTED.QuestionId
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, @diagramType, @diagramData, @displayOrder, @questionType, @expectedAnswerText, @answerMatchMode, @expectedAnswerNumber, @numericTolerance, @points, @shuffleLeft, @shuffleRight, @allowPartialMarks)`,
        [
          { name: "teacherId", type: TYPES.Int, value: cls.TeacherId ?? null },
          { name: "quizId", type: TYPES.Int, value: quizId },
          { name: "questionText", type: TYPES.NVarChar, value: q.questionText },
          { name: "explanation", type: TYPES.NVarChar, value: q.explanation },
          { name: "diagramType", type: TYPES.NVarChar, value: q.diagramType || "none" },
          { name: "diagramData", type: TYPES.NVarChar, value: q.diagramData || null },
          { name: "displayOrder", type: TYPES.Int, value: i + 1 },
          { name: "questionType", type: TYPES.NVarChar, value: questionType },
          { name: "expectedAnswerText", type: TYPES.NVarChar, value: questionType === "SHORT_TEXT" ? (q.expectedAnswerText || "Sample answer") : null },
          { name: "answerMatchMode", type: TYPES.NVarChar, value: questionType === "SHORT_TEXT" ? "EXACT" : null },
          { name: "expectedAnswerNumber", type: TYPES.Float, value: questionType === "NUMERIC" ? Number(q.expectedAnswerNumber) : null },
          { name: "numericTolerance", type: TYPES.Float, value: questionType === "NUMERIC" && Number.isFinite(Number(q.numericTolerance)) ? Number(q.numericTolerance) : null },
          { name: "points", type: TYPES.Int, value: questionType === "LONG" || questionType === "MIX_MATCH_DRAG" ? Math.max(1, Math.min(100, Number(q.points || (questionType === "MIX_MATCH_DRAG" ? 1 : 10)))) : 1 },
          { name: "shuffleLeft", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" && !!q.shuffleLeft ? 1 : 0 },
          { name: "shuffleRight", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" ? (q.shuffleRight == null || !!q.shuffleRight ? 1 : 0) : 1 },
          { name: "allowPartialMarks", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" ? (q.allowPartialMarks == null || !!q.allowPartialMarks ? 1 : 0) : 1 },
        ]
      );
      const questionId = insertedQ.rows[0]?.QuestionId;
      if (!questionId) continue;

      if (questionType === "SHORT_TEXT" || questionType === "LONG" || questionType === "NUMERIC") continue;
      if (questionType === "MIX_MATCH_DRAG") {
        for (let j = 0; j < (q.pairs || []).length; j++) {
          await execQuery(
            `INSERT INTO dbo.MatchPair
               (QuestionId, LeftText, RightText, DisplayOrder, IsActive, UpdatedDate)
             VALUES
               (@questionId, @leftText, @rightText, @displayOrder, 1, NULL)`,
            [
              { name: "questionId", type: TYPES.Int, value: questionId },
              { name: "leftText", type: TYPES.NVarChar, value: q.pairs[j].leftText },
              { name: "rightText", type: TYPES.NVarChar, value: q.pairs[j].rightText },
              { name: "displayOrder", type: TYPES.Int, value: j },
            ]
          );
        }
        continue;
      }
      const optionCount = questionType === "TRUE_FALSE" ? 2 : 4;
      for (let j = 0; j < optionCount; j++) {
        await execQuery(
          `INSERT INTO dbo.QuizChoice
             (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES
             (@teacherId, @questionId, @choiceText, @isCorrect, @displayOrder)`,
          [
            { name: "teacherId", type: TYPES.Int, value: cls.TeacherId ?? null },
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "choiceText", type: TYPES.NVarChar, value: q.options[j] },
            { name: "isCorrect", type: TYPES.Bit, value: j === q.correctIndex ? 1 : 0 },
            { name: "displayOrder", type: TYPES.Int, value: j + 1 },
          ]
        );
      }
    }

    return res.status(201).json({
      message: "Quiz created from AI history.",
      quizId,
      title: createdQuiz.rows[0]?.Title || quizTitle,
      sourceDictionaryId: dictionaryId,
      questionCount: questions.length,
    });
  } catch (e) {
    if (e instanceof PaymentRequiredError) {
      return res.status(402).json({ message: e.message, paymentRequired: true, redirectTo: "/pricing" });
    }
    if (e?.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input.", errors: e.errors });
    }
    if (String(e?.message || "").toLowerCase().includes("aiquizdictionary")) {
      return res.status(500).json({ message: "AI history is not initialized. Run migration 2026-02-22_add_ai_quiz_dictionary.sql." });
    }
    return res.status(500).json({ message: "Failed to create quiz from AI history.", detail: e.message });
  }
});

/** POST /api/ai/dictionary-mixed/create-quiz - merge multiple AI history snapshots into one draft quiz */
router.post("/ai/dictionary-mixed/create-quiz", async (req, res) => {
  try {
    const body = CreateMixedFromDictionaryBody.parse(req.body || {});

    const aiDisclaimer = await execQuery(
      `SELECT TOP 1 DisclaimerId
       FROM dbo.Disclaimer
       WHERE DisclaimerType = 'AI' AND IsActive = 1
       ORDER BY DisclaimerId DESC`
    );
    const aiDisclaimerId = aiDisclaimer.rows[0]?.DisclaimerId;
    if (!aiDisclaimerId) {
      return res.status(400).json({ message: "Active AI disclaimer not found." });
    }

    const targetClassId = Number(body.classId || 0);
    const allowed = await canAccessClass(req, targetClassId);
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const classMeta = await execQuery(
      `SELECT ClassId, StudentId, TeacherId
       FROM dbo.Class
       WHERE ClassId = @classId`,
      [{ name: "classId", type: TYPES.Int, value: targetClassId }]
    );
    const cls = classMeta.rows[0];
    if (!cls) return res.status(404).json({ message: "Class not found." });

    const dictionaryIds = [...new Set((body.dictionaryIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (dictionaryIds.length < 2) {
      return res.status(400).json({ message: "Select at least two AI history items." });
    }

    const placeholders = dictionaryIds.map((_, idx) => `@id${idx}`).join(", ");
    const rows = await execQuery(
      `SELECT d.AIQuizDictionaryId, d.Topic, d.Difficulty, d.QuestionCount, d.DictionaryPayloadJson
       FROM dbo.AIQuizDictionary d
       WHERE d.IsActive = 1
         AND d.AIQuizDictionaryId IN (${placeholders})`,
      dictionaryIds.map((id, idx) => ({ name: `id${idx}`, type: TYPES.Int, value: id }))
    );
    if (rows.rows.length !== dictionaryIds.length) {
      return res.status(404).json({ message: "One or more selected AI history items were not found." });
    }

    const maxMcqsPerQuiz = await resolveMaxMcqsPerQuiz(cls.StudentId, cls.TeacherId, req.user.role);
    const parsedItems = [];
    for (const item of rows.rows) {
      let payload = null;
      try {
        payload = JSON.parse(String(item.DictionaryPayloadJson || "{}"));
      } catch {
        return res.status(400).json({ message: `Stored AI history payload is invalid for item ${item.AIQuizDictionaryId}.` });
      }
      const questions = normalizeDictionaryQuestions(payload);
      if (!questions.length) {
        return res.status(400).json({ message: `History item ${item.AIQuizDictionaryId} has no usable questions.` });
      }
      const assessmentType = String(payload?.meta?.assessmentType || "QUIZ").toUpperCase() === "ASSIGNMENT" ? "ASSIGNMENT" : "QUIZ";
      parsedItems.push({
        item,
        payload,
        questions,
        assessmentType,
      });
    }

    const assessmentType = parsedItems[0].assessmentType;
    if (parsedItems.some((entry) => entry.assessmentType !== assessmentType)) {
      return res.status(400).json({ message: "All selected AI history items must use the same assessment type." });
    }

    const combinedQuestions = parsedItems.flatMap((entry) => entry.questions);
    const { uniqueQuestions: dedupedQuestions, removedCount: duplicateQuestionCount } = dedupeDictionaryQuestions(combinedQuestions);
    if (!dedupedQuestions.length) {
      return res.status(400).json({ message: "All selected AI history questions were duplicates." });
    }
    if (dedupedQuestions.length > maxMcqsPerQuiz) {
      return res.status(400).json({
        message: `Selected AI history items have ${dedupedQuestions.length} unique questions. Plan limit is ${maxMcqsPerQuiz} questions per quiz.`,
      });
    }

    if (req.user.role === "Manager") {
      await assertManagerCanCreateQuiz(req.user.userId, dedupedQuestions.length, "ai");
    } else {
      await assertStudentCanCreateQuiz(cls.StudentId, dedupedQuestions.length, "ai");
    }

    const topics = parsedItems.map((entry) => String(entry.item.Topic || entry.payload?.meta?.topic || "AI Topic").trim() || "AI Topic");
    const uniqueTopics = [...new Set(topics)];
    const quizTitle = String(
      body.title ||
      (uniqueTopics.length <= 3
        ? `${uniqueTopics.join(" + ")} - AI ${assessmentType === "ASSIGNMENT" ? "Assignment" : "Quiz"}`
        : `Mixed AI ${assessmentType === "ASSIGNMENT" ? "Assignment" : "Quiz"}`)
    ).trim().slice(0, 200);
    const primaryTopic = uniqueTopics.length <= 3 ? uniqueTopics.join(" + ") : "Mixed AI Topics";
    const difficulty = String(parsedItems[0].item.Difficulty || parsedItems[0].payload?.meta?.difficulty || "Medium").trim() || "Medium";

    const createdQuiz = await execQuery(
      `INSERT INTO dbo.Quiz
         (TeacherId, ClassId, Title, Topic, Difficulty, SourceType, AssessmentType, Status, DisclaimerId, AIQuizDictionaryId, AttemptLimit, TimeLimitMinutes, RevealAnswersAfterSubmit, RequiresTeacherReview, TeacherReviewed, IsTeacherEdited)
       OUTPUT INSERTED.QuizId, INSERTED.Title
       VALUES
         (@teacherId, @classId, @title, @topic, @difficulty, 'AI_History', @assessmentType, 'Draft', @disclaimerId, @dictionaryId, @attemptLimit, @timeLimitMinutes, @revealAnswersAfterSubmit, 1, 0, 1)`,
      [
        { name: "teacherId", type: TYPES.Int, value: cls.TeacherId ?? null },
        { name: "classId", type: TYPES.Int, value: targetClassId },
        { name: "title", type: TYPES.NVarChar, value: quizTitle },
        { name: "topic", type: TYPES.NVarChar, value: primaryTopic },
        { name: "difficulty", type: TYPES.NVarChar, value: difficulty },
        { name: "assessmentType", type: TYPES.NVarChar, value: assessmentType },
        { name: "disclaimerId", type: TYPES.Int, value: aiDisclaimerId },
        { name: "dictionaryId", type: TYPES.Int, value: dictionaryIds[0] },
        { name: "attemptLimit", type: TYPES.Int, value: body.attemptLimit || 1 },
        { name: "timeLimitMinutes", type: TYPES.Int, value: Number(body.timeLimitMinutes || 0) },
        { name: "revealAnswersAfterSubmit", type: TYPES.Bit, value: body.revealAnswersAfterSubmit ? 1 : 0 },
      ]
    );
    const quizId = createdQuiz.rows[0]?.QuizId;
    if (!quizId) return res.status(500).json({ message: "Failed to create mixed quiz from AI history." });

    for (let i = 0; i < dedupedQuestions.length; i++) {
      const q = dedupedQuestions[i];
      const qTypeRaw = String(q.questionType || "MCQ").toUpperCase();
      const questionType =
        qTypeRaw === "SHORT_TEXT"
          ? "SHORT_TEXT"
          : qTypeRaw === "TRUE_FALSE"
            ? "TRUE_FALSE"
            : qTypeRaw === "MIX_MATCH_DRAG"
              ? "MIX_MATCH_DRAG"
              : qTypeRaw === "NUMERIC"
                ? "NUMERIC"
              : qTypeRaw === "LONG"
                ? "LONG"
                : "MCQ";
      const insertedQ = await execQuery(
        `INSERT INTO dbo.QuizQuestion
           (TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, DisplayOrder, QuestionType, ExpectedAnswerText, AnswerMatchMode, ExpectedAnswerNumber, NumericTolerance, Points, ShuffleLeft, ShuffleRight, AllowPartialMarks)
         OUTPUT INSERTED.QuestionId
         VALUES
           (@teacherId, @quizId, @questionText, @explanation, @diagramType, @diagramData, @displayOrder, @questionType, @expectedAnswerText, @answerMatchMode, @expectedAnswerNumber, @numericTolerance, @points, @shuffleLeft, @shuffleRight, @allowPartialMarks)`,
        [
          { name: "teacherId", type: TYPES.Int, value: cls.TeacherId ?? null },
          { name: "quizId", type: TYPES.Int, value: quizId },
          { name: "questionText", type: TYPES.NVarChar, value: q.questionText },
          { name: "explanation", type: TYPES.NVarChar, value: q.explanation },
          { name: "diagramType", type: TYPES.NVarChar, value: q.diagramType || "none" },
          { name: "diagramData", type: TYPES.NVarChar, value: q.diagramData || null },
          { name: "displayOrder", type: TYPES.Int, value: i + 1 },
          { name: "questionType", type: TYPES.NVarChar, value: questionType },
          { name: "expectedAnswerText", type: TYPES.NVarChar, value: questionType === "SHORT_TEXT" ? (q.expectedAnswerText || "Sample answer") : null },
          { name: "answerMatchMode", type: TYPES.NVarChar, value: questionType === "SHORT_TEXT" ? "EXACT" : null },
          { name: "expectedAnswerNumber", type: TYPES.Float, value: questionType === "NUMERIC" ? Number(q.expectedAnswerNumber) : null },
          { name: "numericTolerance", type: TYPES.Float, value: questionType === "NUMERIC" && Number.isFinite(Number(q.numericTolerance)) ? Number(q.numericTolerance) : null },
          { name: "points", type: TYPES.Int, value: questionType === "LONG" || questionType === "MIX_MATCH_DRAG" ? Math.max(1, Math.min(100, Number(q.points || (questionType === "MIX_MATCH_DRAG" ? 1 : 10)))) : 1 },
          { name: "shuffleLeft", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" && !!q.shuffleLeft ? 1 : 0 },
          { name: "shuffleRight", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" ? (q.shuffleRight == null || !!q.shuffleRight ? 1 : 0) : 1 },
          { name: "allowPartialMarks", type: TYPES.Bit, value: questionType === "MIX_MATCH_DRAG" ? (q.allowPartialMarks == null || !!q.allowPartialMarks ? 1 : 0) : 1 },
        ]
      );
      const questionId = insertedQ.rows[0]?.QuestionId;
      if (!questionId) continue;

      if (questionType === "SHORT_TEXT" || questionType === "LONG" || questionType === "NUMERIC") continue;
      if (questionType === "MIX_MATCH_DRAG") {
        for (let j = 0; j < (q.pairs || []).length; j++) {
          await execQuery(
            `INSERT INTO dbo.MatchPair
               (QuestionId, LeftText, RightText, DisplayOrder, IsActive, UpdatedDate)
             VALUES
               (@questionId, @leftText, @rightText, @displayOrder, 1, NULL)`,
            [
              { name: "questionId", type: TYPES.Int, value: questionId },
              { name: "leftText", type: TYPES.NVarChar, value: q.pairs[j].leftText },
              { name: "rightText", type: TYPES.NVarChar, value: q.pairs[j].rightText },
              { name: "displayOrder", type: TYPES.Int, value: j },
            ]
          );
        }
        continue;
      }
      const optionCount = questionType === "TRUE_FALSE" ? 2 : 4;
      for (let j = 0; j < optionCount; j++) {
        await execQuery(
          `INSERT INTO dbo.QuizChoice
             (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES
             (@teacherId, @questionId, @choiceText, @isCorrect, @displayOrder)`,
          [
            { name: "teacherId", type: TYPES.Int, value: cls.TeacherId ?? null },
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "choiceText", type: TYPES.NVarChar, value: q.options[j] },
            { name: "isCorrect", type: TYPES.Bit, value: j === q.correctIndex ? 1 : 0 },
            { name: "displayOrder", type: TYPES.Int, value: j + 1 },
          ]
        );
      }
    }

    return res.status(201).json({
      message: "Mixed quiz created from AI history.",
      quizId,
      title: createdQuiz.rows[0]?.Title || quizTitle,
      sourceDictionaryIds: dictionaryIds,
      questionCount: dedupedQuestions.length,
      duplicateQuestionCount,
    });
  } catch (e) {
    return res.status(500).json({ message: "Failed to create mixed quiz from AI history.", detail: e.message });
  }
});

module.exports = router;

