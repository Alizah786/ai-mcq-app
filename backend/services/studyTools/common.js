const { TYPES } = require("tedious");
const { execQuery } = require("../../db");

const MAX_INPUT_CHARS = 200000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const OUTLINE_BLOCK_MESSAGE =
  "This document appears to be a course outline or curriculum summary. Please upload actual study content such as chapters or notes.";
const OUTLINE_LIMITED_WARNING =
  "Course outlines usually produce broad revision material, not deep study notes.";
const OUTLINE_OUTPUTS_LIMITED_MESSAGE =
  "Course outlines can only be used for Notes or Keywords. Assessment and Flash Cards are not available for this type of document.";

class StudyToolError extends Error {
  constructor(message, status = 400, code = "INVALID_INPUT") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function mapUserType(role) {
  if (String(role || "") === "Manager") return "TEACHER";
  if (String(role || "") === "Student") return "STUDENT";
  if (String(role || "") === "Principal") return "PRINCIPAL";
  return "";
}

async function loadOwnerRegistryId(user) {
  const userType = mapUserType(user?.role);
  if (!userType || !Number(user?.userId)) return null;
  const r = await execQuery(
    `SELECT TOP 1 UserNameRegistryId
     FROM dbo.UserNameRegistry
     WHERE UserType = @userType AND UserId = @userId AND IsActive = 1`,
    [
      { name: "userType", type: TYPES.NVarChar, value: userType },
      { name: "userId", type: TYPES.Int, value: Number(user.userId) },
    ]
  );
  return Number(r.rows[0]?.UserNameRegistryId || 0) || null;
}

function normalizeOutputs(outputs) {
  const allowed = new Set(["notes", "flashcards", "keywords", "summary", "assignments"]);
  const list = Array.isArray(outputs)
    ? outputs.map((v) => String(v || "").trim().toLowerCase()).filter((v) => allowed.has(v))
    : [];
  const unique = [...new Set(list)];
  if (!unique.length) throw new StudyToolError("Select at least one output type.");
  return unique;
}

function normalizeOptions(options = {}) {
  const notesLengthRaw = String(options.notesLength || "Medium").trim().toLowerCase();
  const notesLength = notesLengthRaw === "short" ? "Short" : notesLengthRaw === "long" ? "Long" : "Medium";
  const difficultyRaw = String(options.difficulty || "Mixed").trim().toLowerCase();
  const difficulty = difficultyRaw === "easy" ? "Easy" : difficultyRaw === "hard" ? "Hard" : "Mixed";
  const flashcardCount = Math.max(5, Math.min(50, Number(options.flashcardCount || 15) || 15));
  const assignmentCount = Math.max(3, Math.min(20, Number(options.assignmentCount || 8) || 8));
  return {
    notesLength,
    flashcardCount,
    assignmentCount,
    difficulty,
    includeDefinitions: !!options.includeDefinitions,
    includeExamples: !!options.includeExamples,
  };
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseImageDataUrl(dataUrl) {
  const value = String(dataUrl || "").trim();
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new StudyToolError("Invalid image upload.", 400, "INVALID_IMAGE");
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new StudyToolError("Only PNG, JPG, JPEG, and WEBP images are supported.", 400, "UNSUPPORTED_IMAGE_TYPE");
  }
  const base64 = match[2];
  const bytes = Buffer.byteLength(base64, "base64");
  if (bytes > MAX_IMAGE_BYTES) {
    throw new StudyToolError("Image is too large. Max 5 MB.", 400, "IMAGE_TOO_LARGE");
  }
  return { mimeType, base64, bytes, dataUrl: value };
}

function splitHeadingChunks(text) {
  const headingRegex = /(^|\n)(\s*(chapter|unit|lesson)\s+\d+[:.-]?|#{1,6}\s+|\d+(\.\d+)*\s+[A-Z][^\n]{3,})/gi;
  const points = [];
  let m;
  while ((m = headingRegex.exec(text))) {
    points.push(m.index);
  }
  if (!points.length) return [];
  const chunks = [];
  for (let i = 0; i < points.length; i++) {
    const start = points[i];
    const end = points[i + 1] || text.length;
    chunks.push(text.slice(start, end));
  }
  return chunks;
}

function truncateStudyText(rawText, maxChars = MAX_INPUT_CHARS) {
  const text = normalizeWhitespace(rawText);
  if (text.length <= maxChars) return text;
  const first = text.slice(0, 80000);
  const last = text.slice(-40000);
  const middleWindowStart = Math.max(0, Math.floor((text.length - 80000) / 2));
  const middleWindow = text.slice(middleWindowStart, middleWindowStart + 80000);
  const middleChunks = splitHeadingChunks(middleWindow);
  let bestMiddle = middleWindow.slice(0, 80000);
  if (middleChunks.length) {
    bestMiddle = middleChunks
      .sort((a, b) => b.length - a.length)[0]
      .slice(0, 80000);
  }
  return normalizeWhitespace(`${first}\n\n${bestMiddle}\n\n${last}`).slice(0, maxChars);
}

function isLikelyCourseOutline(textRaw, originalFileName = "") {
  const text = String(textRaw || "").toLowerCase();
  if (!text.trim()) return false;
  const fileName = String(originalFileName || "").toLowerCase().replace(/[_\-]+/g, " ").trim();
  const keywords = [
    "course outline",
    "curriculum",
    "syllabus",
    "grading policy",
    "exam schedule",
    "weekly planner",
    "lesson plan",
    "grading scheme",
    "evaluation breakdown",
    "attendance policy",
    "office hours",
    "mark distribution",
    "weekly schedule",
  ];
  const fileNameSignals = ["course outline", "course-outline", "curriculum", "syllabus"];
  const explanatorySignals = [
    "for example",
    "because",
    "therefore",
    "definition",
    "concept",
    "explains",
    "theorem",
    "formula",
    "in summary",
    "process",
  ];
  let hits = 0;
  for (const k of keywords) {
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const c = (text.match(re) || []).length;
    hits += c;
  }
  const fileNameHits = fileName
    ? fileNameSignals.reduce((sum, signal) => sum + (fileName.includes(signal.replace(/[_\-]+/g, " ")) ? 1 : 0), 0)
    : 0;
  let explainHits = 0;
  for (const s of explanatorySignals) {
    const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    explainHits += (text.match(re) || []).length;
  }
  if (fileNameHits >= 1 && hits >= 1) return true;
  return hits >= 3 && explainHits < 5;
}

function supportsOutlineOutputs(outputs = []) {
  const allowed = new Set(["notes", "keywords", "summary"]);
  const list = Array.isArray(outputs) ? outputs : [];
  if (!list.length) return false;
  if (!list.every((value) => allowed.has(String(value || "").trim().toLowerCase()))) return false;
  return list.some((value) => ["notes", "keywords"].includes(String(value || "").trim().toLowerCase()));
}

function stripUnsafeHtml(value) {
  return String(value || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .trim();
}

function enforceOutputLimits(payload = {}, options = {}, flags = {}) {
  const out = {};
  out.title = String(payload.title || "").trim().slice(0, 200);
  out.summary = String(payload.summary || "").trim().slice(0, 1200);

  const keywords = Array.isArray(payload.keywords)
    ? payload.keywords.map((k) => String(k || "").trim().slice(0, 40)).filter(Boolean).slice(0, 30)
    : [];
  out.keywords = keywords;

  const notes = stripUnsafeHtml(payload.notesMarkdown || "");
  const notesWords = notes.split(/\s+/).filter(Boolean).length;
  const mode = String(options.notesLength || "Medium");
  const range = mode === "Short" ? [300, 600] : mode === "Long" ? [1200, 2000] : [600, 1200];
  if (!flags.skipWordMinimum && notes && notesWords < range[0]) {
    throw new StudyToolError("Generated notes are too short.", 422, "INVALID_JSON_FORMAT");
  }
  out.notesMarkdown = notes;

  const cards = Array.isArray(payload.flashcards) ? payload.flashcards : [];
  const normalizedCards = cards
    .map((c) => ({
      front: String(c?.front || "").trim().slice(0, 180),
      back: String(c?.back || "").trim().slice(0, 400),
      tags: Array.isArray(c?.tags) ? c.tags.map((t) => String(t || "").trim().slice(0, 40)).filter(Boolean).slice(0, 8) : [],
      difficulty: ["Easy", "Medium", "Hard"].includes(String(c?.difficulty || ""))
        ? String(c.difficulty)
        : "Medium",
    }))
    .filter((c) => c.front && c.back)
    .slice(0, 50);

  if (cards.length && normalizedCards.length < 5) {
    throw new StudyToolError("Generated flashcards are invalid.", 422, "INVALID_JSON_FORMAT");
  }
  out.flashcards = normalizedCards;

  const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];
  out.assignments = assignments
    .map((item) => ({
      question: String(item?.question || "").trim().slice(0, 1200),
      example: String(item?.example || "").trim().slice(0, 2000),
      explanation: String(item?.explanation || "").trim().slice(0, 3000),
      difficulty: ["Easy", "Medium", "Hard"].includes(String(item?.difficulty || ""))
        ? String(item.difficulty)
        : "Medium",
    }))
    .filter((item) => item.question)
    .slice(0, 20);
  if (assignments.length && out.assignments.length < 3) {
    throw new StudyToolError("Generated assignments are invalid.", 422, "INVALID_JSON_FORMAT");
  }
  return out;
}

async function loadAccessibleDocumentForUser(user, documentId) {
  const r = await execQuery(
    `SELECT TOP 1 DocumentId, StudentId, ClassId, TeacherId, CourseCode, OriginalFileName,
            Status, ExtractedText, ExtractedTextLength, WarningCodes
     FROM dbo.DocumentUpload
     WHERE DocumentId = @documentId
       AND DeletedAtUtc IS NULL`,
    [{ name: "documentId", type: TYPES.Int, value: Number(documentId) }]
  );
  const row = r.rows[0];
  if (!row) throw new StudyToolError("Document not found.", 404, "NOT_FOUND");
  if (String(user?.role || "") === "Manager") {
    if (Number(row.TeacherId || 0) !== Number(user?.userId || 0)) {
      throw new StudyToolError("Forbidden.", 403, "FORBIDDEN");
    }
  } else if (String(user?.role || "") === "Student") {
    if (Number(row.StudentId || 0) !== Number(user?.userId || 0)) {
      throw new StudyToolError("Forbidden.", 403, "FORBIDDEN");
    }
  } else if (String(user?.role || "") === "Principal") {
    // No org linkage yet; principal is allowed only when they are teacher owner in current schema.
    if (Number(row.TeacherId || 0) !== Number(user?.userId || 0)) {
      throw new StudyToolError("Forbidden.", 403, "FORBIDDEN");
    }
  } else {
    throw new StudyToolError("Forbidden.", 403, "FORBIDDEN");
  }
  return row;
}

function safePublicMessage(code) {
  if (code === "OUTLINE_NOT_ALLOWED") return OUTLINE_BLOCK_MESSAGE;
  if (code === "OUTLINE_OUTPUTS_LIMITED") return OUTLINE_OUTPUTS_LIMITED_MESSAGE;
  if (code === "TOPIC_MISMATCH") return "Topic/subject does not seem related to the uploaded document.";
  if (code === "SUBJECT_TOPIC_TOO_GENERIC") return "Please enter a specific subject and topic, for example: English Composition / Thesis Statements.";
  if (code === "MIXED_SUBJECT_DOCUMENT") return "This document contains multiple subjects. Please choose a specific subject/topic or upload a single-subject document.";
  if (code === "UNSUPPORTED_IMAGE_TYPE") return "Only PNG, JPG, JPEG, and WEBP images are supported.";
  if (code === "IMAGE_TOO_LARGE") return "Image is too large. Max 5 MB.";
  if (code === "INVALID_IMAGE") return "Invalid image upload.";
  if (code === "PYTHON_UNAVAILABLE") return "Unable to generate study materials right now. Please try again.";
  if (code === "INVALID_GENERATED_STRUCTURE") return "Generated notes were not structured correctly.";
  if (code === "ASSIGNMENT_AUTOSWITCH") return "This source looks like an assessment such as an assignment, quiz, exam, or test. The output was switched to Assessment.";
  return "Unable to process study materials right now. Please try again.";
}

module.exports = {
  MAX_INPUT_CHARS,
  OUTLINE_BLOCK_MESSAGE,
  OUTLINE_LIMITED_WARNING,
  OUTLINE_OUTPUTS_LIMITED_MESSAGE,
  StudyToolError,
  loadOwnerRegistryId,
  normalizeOutputs,
  normalizeOptions,
  normalizeWhitespace,
  parseImageDataUrl,
  truncateStudyText,
  isLikelyCourseOutline,
  supportsOutlineOutputs,
  enforceOutputLimits,
  loadAccessibleDocumentForUser,
  safePublicMessage,
};

