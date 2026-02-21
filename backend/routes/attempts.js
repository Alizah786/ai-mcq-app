const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { TYPES } = require("tedious");

const router = express.Router();

router.use(requireAuth);

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
  if (req.user.role !== "Manager") return req.user.userId;
  const studentId = Number(studentIdRaw);
  if (!Number.isFinite(studentId) || studentId <= 0) return null;
  const owns = await managerOwnsStudent(req.user.userId, studentId);
  return owns ? studentId : null;
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** GET /api/reports/quiz-performance - manager report with optional class/student/quiz filters */
router.get("/reports/quiz-performance", async (req, res) => {
  if (req.user.role !== "Manager") {
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
  if (!attemptStudentId) {
    return res.status(400).json({ message: "Valid studentId is required for manager attempts." });
  }

  const quizRow = await execQuery(
    `SELECT q.QuizId, q.Title, q.Topic, q.ClassId, q.Status, q.CreateDate, q.LastModifiedDate, s.TeacherId
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

  const questions = await execQuery(
    `SELECT QuestionId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder
     FROM dbo.QuizQuestion
     WHERE QuizId = @quizId
       AND (@role = 'Manager' OR ISNULL(IsHiddenForStudent, 0) = 0)
     ORDER BY DisplayOrder, QuestionId`,
    [
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "role", type: TYPES.NVarChar, value: req.user.role },
    ]
  );
  if (!questions.rows.length) {
    return res.status(400).json({ message: "Quiz has no questions yet. Add questions before attempting." });
  }

  const createdAttempt = await execQuery(
    `INSERT INTO dbo.QuizAttempt (TeacherId, QuizId, StudentId, DisclaimerAcknowledgment)
     OUTPUT INSERTED.AttemptId, INSERTED.DisclaimerAcknowledgment
     VALUES (@managerId, @quizId, @studentId, @disclaimerAcknowledgment)`,
    [
      { name: "managerId", type: TYPES.Int, value: quizRow.rows[0].TeacherId ?? null },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "studentId", type: TYPES.Int, value: attemptStudentId },
      { name: "disclaimerAcknowledgment", type: TYPES.Bit, value: 1 },
    ]
  );
  const attemptId = createdAttempt.rows[0].AttemptId;

  const quiz = {
    quizId: quizIdNum,
    title: quizRow.rows[0].Title,
    description: quizRow.rows[0].Topic,
    createDate: quizRow.rows[0].CreateDate || null,
    lastModifiedDate: quizRow.rows[0].LastModifiedDate || null,
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
      isHiddenForStudent: !!q.IsHiddenForStudent,
      options: options.rows.map((o, i) => ({ optionId: o.ChoiceId, label: ["A", "B", "C", "D", "E", "F"][i] || String(i + 1), text: o.ChoiceText })),
    });
  }

  res.status(201).json({ attemptId, quiz });
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
  if (req.user.role === "Student" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (req.user.role === "Manager") {
    const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
    if (!owns) return res.status(403).json({ message: "Forbidden" });
  }

  await execQuery(
    "UPDATE dbo.QuizAttempt SET DisclaimerAcknowledgment = 1 WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );

  return res.json({ attemptId: attemptIdNum, disclaimerAcknowledged: true });
});

const SubmitBody = z.object({
  answers: z.array(
    z.object({
      questionId: z.number(),
      selectedOptionId: z.number().nullable(),
    })
  ),
});

/** POST /api/attempts/:attemptId/submit - Submit answers; server computes score. */
router.post("/attempts/:attemptId/submit", async (req, res) => {
  const attemptIdNum = parseInt(req.params.attemptId, 10);
  const body = SubmitBody.parse(req.body);

  const attempt = await execQuery(
    "SELECT AttemptId, QuizId, StudentId, SubmittedAtUtc, TeacherId FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];
  if (req.user.role === "Student" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (req.user.role === "Manager") {
    const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
    if (!owns) return res.status(403).json({ message: "Forbidden" });
  }
  if (row.SubmittedAtUtc) return res.status(400).json({ message: "Attempt already submitted" });
  await execQuery("DELETE FROM dbo.QuizAttemptAnswer WHERE AttemptId = @attemptId", [
    { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
  ]);
  const questions = await execQuery(
    "SELECT QuestionId, Points FROM dbo.QuizQuestion WHERE QuizId = @quizId AND ISNULL(IsHiddenForStudent, 0) = 0",
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );
  let score = 0;
  let total = 0;
  for (const q of questions.rows) {
    total += q.Points || 1;
    const correctOpt = await execQuery(
      "SELECT ChoiceId FROM dbo.QuizChoice WHERE QuestionId = @qid AND IsCorrect = 1",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    const correctOptionId = correctOpt.rows[0]?.ChoiceId ?? null;
    const selected = body.answers.find((a) => a.questionId === q.QuestionId)?.selectedOptionId ?? null;
    const isCorrect = correctOptionId != null && selected === correctOptionId;
    if (isCorrect) score += q.Points || 1;
    await execQuery(
      `INSERT INTO dbo.QuizAttemptAnswer (TeacherId, AttemptId, QuestionId, SelectedChoiceId, IsCorrect)
       VALUES (@managerId, @attemptId, @questionId, @selectedChoiceId, @isCorrect)`,
      [
        { name: "managerId", type: TYPES.Int, value: row.TeacherId ?? null },
        { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
        { name: "questionId", type: TYPES.Int, value: q.QuestionId },
        { name: "selectedChoiceId", type: TYPES.Int, value: selected },
        { name: "isCorrect", type: TYPES.Bit, value: isCorrect ? 1 : 0 },
      ]
    );
  }
  const scorePercent = total ? Math.round((score / total) * 10000) / 100 : 0;

  await execQuery(
    "UPDATE dbo.QuizAttempt SET SubmittedAtUtc = SYSUTCDATETIME(), Score = @score, TotalPoints = @total WHERE AttemptId = @attemptId",
    [
      { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
      { name: "score", type: TYPES.Int, value: score },
      { name: "total", type: TYPES.Int, value: total },
    ]
  );

  res.json({ attemptId: attemptIdNum, score, total, scorePercent });
});

/** GET /api/attempts/:attemptId/result - Get result with correct answers and explanations (after submit). */
router.get("/attempts/:attemptId/result", async (req, res) => {
  const attemptIdNum = parseInt(req.params.attemptId, 10);

  const attempt = await execQuery(
    "SELECT AttemptId, QuizId, StudentId, SubmittedAtUtc, Score, TotalPoints FROM dbo.QuizAttempt WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];
  if (req.user.role === "Student" && row.StudentId !== req.user.userId) return res.status(403).json({ message: "Forbidden" });
  if (req.user.role === "Manager") {
    const owns = await managerOwnsStudent(req.user.userId, row.StudentId);
    if (!owns) return res.status(403).json({ message: "Forbidden" });
  }
  if (!row.SubmittedAtUtc) return res.status(400).json({ message: "Attempt not yet submitted" });
  const score = row.Score ?? 0;
  const total = row.TotalPoints ?? 0;
  const scorePercent = total ? Math.round((score / total) * 10000) / 100 : 0;

  const answers = await execQuery(
    "SELECT QuestionId, SelectedChoiceId FROM dbo.QuizAttemptAnswer WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  const questions = await execQuery(
    "SELECT QuestionId, QuestionText, Explanation, DiagramType, DiagramData FROM dbo.QuizQuestion WHERE QuizId = @quizId ORDER BY DisplayOrder, QuestionId",
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );
  const details = [];
  for (const q of questions.rows) {
    const correctOpt = await execQuery(
      "SELECT ChoiceId FROM dbo.QuizChoice WHERE QuestionId = @qid AND IsCorrect = 1",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    const correctOptionId = correctOpt.rows[0]?.ChoiceId ?? null;
    const ans = answers.rows.find((a) => a.QuestionId === q.QuestionId);
    const selectedOptionId = ans?.SelectedChoiceId ?? null;
    details.push({
      questionId: q.QuestionId,
      questionText: q.QuestionText,
      diagramType: q.DiagramType || "none",
      diagramData: q.DiagramData || null,
      correctOptionId,
      selectedOptionId,
      explanation: q.Explanation,
    });
  }

  res.json({ score, total, scorePercent, details });
});

module.exports = router;

