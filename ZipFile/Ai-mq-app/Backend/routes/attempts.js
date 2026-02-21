const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { TYPES } = require("tedious");

const router = express.Router();

router.use(requireAuth);

/** POST /api/quizzes/:quizId/attempts/start - Any class member can start (quiz must be Published). */
router.post("/quizzes/:quizId/attempts/start", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const userId = req.user.userId;

  const quizRow = await execQuery(
    "SELECT QuizId, Title, Description, ClassId, Status FROM dbo.Quizzes WHERE QuizId = @quizId AND Status = 'Published'",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quizRow.rows.length) {
    return res.status(404).json({ message: "Quiz not found or not published" });
  }
  const member = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: quizRow.rows[0].ClassId },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );
  if (!member.rows.length) {
    return res.status(403).json({ message: "You are not in this class" });
  }

  const inserted = await execQuery(
    `INSERT INTO dbo.Attempts (QuizId, UserId, Status)
     OUTPUT INSERTED.AttemptId
     VALUES (@quizId, @userId, 'InProgress')`,
    [
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
      { name: "userId", type: TYPES.Int, value: userId },
    ]
  );
  const attemptId = inserted.rows[0].AttemptId;

  const questions = await execQuery(
    "SELECT QuestionId, QuestionText, Explanation, Difficulty, TopicTag, SortOrder FROM dbo.Questions WHERE QuizId = @quizId ORDER BY SortOrder, QuestionId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  const quiz = {
    quizId: quizIdNum,
    title: quizRow.rows[0].Title,
    description: quizRow.rows[0].Description,
    questions: [],
  };
  for (const q of questions.rows) {
    const options = await execQuery(
      "SELECT OptionId, OptionLabel, OptionText FROM dbo.Options WHERE QuestionId = @qid ORDER BY SortOrder, OptionId",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    quiz.questions.push({
      questionId: q.QuestionId,
      questionText: q.QuestionText,
      options: options.rows.map((o) => ({ optionId: o.OptionId, label: o.OptionLabel, text: o.OptionText })),
    });
  }

  res.status(201).json({ attemptId, quiz });
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
  const userId = req.user.userId;
  const body = SubmitBody.parse(req.body);

  const attempt = await execQuery(
    "SELECT AttemptId, QuizId, UserId, Status FROM dbo.Attempts WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];
  if (row.UserId !== userId) return res.status(403).json({ message: "Forbidden" });
  if (row.Status !== "InProgress") return res.status(400).json({ message: "Attempt already submitted" });

  await execQuery("DELETE FROM dbo.AttemptAnswers WHERE AttemptId = @attemptId", [
    { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
  ]);
  for (const a of body.answers) {
    await execQuery(
      `INSERT INTO dbo.AttemptAnswers (AttemptId, QuestionId, SelectedOptionId)
       VALUES (@attemptId, @questionId, @selectedOptionId)`,
      [
        { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
        { name: "questionId", type: TYPES.Int, value: a.questionId },
        { name: "selectedOptionId", type: TYPES.Int, value: a.selectedOptionId },
      ]
    );
  }

  const questions = await execQuery(
    "SELECT QuestionId FROM dbo.Questions WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );
  let correctCount = 0;
  for (const q of questions.rows) {
    const correctOpt = await execQuery(
      "SELECT OptionId FROM dbo.Options WHERE QuestionId = @qid AND IsCorrect = 1",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    const correctOptionId = correctOpt.rows[0]?.OptionId;
    const selected = body.answers.find((a) => a.questionId === q.QuestionId)?.selectedOptionId ?? null;
    if (correctOptionId != null && selected === correctOptionId) correctCount++;
  }
  const total = questions.rows.length;
  const scorePercent = total ? Math.round((correctCount / total) * 10000) / 100 : 0;

  await execQuery(
    "UPDATE dbo.Attempts SET SubmittedAtUtc = SYSUTCDATETIME(), Status = 'Submitted' WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  await execQuery(
    "INSERT INTO dbo.Marks (AttemptId, TotalQuestions, CorrectCount, ScorePercent) VALUES (@attemptId, @total, @correct, @percent)",
    [
      { name: "attemptId", type: TYPES.Int, value: attemptIdNum },
      { name: "total", type: TYPES.Int, value: total },
      { name: "correct", type: TYPES.Int, value: correctCount },
      { name: "percent", type: TYPES.Decimal, value: scorePercent, options: { precision: 5, scale: 2 } },
    ]
  );

  res.json({ attemptId: attemptIdNum, score: correctCount, total, scorePercent });
});

/** GET /api/attempts/:attemptId/result - Get result with correct answers and explanations (after submit). */
router.get("/attempts/:attemptId/result", async (req, res) => {
  const attemptIdNum = parseInt(req.params.attemptId, 10);
  const userId = req.user.userId;

  const attempt = await execQuery(
    "SELECT AttemptId, QuizId, UserId, Status FROM dbo.Attempts WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  if (!attempt.rows.length) return res.status(404).json({ message: "Attempt not found" });
  const row = attempt.rows[0];
  if (row.UserId !== userId) return res.status(403).json({ message: "Forbidden" });
  if (row.Status !== "Submitted") return res.status(400).json({ message: "Attempt not yet submitted" });

  const marks = await execQuery(
    "SELECT TotalQuestions, CorrectCount, ScorePercent FROM dbo.Marks WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  const m = marks.rows[0];
  const score = m.CorrectCount;
  const total = m.TotalQuestions;
  const scorePercent = m.ScorePercent;

  const answers = await execQuery(
    "SELECT QuestionId, SelectedOptionId FROM dbo.AttemptAnswers WHERE AttemptId = @attemptId",
    [{ name: "attemptId", type: TYPES.Int, value: attemptIdNum }]
  );
  const questions = await execQuery(
    "SELECT QuestionId, QuestionText, Explanation FROM dbo.Questions WHERE QuizId = @quizId ORDER BY SortOrder, QuestionId",
    [{ name: "quizId", type: TYPES.Int, value: row.QuizId }]
  );
  const details = [];
  for (const q of questions.rows) {
    const correctOpt = await execQuery(
      "SELECT OptionId FROM dbo.Options WHERE QuestionId = @qid AND IsCorrect = 1",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    const correctOptionId = correctOpt.rows[0]?.OptionId ?? null;
    const ans = answers.rows.find((a) => a.QuestionId === q.QuestionId);
    const selectedOptionId = ans?.SelectedOptionId ?? null;
    details.push({
      questionId: q.QuestionId,
      questionText: q.QuestionText,
      correctOptionId,
      selectedOptionId,
      explanation: q.Explanation,
    });
  }

  res.json({ score, total, scorePercent, details });
});

module.exports = router;
