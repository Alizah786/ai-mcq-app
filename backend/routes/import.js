const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth, hashPassword } = require("../auth");
const {
  assertStudentCanCreateQuiz,
  assertManagerCanCreateQuiz,
  PaymentRequiredError,
} = require("../services/quizQuota");
const { validateEducationalQuizEntry } = require("../services/contentPolicy");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

function randomJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function normalizeKey(k) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getValue(row, aliases) {
  for (const key of Object.keys(row)) {
    const nk = normalizeKey(key);
    if (aliases.includes(nk)) return row[key];
  }
  return undefined;
}

function toText(v) {
  if (v == null) return "";
  return String(v).trim();
}

function parseCorrectOption(value) {
  const v = toText(value).toUpperCase();
  if (["A", "B", "C", "D"].includes(v)) return v;
  if (["1", "2", "3", "4"].includes(v)) return ["A", "B", "C", "D"][Number(v) - 1];
  return null;
}

function parseQuizLimit(value) {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 40;
  return Math.trunc(n);
}

/** POST /api/import/excel - upload quiz rows from Excel for current student */
router.post("/import/excel", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "Excel file is required. Use multipart field name 'file'." });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return res.status(400).json({ message: "Excel has no sheets." });
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) return res.status(400).json({ message: "Excel sheet has no rows." });

    let studentId = req.user.userId;
    let managerId = null;
    if (req.user.role === "Manager") {
      const requestedStudentId = Number(req.body.studentId);
      if (!Number.isFinite(requestedStudentId) || requestedStudentId <= 0) {
        return res.status(400).json({ message: "studentId is required for manager import." });
      }
      const scope = await execQuery(
        "SELECT TeacherId FROM dbo.Student WHERE StudentId = @studentId AND TeacherId = @managerId AND IsActive = 1",
        [
          { name: "studentId", type: TYPES.Int, value: requestedStudentId },
          { name: "managerId", type: TYPES.Int, value: req.user.userId },
        ]
      );
      if (!scope.rows.length) return res.status(403).json({ message: "Forbidden student scope" });
      studentId = requestedStudentId;
      managerId = scope.rows[0].TeacherId ?? req.user.userId;
    } else {
      const studentScope = await execQuery(
        "SELECT TeacherId FROM dbo.Student WHERE StudentId = @studentId",
        [{ name: "studentId", type: TYPES.Int, value: studentId }]
      );
      managerId = studentScope.rows[0]?.TeacherId ?? null;
    }
    const existingClassesResult = await execQuery(
      "SELECT ClassId, ClassName FROM dbo.Class WHERE StudentId = @studentId",
      [{ name: "studentId", type: TYPES.Int, value: studentId }]
    );
    const classCache = new Map();
    for (const row of existingClassesResult.rows) {
      const key = toText(row.ClassName).toLowerCase();
      if (key && !classCache.has(key)) {
        classCache.set(key, row.ClassId);
      }
    }
    const unknownClasses = new Set();
    const quizCache = new Map();
    const displayOrderByQuiz = new Map();
    let newQuizzesCreated = 0;

    let importedQuestions = 0;
    const touchedClasses = new Set();
    const touchedQuizzes = new Set();

    for (const raw of rows) {
      const className = toText(getValue(raw, ["classname", "class"]));
      const quizTitle = toText(getValue(raw, ["quizname", "quiztitle", "quiz"]));
      const questionText = toText(getValue(raw, ["question", "questiontext", "mcq"]));
      const explanation = toText(getValue(raw, ["explanation", "answerexplanation"])) || null;
      const topic = toText(getValue(raw, ["topic"]));
      const difficulty = toText(getValue(raw, ["difficulty"]));

      const optionA = toText(getValue(raw, ["optiona", "a"]));
      const optionB = toText(getValue(raw, ["optionb", "b"]));
      const optionC = toText(getValue(raw, ["optionc", "c"]));
      const optionD = toText(getValue(raw, ["optiond", "d"]));
      const correctLabel = parseCorrectOption(getValue(raw, ["correctoption", "correct", "answer"]));

      if (!className || !quizTitle || !questionText) {
        continue;
      }
      if (!optionA || !optionB || !optionC || !optionD || !correctLabel) {
        continue;
      }
      const policyError = validateEducationalQuizEntry({
        quizTitle,
        topic,
        questionText,
        explanation,
        options: [optionA, optionB, optionC, optionD],
      });
      if (policyError) {
        continue;
      }

      const classKey = className.toLowerCase();
      if (!classCache.has(classKey)) {
        unknownClasses.add(className);
      }
    }

    if (unknownClasses.size) {
      return res.status(400).json({
        message: `Unknown class name(s): ${Array.from(unknownClasses).join(", ")}. Create class first, then import again.`,
      });
    }

    for (const raw of rows) {
      const className = toText(getValue(raw, ["classname", "class"]));
      const quizTitle = toText(getValue(raw, ["quizname", "quiztitle", "quiz"]));
      const questionText = toText(getValue(raw, ["question", "questiontext", "mcq"]));
      const explanation = toText(getValue(raw, ["explanation", "answerexplanation"])) || null;
      const topic = toText(getValue(raw, ["topic"]));
      const difficulty = toText(getValue(raw, ["difficulty"]));

      const optionA = toText(getValue(raw, ["optiona", "a"]));
      const optionB = toText(getValue(raw, ["optionb", "b"]));
      const optionC = toText(getValue(raw, ["optionc", "c"]));
      const optionD = toText(getValue(raw, ["optiond", "d"]));
      const correctLabel = parseCorrectOption(getValue(raw, ["correctoption", "correct", "answer"]));

      if (!className || !quizTitle || !questionText) {
        continue;
      }
      if (!optionA || !optionB || !optionC || !optionD || !correctLabel) {
        continue;
      }
      const policyError = validateEducationalQuizEntry({
        quizTitle,
        topic,
        questionText,
        explanation,
        options: [optionA, optionB, optionC, optionD],
      });
      if (policyError) {
        continue;
      }

      const classId = classCache.get(className.toLowerCase());
      touchedClasses.add(classId);

      const quizKey = `${classId}::${quizTitle.toLowerCase()}`;
      let quizId = quizCache.get(quizKey);
      if (!quizId) {
        const existingQuiz = await execQuery(
          "SELECT TOP 1 QuizId FROM dbo.Quiz WHERE ClassId = @classId AND Title = @title ORDER BY QuizId",
          [
            { name: "classId", type: TYPES.Int, value: classId },
            { name: "title", type: TYPES.NVarChar, value: quizTitle },
          ]
        );
        if (existingQuiz.rows.length) {
          quizId = existingQuiz.rows[0].QuizId;
          await execQuery("DELETE FROM dbo.QuizChoice WHERE QuestionId IN (SELECT QuestionId FROM dbo.QuizQuestion WHERE QuizId = @quizId)", [
            { name: "quizId", type: TYPES.Int, value: quizId },
          ]);
          await execQuery("DELETE FROM dbo.QuizQuestion WHERE QuizId = @quizId", [
            { name: "quizId", type: TYPES.Int, value: quizId },
          ]);
          await execQuery(
            "UPDATE dbo.Quiz SET Topic = @topic, Difficulty = @difficulty, Status = 'Ready', SourceType = 'Manual' WHERE QuizId = @quizId",
            [
              { name: "topic", type: TYPES.NVarChar, value: topic || null },
              { name: "difficulty", type: TYPES.NVarChar, value: difficulty || null },
              { name: "quizId", type: TYPES.Int, value: quizId },
            ]
          );
        } else {
          await assertStudentCanCreateQuiz(studentId, newQuizzesCreated + 1);
          if (req.user.role === "Manager") {
            await assertManagerCanCreateQuiz(req.user.userId, newQuizzesCreated + 1);
          }
          const createdQuiz = await execQuery(
            `INSERT INTO dbo.Quiz (TeacherId, ClassId, Title, Topic, Difficulty, SourceType, Status)
             OUTPUT INSERTED.QuizId
             VALUES (@managerId, @classId, @title, @topic, @difficulty, 'Manual', 'Ready')`,
            [
              { name: "managerId", type: TYPES.Int, value: managerId },
              { name: "classId", type: TYPES.Int, value: classId },
              { name: "title", type: TYPES.NVarChar, value: quizTitle },
              { name: "topic", type: TYPES.NVarChar, value: topic || null },
              { name: "difficulty", type: TYPES.NVarChar, value: difficulty || null },
            ]
          );
          quizId = createdQuiz.rows[0]?.QuizId;
          newQuizzesCreated += 1;
        }
        quizCache.set(quizKey, quizId);
        displayOrderByQuiz.set(quizId, 0);
        touchedQuizzes.add(quizId);
      }

      const orderNo = (displayOrderByQuiz.get(quizId) || 0) + 1;
      displayOrderByQuiz.set(quizId, orderNo);

      const createdQuestion = await execQuery(
        `INSERT INTO dbo.QuizQuestion (TeacherId, QuizId, QuestionText, Explanation, DisplayOrder)
         OUTPUT INSERTED.QuestionId
         VALUES (@managerId, @quizId, @text, @explanation, @orderNo)`,
        [
          { name: "managerId", type: TYPES.Int, value: managerId },
          { name: "quizId", type: TYPES.Int, value: quizId },
          { name: "text", type: TYPES.NVarChar, value: questionText },
          { name: "explanation", type: TYPES.NVarChar, value: explanation },
          { name: "orderNo", type: TYPES.Int, value: orderNo },
        ]
      );
      const questionId = createdQuestion.rows[0]?.QuestionId;
      if (!questionId) continue;

      const options = [
        { label: "A", text: optionA },
        { label: "B", text: optionB },
        { label: "C", text: optionC },
        { label: "D", text: optionD },
      ];

      for (let i = 0; i < options.length; i++) {
        const o = options[i];
        await execQuery(
          `INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES (@managerId, @questionId, @choiceText, @isCorrect, @orderNo)`,
          [
            { name: "managerId", type: TYPES.Int, value: managerId },
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "choiceText", type: TYPES.NVarChar, value: o.text },
            { name: "isCorrect", type: TYPES.Bit, value: o.label === correctLabel ? 1 : 0 },
            { name: "orderNo", type: TYPES.Int, value: i + 1 },
          ]
        );
      }

      importedQuestions += 1;
    }

    if (importedQuestions < 1) {
      return res.status(400).json({
        message: "No valid rows found. Required columns: ClassName, QuizName, QuestionText, OptionA, OptionB, OptionC, OptionD, CorrectOption. Content must follow ethical rules and educational purpose.",
      });
    }

    return res.status(201).json({
      message: "Excel imported successfully.",
      importedQuestions,
      classesTouched: touchedClasses.size,
      quizzesTouched: touchedQuizzes.size,
    });
  } catch (err) {
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({ message: err.message, paymentRequired: true, redirectTo: "/pricing" });
    }
    return res.status(500).json({ message: "Excel import failed", detail: err.message });
  }
});

/** POST /api/import/students - manager-only upload to create students from Excel */
router.post("/import/students", upload.single("file"), async (req, res) => {
  try {
    if (req.user.role !== "Manager") {
      return res.status(403).json({ message: "Only teachers can import students." });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "Excel file is required. Use multipart field name 'file'." });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return res.status(400).json({ message: "Excel has no sheets." });
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) return res.status(400).json({ message: "Excel sheet has no rows." });
    const existingManagerClasses = await execQuery(
      `SELECT DISTINCT c.ClassName
       FROM dbo.Class c
       INNER JOIN dbo.Student s ON s.StudentId = c.StudentId
       WHERE s.TeacherId = @managerId`,
      [{ name: "managerId", type: TYPES.Int, value: req.user.userId }]
    );
    const allowedClassNames = new Set(
      existingManagerClasses.rows.map((r) => toText(r.ClassName).toLowerCase()).filter(Boolean)
    );

    let importedStudents = 0;
    let createdClasses = 0;
    let skippedRows = 0;
    let duplicateUserNames = 0;
    const failedRows = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const raw = rows[idx];
      const rowNumber = idx + 2; // +1 for header row, +1 for 1-based indexing
      const studentCode = toText(getValue(raw, ["studentcode", "fullname", "name", "studentname"]));
      const userName = toText(getValue(raw, ["username", "user", "email", "studentemail"])).toLowerCase();
      const password = toText(getValue(raw, ["password", "temppassword", "temporarypassword"]));
      const className = toText(getValue(raw, ["classname", "class"]));
      const quizLimit = parseQuizLimit(getValue(raw, ["quizlimit", "limit"]));

      if (!studentCode || !userName || !password || !className) {
        skippedRows += 1;
        failedRows.push({ rowNumber, userName, studentCode, reason: "Missing required fields (StudentCode, UserName, Password, ClassName)." });
        continue;
      }
      if (password.length < 6) {
        skippedRows += 1;
        failedRows.push({ rowNumber, userName, studentCode, reason: "Invalid user name or password must be at least 6 characters." });
        continue;
      }
      if (!allowedClassNames.has(className.toLowerCase())) {
        skippedRows += 1;
        failedRows.push({
          rowNumber,
          userName,
          studentCode,
          reason: "Class do not exist, please create the class first.",
        });
        continue;
      }

      const exists = await execQuery(
        "SELECT 1 FROM dbo.Student WHERE Email = @email",
        [{ name: "email", type: TYPES.NVarChar, value: userName }]
      );
      if (exists.rows.length) {
        duplicateUserNames += 1;
        failedRows.push({ rowNumber, userName, studentCode, reason: "Duplicate user name (already exists)." });
        continue;
      }

      const passwordHash = await hashPassword(password);
      const insertedStudent = await execQuery(
        `INSERT INTO dbo.Student (TeacherId, Email, FullName, PasswordHash, IsActive, QuizLimit)
         OUTPUT INSERTED.StudentId
         VALUES (@managerId, @email, @fullName, @passwordHash, 1, @quizLimit)`,
        [
          { name: "managerId", type: TYPES.Int, value: req.user.userId },
          { name: "email", type: TYPES.NVarChar, value: userName },
          { name: "fullName", type: TYPES.NVarChar, value: studentCode },
          { name: "passwordHash", type: TYPES.NVarChar, value: passwordHash },
          { name: "quizLimit", type: TYPES.Int, value: quizLimit },
        ]
      );
      const studentId = insertedStudent.rows[0]?.StudentId;
      if (studentId) {
        let joinCode = randomJoinCode();
        for (let attempt = 0; attempt < 20; attempt++) {
          const existing = await execQuery("SELECT 1 FROM dbo.Class WHERE JoinCode = @code", [
            { name: "code", type: TYPES.NVarChar, value: joinCode },
          ]);
          if (!existing.rows.length) break;
          joinCode = randomJoinCode();
        }
        await execQuery(
          "INSERT INTO dbo.Class (TeacherId, StudentId, ClassName, JoinCode) VALUES (@managerId, @studentId, @className, @joinCode)",
          [
            { name: "managerId", type: TYPES.Int, value: req.user.userId },
            { name: "studentId", type: TYPES.Int, value: studentId },
            { name: "className", type: TYPES.NVarChar, value: className },
            { name: "joinCode", type: TYPES.NVarChar, value: joinCode },
          ]
        );
        createdClasses += 1;
      }
      importedStudents += 1;
    }

    if (importedStudents < 1) {
      const classMissingMessage = "Class do not exist, please create the class first.";
      const allFailedByClassMissing =
        failedRows.length > 0 && failedRows.every((r) => r.reason === classMissingMessage);
      return res.status(400).json({
        message: allFailedByClassMissing
          ? classMissingMessage
          : "No valid rows found. Required columns: StudentCode, UserName, Password, ClassName. ClassName must already exist. Optional: QuizLimit.",
        importedStudents,
        createdClasses,
        skippedRows,
        duplicateUserNames,
        failedRows,
      });
    }

    return res.status(201).json({
      message: "Students imported successfully.",
      importedStudents,
      createdClasses,
      skippedRows,
      duplicateUserNames,
      failedRows,
    });
  } catch (err) {
    return res.status(500).json({ message: "Student import failed", detail: err.message });
  }
});

module.exports = router;

