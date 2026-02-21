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
const { validateEducationalQuizEntry } = require("../services/contentPolicy");

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

async function getQuizScopeForManager(managerId, quizId) {
  const quiz = await execQuery(
    `SELECT q.QuizId, q.ClassId, q.TeacherId, q.Title, q.Topic, q.Difficulty, q.SourceType, q.Status,
            q.ParentQuizId, q.IsTeacherEdited, q.RequiresTeacherReview, q.TeacherReviewed, q.TeacherReviewedByTeacherId, q.TeacherReviewedAtUtc
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
  const quiz = await execQuery(
    `SELECT QuizId, ClassId, Title, Topic, Difficulty, SourceType, Status, ParentQuizId,
            IsTeacherEdited, RequiresTeacherReview, TeacherReviewed, TeacherReviewedAtUtc
     FROM dbo.Quiz
     WHERE QuizId = @quizId`,
    [{ name: "quizId", type: TYPES.Int, value: quizId }]
  );
  const quizRow = quiz.rows[0] || null;
  if (!quizRow) return null;

  const questions = await execQuery(
    `SELECT QuestionId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder
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
      isHiddenForStudent: !!q.IsHiddenForStudent,
      options: opts.rows.map((o, i) => ({
        optionId: o.ChoiceId,
        label: ["A", "B", "C", "D", "E", "F"][i] || String(i + 1),
        text: o.ChoiceText,
        isCorrect: !!o.IsCorrect,
      })),
    });
  }
  return result;
}

async function replaceQuizContent(quizId, managerId, questions) {
  await execQuery("DELETE FROM dbo.QuizChoice WHERE QuestionId IN (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId = @quizId)", [
    { name: "quizId", type: TYPES.Int, value: quizId },
  ]);
  await execQuery("DELETE FROM dbo.QuizQuestion WHERE QuizId = @quizId", [{ name: "quizId", type: TYPES.Int, value: quizId }]);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const inserted = await execQuery(
      `INSERT INTO dbo.QuizQuestion (TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder)
       OUTPUT INSERTED.QuestionId
       VALUES (@managerId, @quizId, @text, @explanation, @diagramType, @diagramData, @isHiddenForStudent, @displayOrder)`,
      [
        { name: "managerId", type: TYPES.Int, value: managerId },
        { name: "quizId", type: TYPES.Int, value: quizId },
        { name: "text", type: TYPES.NVarChar, value: q.questionText },
        { name: "explanation", type: TYPES.NVarChar, value: q.explanation || null },
        { name: "diagramType", type: TYPES.NVarChar, value: q.diagramType || "none" },
        { name: "diagramData", type: TYPES.NVarChar, value: q.diagramData || null },
        { name: "isHiddenForStudent", type: TYPES.Bit, value: q.isHiddenForStudent ? 1 : 0 },
        { name: "displayOrder", type: TYPES.Int, value: i + 1 },
      ]
    );
    const questionId = inserted.rows[0].QuestionId;
    for (let j = 0; j < q.options.length; j++) {
      const o = q.options[j];
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
    const existingChild = await execQuery(
      `SELECT TOP 1 QuizId, ClassId, TeacherId, Title, Topic, Difficulty, SourceType, Status, ParentQuizId,
              IsTeacherEdited, RequiresTeacherReview, TeacherReviewed, TeacherReviewedByTeacherId, TeacherReviewedAtUtc
       FROM dbo.Quiz
       WHERE ParentQuizId = @parentQuizId
       ORDER BY QuizId DESC`,
      [{ name: "parentQuizId", type: TYPES.Int, value: sourceQuizId }]
    );
    if (existingChild.rows.length) {
      workingQuiz = existingChild.rows[0];
    } else {
      const created = await execQuery(
        `INSERT INTO dbo.Quiz
           (TeacherId, ClassId, Title, Topic, Difficulty, SourceType, Status, ParentQuizId, IsTeacherEdited, RequiresTeacherReview, TeacherReviewed)
         OUTPUT INSERTED.QuizId, INSERTED.ClassId, INSERTED.TeacherId, INSERTED.Title, INSERTED.Topic, INSERTED.Difficulty,
                INSERTED.SourceType, INSERTED.Status, INSERTED.ParentQuizId, INSERTED.IsTeacherEdited, INSERTED.RequiresTeacherReview, INSERTED.TeacherReviewed
         VALUES
           (@managerId, @classId, @title, @topic, @difficulty, @sourceType, 'Draft', @parentQuizId, 1, 1, 0)`,
        [
          { name: "managerId", type: TYPES.Int, value: managerId },
          { name: "classId", type: TYPES.Int, value: sourceQuiz.ClassId },
          { name: "title", type: TYPES.NVarChar, value: sourceQuiz.Title },
          { name: "topic", type: TYPES.NVarChar, value: sourceQuiz.Topic || null },
          { name: "difficulty", type: TYPES.NVarChar, value: sourceQuiz.Difficulty || null },
          { name: "sourceType", type: TYPES.NVarChar, value: sourceQuiz.SourceType || "AI_Topic" },
          { name: "parentQuizId", type: TYPES.Int, value: sourceQuizId },
        ]
      );
      workingQuiz = created.rows[0];

      const sourceContent = await loadQuizContent(sourceQuizId);
      await replaceQuizContent(workingQuiz.QuizId, managerId, sourceContent?.questions || []);
      await execQuery(
        `INSERT INTO dbo.QuizChangeLog (TeacherId, QuizId, FieldName, ActionType, OldValue, NewValue)
         VALUES (@managerId, @quizId, @fieldName, @actionType, @oldValue, @newValue)`,
        [
          { name: "managerId", type: TYPES.Int, value: managerId },
          { name: "quizId", type: TYPES.Int, value: workingQuiz.QuizId },
          { name: "fieldName", type: TYPES.NVarChar, value: "ReviewCloneCreated" },
          { name: "actionType", type: TYPES.NVarChar, value: "ManagerEdit" },
          { name: "oldValue", type: TYPES.NVarChar, value: null },
          { name: "newValue", type: TYPES.NVarChar, value: `Created from original AI quiz ${sourceQuizId}` },
        ]
      );
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
  disclaimerAcknowledged: z.boolean().optional(),
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
    await assertStudentCanCreateQuiz(targetStudentId, 1);
    if (req.user.role === "Manager") {
      await assertManagerCanCreateQuiz(req.user.userId, 1);
    }

    const inserted = await execQuery(
      `INSERT INTO dbo.Quiz (TeacherId, ClassId, Title, Topic, SourceType, Status)
       OUTPUT INSERTED.QuizId, INSERTED.Title, INSERTED.Topic, INSERTED.Status
       VALUES (@managerId, @classId, @title, @topic, 'Manual', 'Draft')`,
      [
        { name: "managerId", type: TYPES.Int, value: targetTeacherId },
        { name: "classId", type: TYPES.Int, value: classIdNum },
        { name: "title", type: TYPES.NVarChar, value: body.title },
        { name: "topic", type: TYPES.NVarChar, value: body.description || null },
      ]
    );
    const row = inserted.rows[0];
    if (!row) return res.status(500).json({ message: "Failed to create quiz" });
    res.status(201).json({ quizId: row.QuizId, title: row.Title, description: row.Topic, status: row.Status });
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
});

/** PUT /api/quizzes/:quizId - Update draft quiz (any class member). */
router.put("/quizzes/:quizId", async (req, res) => {
  const { quizId } = req.params;
  const body = UpdateQuizBody.parse(req.body);
  const quizIdNum = parseInt(quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, Status, ClassId, TeacherId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
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
  const updated = await execQuery(
    "SELECT QuizId, Title, Topic, Status FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  const row = updated.rows[0];
  res.json({ quizId: row.QuizId, title: row.Title, description: row.Topic, status: row.Status });
});

/** POST /api/quizzes/:quizId/publish - Any class member can publish. */
router.post("/quizzes/:quizId/publish", async (req, res) => {
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

  await execQuery(
    "UPDATE dbo.Quiz SET Status = 'Ready' WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  res.json({ quizId: quizIdNum, status: "Ready" });
});

const ManagerReviewSaveBody = z.object({
  questions: z.array(
    z.object({
      questionText: z.string().min(1).max(2000),
      explanation: z.string().max(2000).optional().nullable(),
      diagramType: z.enum(["none", "svg", "mermaid"]).optional().nullable(),
      diagramData: z.string().max(20000).optional().nullable(),
      isHiddenForStudent: z.boolean().optional(),
      options: z
        .array(
          z.object({
            label: z.string().max(5).optional(),
            text: z.string().min(1).max(1000),
            isCorrect: z.boolean(),
          })
        )
        .min(1)
        .max(20),
    })
  ),
});

const ManagerReviewPublishBody = z.object({
  approved: z.boolean(),
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

  return res.json({
    reviewMode: !!context.needsManagerReview,
    sourceQuizId: context.sourceQuizId,
    workingQuizId: context.workingQuizId,
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
  await replaceQuizContent(context.workingQuizId, req.user.userId, body.questions);
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

  await execQuery(
    `UPDATE dbo.Quiz
     SET Status = 'Ready',
         IsTeacherEdited = 1,
         RequiresTeacherReview = 0,
         TeacherReviewed = 1,
         TeacherReviewedByTeacherId = @managerId,
         TeacherReviewedAtUtc = SYSUTCDATETIME()
     WHERE QuizId = @quizId`,
    [
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

  // Clear AI job references first to avoid FK NO ACTION delete failure.
  await execQuery(
    "UPDATE dbo.AIGenerationJob SET ResultQuizId = NULL WHERE ResultQuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );

  await execQuery(
    "DELETE FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  return res.json({ message: "Quiz deleted", quizId: quizIdNum });
});

/** GET /api/quizzes/:quizId - Get quiz for editing (questions + options including isCorrect). Draft only, class member. */
router.get("/quizzes/:quizId", async (req, res) => {
  const quizIdNum = parseInt(req.params.quizId, 10);
  const quiz = await execQuery(
    "SELECT QuizId, Title, Topic, Status, ClassId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });
  const questions = await execQuery(
    "SELECT QuestionId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder FROM dbo.QuizQuestion WHERE QuizId = @quizId ORDER BY DisplayOrder, QuestionId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  const result = {
    quizId: quizIdNum,
    title: quiz.rows[0].Title,
    description: quiz.rows[0].Topic,
    status: quiz.rows[0].Status,
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
      explanation: q.Explanation,
      diagramType: q.DiagramType || "none",
      diagramData: q.DiagramData || null,
      isHiddenForStudent: !!q.IsHiddenForStudent,
      options: opts.rows.map((o, i) => ({ optionId: o.ChoiceId, label: ["A", "B", "C", "D", "E", "F"][i] || String(i + 1), text: o.ChoiceText, isCorrect: !!o.IsCorrect })),
    });
  }
  res.json(result);
});

const QuizContentBody = z.object({
  questions: z.array(
    z.object({
      questionText: z.string().min(1).max(2000),
      explanation: z.string().max(2000).optional().nullable(),
      diagramType: z.enum(["none", "svg", "mermaid"]).optional().nullable(),
      diagramData: z.string().max(20000).optional().nullable(),
      isHiddenForStudent: z.boolean().optional(),
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
    "SELECT QuizId, Status, ClassId FROM dbo.Quiz WHERE QuizId = @quizId",
    [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]
  );
  if (!quiz.rows.length) return res.status(404).json({ message: "Quiz not found" });
  if (quiz.rows[0].Status !== "Draft") return res.status(400).json({ message: "Only draft quizzes can be edited" });
  const owner = await canAccessClass(req, quiz.rows[0].ClassId);
  if (!owner) return res.status(403).json({ message: "Forbidden" });
  const body = QuizContentBody.parse(req.body);
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
  await execQuery("DELETE FROM dbo.QuizChoice WHERE QuestionId IN (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId = @quizId)", [
    { name: "quizId", type: TYPES.Int, value: quizIdNum },
  ]);
  await execQuery("DELETE FROM dbo.QuizQuestion WHERE QuizId = @quizId", [{ name: "quizId", type: TYPES.Int, value: quizIdNum }]);
  for (let i = 0; i < body.questions.length; i++) {
    const q = body.questions[i];
    const inserted = await execQuery(
      `INSERT INTO dbo.QuizQuestion (TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, IsHiddenForStudent, DisplayOrder)
       OUTPUT INSERTED.QuestionId
       VALUES (@managerId, @quizId, @text, @explanation, @diagramType, @diagramData, @isHiddenForStudent, @displayOrder)`,
      [
        { name: "managerId", type: TYPES.Int, value: quiz.rows[0].TeacherId ?? null },
        { name: "quizId", type: TYPES.Int, value: quizIdNum },
        { name: "text", type: TYPES.NVarChar, value: q.questionText },
        { name: "explanation", type: TYPES.NVarChar, value: q.explanation || null },
        { name: "diagramType", type: TYPES.NVarChar, value: q.diagramType || "none" },
        { name: "diagramData", type: TYPES.NVarChar, value: q.diagramData || null },
        { name: "isHiddenForStudent", type: TYPES.Bit, value: q.isHiddenForStudent ? 1 : 0 },
        { name: "displayOrder", type: TYPES.Int, value: i + 1 },
      ]
    );
    const questionId = inserted.rows[0].QuestionId;
    for (let j = 0; j < q.options.length; j++) {
      const o = q.options[j];
      await execQuery(
        "INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder) VALUES (@managerId, @qid, @text, @isCorrect, @displayOrder)",
        [
          { name: "managerId", type: TYPES.Int, value: quiz.rows[0].TeacherId ?? null },
          { name: "qid", type: TYPES.Int, value: questionId },
          { name: "text", type: TYPES.NVarChar, value: o.text },
          { name: "isCorrect", type: TYPES.Bit, value: o.isCorrect ? 1 : 0 },
          { name: "displayOrder", type: TYPES.Int, value: j + 1 },
        ]
      );
    }
  }
  res.json({ quizId: quizIdNum, questionCount: body.questions.length });
});

/** GET /api/quizzes/:quizId/assignments/students - manager sees assignable students with current selections */
router.get("/quizzes/:quizId/assignments/students", async (req, res) => {
  if (req.user.role !== "Manager") return res.status(403).json({ message: "Only teacher can manage assignments." });

  const quizIdNum = parseInt(req.params.quizId, 10);
  if (!Number.isFinite(quizIdNum)) return res.status(400).json({ message: "Invalid quiz id" });

  const quizScope = await execQuery(
    `SELECT q.QuizId, q.Title
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

  const students = await execQuery(
    `SELECT StudentId, FullName, Email, IsActive
     FROM dbo.Student
     WHERE TeacherId = @managerId
     ORDER BY FullName, StudentId`,
    [{ name: "managerId", type: TYPES.Int, value: req.user.userId }]
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

