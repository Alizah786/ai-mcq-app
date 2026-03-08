const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");
const net = require("net");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth, hashPassword } = require("../auth");
const {
  assertStudentCanCreateQuiz,
  assertManagerCanCreateQuiz,
  PaymentRequiredError,
} = require("../services/quizQuota");
const { validateEducationalQuizEntry } = require("../services/contentPolicy");
const { logUsageEventByActor } = require("../services/usageEvents");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/octet-stream",
]);
const MAX_SHEETS = 6;
const MAX_ROWS_PER_SHEET = 10000;
const MAX_COLS_PER_SHEET = 120;

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

function parseQuestionType(value) {
  const v = String(value || "MCQ").trim().toUpperCase();
  if (v === "SHORT_TEXT" || v === "TRUE_FALSE" || v === "NUMERIC" || v === "LONG" || v === "MIX_MATCH_DRAG") return v;
  return "MCQ";
}

function parsePoints(value) {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

function parseQuizLimit(value) {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 40;
  return Math.trunc(n);
}

function parseAttemptLimit(value) {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return 1;
  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > 5) return 5;
  return i;
}

function parseTimeLimitMinutes(value) {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 300) return 300;
  return i;
}

function parseBoolean(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getFileExtension(fileName) {
  return String(path.extname(String(fileName || "")) || "").toLowerCase();
}

function isZipSignature(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function isXlsCfbSignature(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  );
}

function isLikelyCsvBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return false;
  const sample = buffer.slice(0, Math.min(buffer.length, 8192));
  if (sample.includes(0x00)) return false;
  const text = sample.toString("utf8");
  const hasLine = text.includes("\n") || text.includes("\r");
  const hasDelimiter = text.includes(",") || text.includes(";") || text.includes("\t");
  return hasLine && hasDelimiter;
}

function inferFileKind(buffer) {
  if (isZipSignature(buffer)) return "xlsx";
  if (isXlsCfbSignature(buffer)) return "xls";
  if (isLikelyCsvBuffer(buffer)) return "csv";
  return "unknown";
}

function assertUploadIsSafeSpreadsheet(file) {
  if (!file || !file.buffer) {
    throw new Error("Spreadsheet file is required.");
  }
  const ext = getFileExtension(file.originalname);
  const mime = String(file.mimetype || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported file type. Allowed: .xlsx, .xls, .csv");
  }
  if (mime && !ALLOWED_MIME_TYPES.has(mime)) {
    throw new Error("Invalid file content type.");
  }

  const kind = inferFileKind(file.buffer);
  if (ext === ".xlsx" && kind !== "xlsx") {
    throw new Error("File content does not match .xlsx format.");
  }
  if (ext === ".xls" && kind !== "xls") {
    throw new Error("File content does not match .xls format.");
  }
  if (ext === ".csv" && kind !== "csv") {
    throw new Error("File content does not match .csv format.");
  }
}

function assertWorkbookShape(workbook) {
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) throw new Error("Spreadsheet has no sheets.");
  if (sheetNames.length > MAX_SHEETS) {
    throw new Error(`Too many sheets. Maximum allowed is ${MAX_SHEETS}.`);
  }

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets?.[sheetName];
    const ref = sheet?.["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    if (rows > MAX_ROWS_PER_SHEET) {
      throw new Error(`Sheet "${sheetName}" exceeds row limit (${MAX_ROWS_PER_SHEET}).`);
    }
    if (cols > MAX_COLS_PER_SHEET) {
      throw new Error(`Sheet "${sheetName}" exceeds column limit (${MAX_COLS_PER_SHEET}).`);
    }
  }
}

function scanWithClamAV(buffer, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const host = process.env.CLAMAV_HOST || "127.0.0.1";
    const port = Number(process.env.CLAMAV_PORT || 3310);
    const socket = net.createConnection({ host, port });
    let response = "";
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      fn(value);
    };

    socket.setTimeout(timeoutMs, () => finish(reject, new Error("ClamAV scan timed out")));
    socket.on("error", (err) => finish(reject, err));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("OK")) return finish(resolve, { clean: true });
      const found = response.match(/: (.+) FOUND/i);
      if (found) return finish(resolve, { clean: false, threat: found[1] || "MALWARE" });
      if (response.includes("ERROR")) return finish(reject, new Error(response.trim()));
    });

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.slice(offset, Math.min(offset + chunkSize, buffer.length));
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(chunk.length, 0);
        socket.write(lenBuf);
        socket.write(chunk);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
  });
}

async function maybeScanForMalware(file) {
  const mode = String(process.env.MALWARE_SCAN_MODE || "none").toLowerCase();
  if (mode === "none") return;

  const requireClean = String(process.env.MALWARE_SCAN_REQUIRED || "false").toLowerCase() === "true";
  if (mode === "clamav") {
    try {
      const result = await scanWithClamAV(file.buffer);
      if (!result.clean) {
        throw new Error(`Malware detected: ${result.threat || "Unknown threat"}`);
      }
      return;
    } catch (err) {
      if (requireClean) throw err;
      return;
    }
  }
}

function readWorkbookSafe(file) {
  const ext = getFileExtension(file.originalname);
  const workbook = XLSX.read(file.buffer, {
    type: "buffer",
    dense: true,
    cellFormula: false,
    cellStyles: false,
    cellNF: false,
    bookVBA: false,
    raw: false,
  });
  assertWorkbookShape(workbook);
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("Spreadsheet has no sheets.");
  const sheet = workbook.Sheets[firstSheet];
  if (!sheet) throw new Error("Unable to read first sheet.");

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    blankrows: false,
    raw: false,
  });
  if (!rows.length) throw new Error("Spreadsheet has no data rows.");
  if (rows.length > MAX_ROWS_PER_SHEET) {
    throw new Error(`Spreadsheet exceeds row limit (${MAX_ROWS_PER_SHEET}).`);
  }

  // CSV-specific sanity: enforce simple header/body presence.
  if (ext === ".csv" && rows.length < 1) {
    throw new Error("CSV has no rows.");
  }

  return rows;
}

function isClientImportErrorMessage(msg) {
  const m = String(msg || "").toLowerCase();
  return (
    m.includes("unsupported file type") ||
    m.includes("invalid file content type") ||
    m.includes("does not match") ||
    m.includes("exceeds row limit") ||
    m.includes("exceeds column limit") ||
    m.includes("too many sheets") ||
    m.includes("has no sheets") ||
    m.includes("has no data rows") ||
    m.includes("spreadsheet file is required")
  );
}

/** POST /api/import/excel - upload quiz rows from Excel for current student */
router.post("/import/excel", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "Spreadsheet file is required. Use multipart field name 'file'." });
    }
    assertUploadIsSafeSpreadsheet(req.file);
    await maybeScanForMalware(req.file);
    const rows = readWorkbookSafe(req.file);

    const disclaimerAcknowledged = parseBoolean(req.body.disclaimerAcknowledged);
    const disclaimerId = Number(req.body.disclaimerId);
    const attemptLimit = parseAttemptLimit(req.body.attemptLimit);
    const timeLimitMinutes = parseTimeLimitMinutes(req.body.timeLimitMinutes);
    const revealAnswersAfterSubmit = parseBoolean(req.body.revealAnswersAfterSubmit);
    if (!disclaimerAcknowledged) {
      return res.status(400).json({ message: "Manual disclaimer must be acknowledged before import." });
    }
    if (!Number.isFinite(disclaimerId) || disclaimerId <= 0) {
      return res.status(400).json({ message: "Manual disclaimer selection is required." });
    }
    const disclaimer = await execQuery(
      `SELECT DisclaimerId
       FROM dbo.Disclaimer
       WHERE DisclaimerId = @disclaimerId
         AND DisclaimerType = 'MANUAL'
         AND IsActive = 1`,
      [{ name: "disclaimerId", type: TYPES.Int, value: disclaimerId }]
    );
    if (!disclaimer.rows.length) {
      return res.status(400).json({ message: "Invalid manual disclaimer selected." });
    }

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
    const quizQuestionCounts = new Map();
    const overLimitQuizzes = new Set();
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
      const questionType = parseQuestionType(getValue(raw, ["questiontype", "type"]));
      const points = parsePoints(getValue(raw, ["points", "marks"]));
      const topic = toText(getValue(raw, ["topic"]));
      const difficulty = toText(getValue(raw, ["difficulty"]));

      const optionA = toText(getValue(raw, ["optiona", "a"]));
      const optionB = toText(getValue(raw, ["optionb", "b"]));
      const optionC = toText(getValue(raw, ["optionc", "c"]));
      const optionD = toText(getValue(raw, ["optiond", "d"]));
      const correctLabel = parseCorrectOption(getValue(raw, ["correctoption", "correct", "answer"]));
      const expectedAnswerText = toText(getValue(raw, ["expectedanswertext", "expectedanswer"]));

      if (!className || !quizTitle || !questionText) {
        continue;
      }
      if (questionType === "MIX_MATCH_DRAG") {
        return res.status(400).json({
          message: "Excel import does not support QuestionType=MIX_MATCH_DRAG yet. Create this question type manually in the quiz editor.",
        });
      }
      if (
        (questionType === "MCQ" || questionType === "TRUE_FALSE") &&
        (!optionA || !optionB || !optionC || !optionD || !correctLabel)
      ) {
        continue;
      }
      if (questionType === "SHORT_TEXT" && !expectedAnswerText) {
        continue;
      }
      if (questionType === "LONG" && questionText.length < 20) {
        continue;
      }
      const policyError = validateEducationalQuizEntry({
        quizTitle,
        topic,
        questionText,
        explanation,
        options:
          questionType === "MCQ" || questionType === "TRUE_FALSE"
            ? [optionA, optionB, optionC, optionD]
            : [],
      });
      if (policyError) {
        continue;
      }

      const classKey = className.toLowerCase();
      if (!classCache.has(classKey)) {
        unknownClasses.add(className);
      } else {
        const quizKey = `${classCache.get(classKey)}::${quizTitle.toLowerCase()}`;
        const nextCount = (quizQuestionCounts.get(quizKey) || 0) + 1;
        quizQuestionCounts.set(quizKey, nextCount);
        if (nextCount > 25) {
          overLimitQuizzes.add(`${className} / ${quizTitle}`);
        }
      }
    }

    if (unknownClasses.size) {
      return res.status(400).json({
        message: `Unknown class name(s): ${Array.from(unknownClasses).join(", ")}. Create class first, then import again.`,
      });
    }
    if (overLimitQuizzes.size) {
      return res.status(400).json({
        message: `Maximum number of MCQ's for manual/import quiz is 25. Over limit: ${Array.from(overLimitQuizzes).slice(0, 8).join(", ")}${overLimitQuizzes.size > 8 ? " ..." : ""}`,
      });
    }

    for (const raw of rows) {
      const className = toText(getValue(raw, ["classname", "class"]));
      const quizTitle = toText(getValue(raw, ["quizname", "quiztitle", "quiz"]));
      const questionText = toText(getValue(raw, ["question", "questiontext", "mcq"]));
      const explanation = toText(getValue(raw, ["explanation", "answerexplanation"])) || null;
      const questionType = parseQuestionType(getValue(raw, ["questiontype", "type"]));
      const points = parsePoints(getValue(raw, ["points", "marks"]));
      const topic = toText(getValue(raw, ["topic"]));
      const difficulty = toText(getValue(raw, ["difficulty"]));

      const optionA = toText(getValue(raw, ["optiona", "a"]));
      const optionB = toText(getValue(raw, ["optionb", "b"]));
      const optionC = toText(getValue(raw, ["optionc", "c"]));
      const optionD = toText(getValue(raw, ["optiond", "d"]));
      const correctLabel = parseCorrectOption(getValue(raw, ["correctoption", "correct", "answer"]));
      const expectedAnswerText = toText(getValue(raw, ["expectedanswertext", "expectedanswer"]));

      if (!className || !quizTitle || !questionText) {
        continue;
      }
      if (questionType === "MIX_MATCH_DRAG") {
        return res.status(400).json({
          message: "Excel import does not support QuestionType=MIX_MATCH_DRAG yet. Create this question type manually in the quiz editor.",
        });
      }
      if (
        (questionType === "MCQ" || questionType === "TRUE_FALSE") &&
        (!optionA || !optionB || !optionC || !optionD || !correctLabel)
      ) {
        continue;
      }
      if (questionType === "SHORT_TEXT" && !expectedAnswerText) {
        continue;
      }
      if (questionType === "LONG" && questionText.length < 20) {
        continue;
      }
      const policyError = validateEducationalQuizEntry({
        quizTitle,
        topic,
        questionText,
        explanation,
        options:
          questionType === "MCQ" || questionType === "TRUE_FALSE"
            ? [optionA, optionB, optionC, optionD]
            : [],
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
            "UPDATE dbo.Quiz SET Topic = @topic, Difficulty = @difficulty, Status = 'Ready', SourceType = 'Manual', DisclaimerId = @disclaimerId, AttemptLimit = @attemptLimit, TimeLimitMinutes = @timeLimitMinutes, RevealAnswersAfterSubmit = @revealAnswersAfterSubmit WHERE QuizId = @quizId",
            [
              { name: "topic", type: TYPES.NVarChar, value: topic || null },
              { name: "difficulty", type: TYPES.NVarChar, value: difficulty || null },
              { name: "disclaimerId", type: TYPES.Int, value: disclaimerId },
              { name: "attemptLimit", type: TYPES.Int, value: attemptLimit },
              { name: "timeLimitMinutes", type: TYPES.Int, value: timeLimitMinutes },
              { name: "revealAnswersAfterSubmit", type: TYPES.Bit, value: revealAnswersAfterSubmit ? 1 : 0 },
              { name: "quizId", type: TYPES.Int, value: quizId },
            ]
          );
        } else {
          const actorRole = String(req.user.displayRole || req.user.role || "").toUpperCase();
          const isTeacherActor = actorRole === "TEACHER" || actorRole === "MANAGER";
          if (isTeacherActor) {
            await assertManagerCanCreateQuiz(req.user.userId, newQuizzesCreated + 1);
          } else {
            await assertStudentCanCreateQuiz(studentId, newQuizzesCreated + 1);
          }
          const createdQuiz = await execQuery(
            `INSERT INTO dbo.Quiz (TeacherId, ClassId, Title, Topic, Difficulty, SourceType, Status, DisclaimerId, AttemptLimit, TimeLimitMinutes, RevealAnswersAfterSubmit)
             OUTPUT INSERTED.QuizId
             VALUES (@managerId, @classId, @title, @topic, @difficulty, 'Manual', 'Ready', @disclaimerId, @attemptLimit, @timeLimitMinutes, @revealAnswersAfterSubmit)`,
            [
              { name: "managerId", type: TYPES.Int, value: managerId },
              { name: "classId", type: TYPES.Int, value: classId },
              { name: "title", type: TYPES.NVarChar, value: quizTitle },
              { name: "topic", type: TYPES.NVarChar, value: topic || null },
              { name: "difficulty", type: TYPES.NVarChar, value: difficulty || null },
              { name: "disclaimerId", type: TYPES.Int, value: disclaimerId },
              { name: "attemptLimit", type: TYPES.Int, value: attemptLimit },
              { name: "timeLimitMinutes", type: TYPES.Int, value: timeLimitMinutes },
              { name: "revealAnswersAfterSubmit", type: TYPES.Bit, value: revealAnswersAfterSubmit ? 1 : 0 },
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
        `INSERT INTO dbo.QuizQuestion (TeacherId, QuizId, QuestionText, Explanation, DisplayOrder, QuestionType, ExpectedAnswerText, AnswerMatchMode, Points)
         OUTPUT INSERTED.QuestionId
         VALUES (@managerId, @quizId, @text, @explanation, @orderNo, @questionType, @expectedAnswerText, @answerMatchMode, @points)`,
        [
          { name: "managerId", type: TYPES.Int, value: managerId },
          { name: "quizId", type: TYPES.Int, value: quizId },
          { name: "text", type: TYPES.NVarChar, value: questionText },
          { name: "explanation", type: TYPES.NVarChar, value: explanation },
          { name: "orderNo", type: TYPES.Int, value: orderNo },
          { name: "questionType", type: TYPES.NVarChar, value: questionType },
          { name: "expectedAnswerText", type: TYPES.NVarChar, value: questionType === "SHORT_TEXT" ? expectedAnswerText : null },
          { name: "answerMatchMode", type: TYPES.NVarChar, value: questionType === "SHORT_TEXT" ? "EXACT" : null },
          { name: "points", type: TYPES.Int, value: questionType === "LONG" ? points : 1 },
        ]
      );
      const questionId = createdQuestion.rows[0]?.QuestionId;
      if (!questionId) continue;

      if (questionType === "SHORT_TEXT" || questionType === "LONG") {
        importedQuestions += 1;
        continue;
      }

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
        message: "No valid rows found. Required: ClassName, QuizName, QuestionText. For MCQ/TRUE_FALSE include OptionA..OptionD + CorrectOption. For SHORT_TEXT include ExpectedAnswerText. For LONG use QuestionType=LONG and optional Points. Content must follow ethical rules and educational purpose.",
      });
    }

    logUsageEventByActor({
      role: req.user.role,
      userId: req.user.userId,
      eventType: "IMPORT",
      quantity: importedQuestions,
    }).catch(() => {});

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
    if (isClientImportErrorMessage(err?.message) || String(err?.message || "").toLowerCase().includes("malware")) {
      return res.status(400).json({ message: err.message || "Invalid spreadsheet file." });
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
      return res.status(400).json({ message: "Spreadsheet file is required. Use multipart field name 'file'." });
    }
    assertUploadIsSafeSpreadsheet(req.file);
    await maybeScanForMalware(req.file);
    const rows = readWorkbookSafe(req.file);
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

      let exists = { rows: [] };
      try {
        exists = await execQuery(
          `SELECT TOP 1 1
           FROM dbo.UserNameRegistry
           WHERE NormalizedUserName = LOWER(LTRIM(RTRIM(@email)))
             AND IsActive = 1`,
          [{ name: "email", type: TYPES.NVarChar, value: userName }]
        );
      } catch {
        exists = await execQuery(
          "SELECT TOP 1 1 FROM dbo.Student WHERE Email = @email",
          [{ name: "email", type: TYPES.NVarChar, value: userName }]
        );
      }
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
    const msg = String(err?.message || "");
    if (isClientImportErrorMessage(msg) || msg.toLowerCase().includes("malware")) {
      return res.status(400).json({ message: msg || "Invalid spreadsheet file." });
    }
    if (msg.includes("UX_UserNameRegistry_NormalizedUserName") || msg.includes("duplicate")) {
      return res.status(409).json({ message: "Student import failed: duplicate user name detected." });
    }
    return res.status(500).json({ message: "Student import failed", detail: err.message });
  }
});


module.exports = router;

