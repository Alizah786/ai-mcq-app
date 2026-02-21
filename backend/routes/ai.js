const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { processAIGenerationJob, getAICapability } = require("../services/aiGenerator");
const {
  assertStudentCanCreateQuiz,
  assertManagerCanCreateQuiz,
  PaymentRequiredError,
} = require("../services/quizQuota");

const router = express.Router();
router.use(requireAuth);

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
  topic: z.string().trim().min(3).max(120),
  numQuestions: z.number().int().min(1).max(20).optional(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  disclaimerAcknowledged: z.boolean().optional(),
  studentId: z.number().int().positive().optional(),
});

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
    if (!body.disclaimerAcknowledged) {
      return res.status(400).json({ message: "AI disclaimer must be acknowledged before generating quiz." });
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
    await assertStudentCanCreateQuiz(targetStudentId, 1);
    if (req.user.role === "Manager") {
      await assertManagerCanCreateQuiz(req.user.userId, 1);
    }

    const created = await execQuery(
      `INSERT INTO dbo.AIGenerationJob (TeacherId, StudentId, ClassId, Topic, Prompt, NumQuestions, Difficulty, Status)
       OUTPUT INSERTED.JobId, INSERTED.Status, INSERTED.CreateDate, INSERTED.LastModifiedDate
      VALUES (@managerId, @studentId, @classId, @topic, @prompt, @numQuestions, @difficulty, 'Queued')`,
      [
        { name: "managerId", type: TYPES.Int, value: targetTeacherId },
        { name: "studentId", type: TYPES.Int, value: targetStudentId },
        { name: "classId", type: TYPES.Int, value: body.classId },
        { name: "topic", type: TYPES.NVarChar, value: body.topic },
        { name: "prompt", type: TYPES.NVarChar, value: `Generate MCQ quiz for: ${body.topic}` },
        { name: "numQuestions", type: TYPES.Int, value: body.numQuestions || 5 },
        { name: "difficulty", type: TYPES.NVarChar, value: body.difficulty || "Medium" },
      ]
    );
    const row = created.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to create AI job" });

    setImmediate(() => {
      processAIGenerationJob(row.JobId).catch(() => {});
    });

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
    errorMessage: row.ErrorMessage,
    createDate: row.CreateDate || null,
    lastModifiedDate: row.LastModifiedDate || null,
    createdAtUtc: row.CreateDate || null,
    completedAtUtc: row.CompletedAtUtc,
    studentId: row.StudentId,
  });
});

module.exports = router;

