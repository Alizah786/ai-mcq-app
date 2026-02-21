const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const { TYPES } = require("tedious");

const router = express.Router();

router.use(requireAuth);

/** GET /api/classes/:classId/quizzes - list all quizzes in class (Draft + Published) */
router.get("/classes/:classId/quizzes", async (req, res) => {
  const classIdNum = parseInt(req.params.classId, 10);
  const member = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: classIdNum },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!member.rows.length) return res.status(404).json({ message: "Class not found" });
  const q = await execQuery(
    "SELECT QuizId, ClassId, Title, Description, Status, CreatedAtUtc FROM dbo.Quizzes WHERE ClassId = @classId ORDER BY Title",
    [{ name: "classId", type: TYPES.Int, value: classIdNum }]
  );
  res.json({ quizzes: q.rows.map((r) => ({ quizId: r.QuizId, classId: r.ClassId, title: r.Title, description: r.Description, status: r.Status, createdAtUtc: r.CreatedAtUtc })) });
});

const CreateQuizBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
});

/** POST /api/classes/:classId/quizzes - Any class member can create draft quiz. */
router.post("/classes/:classId/quizzes", async (req, res) => {
  const { classId } = req.params;
  const body = CreateQuizBody.parse(req.body);
  const classIdNum = parseInt(classId, 10);
  const member = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: classIdNum },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!member.rows.length) return res.status(403).json({ message: "Not a member of this class" });
  const inserted = await execQuery(
    `INSERT INTO dbo.Quizzes (ClassId, Title, Description, Status, CreatedByUserId)
     OUTPUT INSERTED.QuizId, INSERTED.Title, INSERTED.Description, INSERTED.Status
     VALUES (@classId, @title, @description, 'Draft', @userId)`,
    [
      { name: "classId", type: TYPES.Int, value: classIdNum },
      { name: "title", type: TYPES.NVarChar, value: body.title },
      { name: "description", type: TYPES.NVarChar, value: body.description || null },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  const row = inserted.rows[0];
  if (!row) return res.status(500).json({ message: "Failed to create quiz" });
  res.status(201).json({ quizId: row.QuizId, title: row.Title, description: row.Description, status: row.Status });
});

const UpdateQuizBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
});

/** PUT /api/quizzes/:quizId - Update draft quiz (any class member). */
router.put("/quizzes/:quizId", async (req, res) => {
  const { quizId } = req.params;
  const body = UpdateQuizBody.parse(req.body);
  const quizIdNum = parseInt(quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, Status, ClassId FROM dbo.Quizzes WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const member = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: quiz.rows[0].ClassId },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!member.rows.length) return res.status(403).json({ message: "Forbidden" });
  if (body.title != null) {
    await execQuery("UPDATE dbo.Quizzes SET Title = @title WHERE QuizId = @quizId", [
      { name: "title", type: TYPES.NVarChar, value: body.title },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  if (body.description !== undefined) {
    await execQuery("UPDATE dbo.Quizzes SET Description = @description WHERE QuizId = @quizId", [
      { name: "description", type: TYPES.NVarChar, value: body.description || null },
      { name: "quizId", type: TYPES.Int, value: quizIdNum },
    ]);
  }
  const updated = await execQuery(
    "SELECT QuizId, Title, Description, Status FROM dbo.Quizzes WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  const row = updated.rows[0];
  res.json({ quizId: row.QuizId, title: row.Title, description: row.Description, status: row.Status });
});

/** POST /api/quizzes/:quizId/publish - Any class member can publish. */
router.post("/quizzes/:quizId/publish", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, Status, ClassId FROM dbo.Quizzes WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  const member = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: quiz.rows[0].ClassId },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!member.rows.length) return res.status(403).json({ message: "Forbidden" });
  await execQuery(
    "UPDATE dbo.Quizzes SET Status = 'Published', PublishedAtUtc = SYSUTCDATETIME() WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  res.json({ quizId: quizIdNum, status: "Published" });
});

/** GET /api/quizzes/:quizId - Get quiz for editing (questions + options including isCorrect). Draft only, class member. */
router.get("/quizzes/:quizId", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, Title, Description, Status, ClassId FROM dbo.Quizzes WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const member = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: quiz.rows[0].ClassId },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!member.rows.length) return res.status(403).json({ message: "Forbidden" });
  const questions = await execQuery(
    "SELECT QuestionId, QuestionText, Explanation, Difficulty, TopicTag, SortOrder FROM dbo.Questions WHERE QuizId = @quizId ORDER BY SortOrder, QuestionId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  const result = {
    quizId: quizIdNum,
    title: quiz.rows[0].Title,
    description: quiz.rows[0].Description,
    status: quiz.rows[0].Status,
    questions: [],
  };
  for (const q of questions.rows) {
    const opts = await execQuery(
      "SELECT OptionId, OptionLabel, OptionText, IsCorrect, SortOrder FROM dbo.Options WHERE QuestionId = @qid ORDER BY SortOrder, OptionId",
      [{ name: "qid", type: TYPES.Int, value: q.QuestionId }]
    );
    result.questions.push({
      questionId: q.QuestionId,
      questionText: q.QuestionText,
      explanation: q.Explanation,
      options: opts.rows.map((o) => ({ optionId: o.OptionId, label: o.OptionLabel, text: o.OptionText, isCorrect: !!o.IsCorrect })),
    });
  }
  res.json(result);
});

const QuizContentBody = z.object({
  questions: z.array(
    z.object({
      questionText: z.string().min(1).max(2000),
      explanation: z.string().max(2000).optional().nullable(),
      options: z
        .array(
          z.object({
            label: z.string().max(5),
            text: z.string().min(1).max(1000),
            isCorrect: z.boolean(),
          })
        )
        .min(1)
        .max(20),
    })
  ),
});

/** PUT /api/quizzes/:quizId/content - Save quiz content (input quiz). Draft only, class member. Replaces all questions/options. */
router.put("/quizzes/:quizId/content", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, Status, ClassId FROM dbo.Quizzes WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const member = await execQuery(
    "SELECT 1 FROM dbo.ClassMembers WHERE ClassId = @classId AND UserId = @userId",
    [
      { name: "classId", type: TYPES.Int, value: quiz.rows[0].ClassId },
      { name: "userId", type: TYPES.Int, value: req.user.userId },
    ]
  );
  if (!member.rows.length) return res.status(403).json({ message: "Forbidden" });
  const body = QuizContentBody.parse(req.body);
  await execQuery("DELETE FROM dbo.Options WHERE QuestionId IN (SELECT QuestionId FROM dbo.Questions WHERE QuizId = @quizId)", [
    { name: "quizId", type: TYPES.Int, value: quizIdNum },
  ]);
  await execQuery("DELETE FROM dbo.Questions WHERE QuizId = @quizId", [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]);
  for (let i = 0; i < body.questions.length; i++) {
    const q = body.questions[i];
    const inserted = await execQuery(
      `INSERT INTO dbo.Questions (QuizId, QuestionText, Explanation, SortOrder)
       OUTPUT INSERTED.QuestionId
       VALUES (@quizId, @text, @explanation, @sortOrder)`,
      [
        { name: "quizId", type: TYPES.Int, value: quizIdNum },
        { name: "text", type: TYPES.NVarChar, value: q.questionText },
        { name: "explanation", type: TYPES.NVarChar, value: q.explanation || null },
        { name: "sortOrder", type: TYPES.Int, value: i },
      ]
    );
    const questionId = inserted.rows[0].QuestionId;
    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];
    for (let j = 0; j < q.options.length; j++) {
      const o = q.options[j];
      await execQuery(
        "INSERT INTO dbo.Options (QuestionId, OptionLabel, OptionText, IsCorrect, SortOrder) VALUES (@qid, @label, @text, @isCorrect, @sortOrder)",
        [
          { name: "qid", type: TYPES.Int, value: questionId },
          { name: "label", type: TYPES.NVarChar, value: o.label || labels[j] || String(j + 1) },
          { name: "text", type: TYPES.NVarChar, value: o.text },
          { name: "isCorrect", type: TYPES.Bit, value: o.isCorrect ? 1 : 0 },
          { name: "sortOrder", type: TYPES.Int, value: j },
        ]
      );
    }
  }
  res.json({ quizId: quizIdNum, questionCount: body.questions.length });
});

module.exports = router;
