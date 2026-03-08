const DOC_TYPES = Object.freeze({
  COURSE_OUTLINE: "COURSE_OUTLINE",
  LECTURE_NOTES_REFERENCE: "LECTURE_NOTES_REFERENCE",
  ASSIGNMENT_SHEET: "ASSIGNMENT_SHEET",
  QUESTION_PAPER: "QUESTION_PAPER",
  ANSWER_KEY: "ANSWER_KEY",
  MATH: "MATH",
  FORMULA_SHEET: "FORMULA_SHEET",
  PROGRAMMING: "PROGRAMMING",
  TABLES_DATA_SHEET: "TABLES_DATA_SHEET",
  OTHER_UNKNOWN: "OTHER_UNKNOWN",
});

const CATEGORY_KEYS = ["STUDY_NOTES", "FLASH_CARDS", "KEYWORDS", "ASSIGNMENT"];
const OUTLINE_PHRASES = [
  "course code",
  "instructor",
  "office hours",
  "learning outcomes",
  "assessment breakdown",
  "grading",
  "week 1",
  "schedule",
  "academic integrity",
  "policies",
];
const DUE_DATE_PHRASES = [
  "due date",
  "deadline",
  "submit",
  "submission",
  "deliverables",
  "rubric",
  "marks",
  "points",
  "grading criteria",
  "upload to",
];
const ANSWER_KEY_PHRASES = ["answer key", "answers:", "solutions:", "solution:", "ans:"];
const MATH_SYMBOLS = ["√", "π", "θ", "∑", "∫", "Δ", "λ", "μ", "∞"];
const LATEX_TOKENS = ["\\frac", "\\sqrt", "\\sum", "\\int"];
const MATH_VERBS = ["solve", "simplify", "evaluate", "derive", "prove"];
const LANGUAGE_KEYWORDS = [
  "public class",
  "static",
  "void",
  "namespace",
  "function",
  "const",
  "let",
  "import",
  "export",
  "=>",
  "def ",
  "self",
  "if __name__",
  "select ",
  "from ",
  "join ",
  "where ",
  "create table",
];
const ERROR_TRACE_TOKENS = ["exception", "traceback", "syntaxerror", "typeerror"];
const TABLE_HEADER_TOKENS = ["column", "columns", "datatype", "data type", "nullable", "row", "rows", "field", "dataset", "data dictionary", "table:"];
const DEFINITIONAL_PHRASES = ["is defined as", "defined as", "means", "refers to", "is a"];
const GLOSSARY_PHRASES = ["glossary", "key terms", "keywords", "vocabulary", "terms:"];
const INSTRUCTION_VERBS = ["write", "explain", "analyze", "compare", "include references", "cite", "format", "page limit"];
const OUTLINE_FILENAME_PHRASES = ["course outline", "course-outline", "curriculum", "syllabus"];

const NUMBERED_QUESTION_RE = /^\s*(q\d+|question\s*\d+|\d+\s*[\)\.])/i;
const OPTION_PATTERN_RE = /^\s*([A-D][\)\.]|[a-d][\)\.]|\([A-D]\)|\([a-d]\))/i;
const ANSWER_LINE_RE = /^\s*\d+\s*[\)\.]\s*[A-D]\b/i;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
  return String(text || "")
    .slice(0, 60000)
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function countPhraseHits(text, phrases) {
  const low = text.toLowerCase();
  let count = 0;
  for (const phrase of phrases) {
    if (low.includes(phrase)) count += 1;
  }
  return count;
}

function countTermOccurrences(text, terms) {
  const low = text.toLowerCase();
  let count = 0;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = low.match(new RegExp(escaped, "g"));
    count += matches ? matches.length : 0;
  }
  return count;
}

function computeSignals(extractedText, originalFileName = "") {
  const normalized = normalizeText(extractedText);
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const low = normalized.toLowerCase();
  const normalizedFileName = String(originalFileName || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ");
  const wordCount = (normalized.match(/\b[\p{L}\p{N}_'-]+\b/gu) || []).length;
  const questionMarkCount = (normalized.match(/\?/g) || []).length;
  const headingCount = lines.filter((line) => (line.endsWith(":") || (/^[A-Z0-9 ,/&()'-]{4,80}$/.test(line) && /[A-Z]/.test(line)))).length;
  const numberedQuestionCount = lines.filter((line) => NUMBERED_QUESTION_RE.test(line)).length;
  const optionPatternCount = lines.filter((line) => OPTION_PATTERN_RE.test(line)).length;
  const answerPatternCount = lines.filter((line) => ANSWER_LINE_RE.test(line)).length;
  const equationCount = (normalized.match(/[=≤≥≠≈]/g) || []).length;
  const mathSymbolHits = countTermOccurrences(normalized, MATH_SYMBOLS);
  const latexHits = countTermOccurrences(low, LATEX_TOKENS);
  const mathVerbHits = countTermOccurrences(low, MATH_VERBS);
  const codeTokenHits = (normalized.match(/[{};]|==|!=|<=|>=|=>|::/g) || []).length;
  const indentedLines = lines.filter((line) => /^\s{4,}/.test(line)).length;
  const codeBlockHits = (normalized.match(/```/g) || []).length + (indentedLines >= 10 ? 1 : 0);
  const languageKeywordHits = countTermOccurrences(low, LANGUAGE_KEYWORDS);
  const errorTraceHits = countTermOccurrences(low, ERROR_TRACE_TOKENS);
  const tableLikeLines = lines.filter((line) => {
    const multiplePipes = (line.match(/\|/g) || []).length >= 2;
    const commaSeparated = line.includes(",") && line.split(",").length >= 3;
    const tabSeparated = line.includes("\t");
    const alignedSpaces = (line.match(/\s{3,}/g) || []).length >= 2;
    return multiplePipes || commaSeparated || tabSeparated || alignedSpaces;
  }).length;
  const shortTermLines = lines.filter((line) => {
    const words = (line.match(/\b[\p{L}\p{N}_'-]+\b/gu) || []).length;
    return words > 0 && words <= 6;
  }).length;

  return {
    normalized,
    low,
    originalFileName: String(originalFileName || "").trim(),
    normalizedFileName,
    lines,
    charCount: normalized.length,
    wordCount,
    lineCount: lines.length,
    avgLineLength: lines.length ? normalized.length / lines.length : normalized.length,
    headingCount,
    questionMarkCount,
    questionMarkRatio: questionMarkCount / Math.max(1, lines.length),
    numberedQuestionCount,
    optionPatternCount,
    outlineHits: countPhraseHits(low, OUTLINE_PHRASES),
    dueDateHits: countPhraseHits(low, DUE_DATE_PHRASES),
    answerKeyHits: countPhraseHits(low, ANSWER_KEY_PHRASES) + answerPatternCount,
    answerPatternCount,
    equationCount,
    mathSymbolHits,
    latexHits,
    mathVerbHits,
    codeTokenHits,
    codeBlockHits,
    languageKeywordHits,
    errorTraceHits,
    tableLikeLines,
    tableHeaderHits: countPhraseHits(low, TABLE_HEADER_TOKENS),
    definitionalHits: countPhraseHits(low, DEFINITIONAL_PHRASES),
    glossaryHits: countPhraseHits(low, GLOSSARY_PHRASES),
    instructionVerbsHits: countPhraseHits(low, INSTRUCTION_VERBS),
    outlineFileNameHits: countPhraseHits(normalizedFileName, OUTLINE_FILENAME_PHRASES),
    shortTermLines,
  };
}

function computeDocTypeScores(signals) {
  const scores = {
    [DOC_TYPES.COURSE_OUTLINE]: 0,
    [DOC_TYPES.LECTURE_NOTES_REFERENCE]: 0,
    [DOC_TYPES.ASSIGNMENT_SHEET]: 0,
    [DOC_TYPES.QUESTION_PAPER]: 0,
    [DOC_TYPES.ANSWER_KEY]: 0,
    [DOC_TYPES.MATH]: 0,
    [DOC_TYPES.FORMULA_SHEET]: 0,
    [DOC_TYPES.PROGRAMMING]: 0,
    [DOC_TYPES.TABLES_DATA_SHEET]: 0,
  };

  if (signals.outlineHits >= 3) scores.COURSE_OUTLINE += 25;
  if (signals.low.includes("assessment breakdown") || signals.low.includes("grading")) scores.COURSE_OUTLINE += 15;
  if (signals.low.includes("week 1") || signals.low.includes("schedule")) scores.COURSE_OUTLINE += 15;
  if (signals.outlineFileNameHits >= 1) scores.COURSE_OUTLINE += 80;

  if (signals.dueDateHits >= 2) scores.ASSIGNMENT_SHEET += 25;
  if (signals.low.includes("assignment") || signals.low.includes("worksheet")) scores.ASSIGNMENT_SHEET += 20;
  if (signals.low.includes("rubric") || signals.low.includes("deliverables")) scores.ASSIGNMENT_SHEET += 20;
  if (signals.instructionVerbsHits >= 2) scores.ASSIGNMENT_SHEET += 10;
  if (signals.dueDateHits >= 1 && signals.numberedQuestionCount >= 2) scores.ASSIGNMENT_SHEET += 15;

  if (signals.numberedQuestionCount >= 3) scores.QUESTION_PAPER += 20;
  if (signals.questionMarkRatio >= 0.2) scores.QUESTION_PAPER += 15;
  if (signals.optionPatternCount >= 4) scores.QUESTION_PAPER += 20;

  if (signals.answerKeyHits >= 2) scores.ANSWER_KEY += 25;
  if (signals.answerPatternCount >= 3) scores.ANSWER_KEY += 20;

  if (signals.mathVerbHits >= 2) scores.MATH += 20;
  if (signals.numberedQuestionCount >= 2) scores.MATH += 15;
  if (signals.equationCount >= 3) scores.MATH += 15;

  if (signals.equationCount >= 8) scores.FORMULA_SHEET += 25;
  if (signals.mathSymbolHits >= 3 || signals.latexHits >= 1) scores.FORMULA_SHEET += 20;
  if (signals.avgLineLength <= 45) scores.FORMULA_SHEET += 15;

  if (signals.codeBlockHits >= 1) scores.PROGRAMMING += 25;
  if (signals.languageKeywordHits >= 6 || signals.codeTokenHits >= 15) scores.PROGRAMMING += 20;
  if (signals.errorTraceHits >= 1) scores.PROGRAMMING += 10;

  if (signals.tableLikeLines >= 8) scores.TABLES_DATA_SHEET += 25;
  if (signals.tableHeaderHits >= 2) scores.TABLES_DATA_SHEET += 15;
  if (signals.low.includes("table:")) scores.TABLES_DATA_SHEET += 10;

  if (signals.headingCount >= 2) scores.LECTURE_NOTES_REFERENCE += 20;
  if (signals.definitionalHits >= 2) scores.LECTURE_NOTES_REFERENCE += 20;
  if (signals.charCount >= 1500 && signals.tableLikeLines < 4) scores.LECTURE_NOTES_REFERENCE += 15;

  return scores;
}

function pickTopTwo(scoreMap) {
  const entries = Object.entries(scoreMap).sort((a, b) => b[1] - a[1]);
  const top = entries[0] || [DOC_TYPES.OTHER_UNKNOWN, 0];
  const second = entries[1] || [DOC_TYPES.OTHER_UNKNOWN, 0];
  return { topKey: top[0], topScore: Number(top[1] || 0), secondKey: second[0], secondScore: Number(second[1] || 0) };
}

function computeCategoryScores(signals, docType) {
  const scores = {
    STUDY_NOTES: 0,
    FLASH_CARDS: 0,
    KEYWORDS: 0,
    ASSIGNMENT: 0,
  };

  scores.ASSIGNMENT += Math.min(36, 12 * signals.dueDateHits);
  if (signals.low.includes("assignment") || signals.low.includes("worksheet")) scores.ASSIGNMENT += 30;
  if (signals.low.includes("rubric")) scores.ASSIGNMENT += 20;
  if (signals.low.includes("deliverables")) scores.ASSIGNMENT += 10;
  if (signals.low.includes("submission")) scores.ASSIGNMENT += 10;
  if (signals.instructionVerbsHits >= 2) scores.ASSIGNMENT += 10;

  scores.FLASH_CARDS += Math.min(32, 8 * signals.definitionalHits);
  if (signals.numberedQuestionCount >= 3) scores.FLASH_CARDS += 12;
  if (signals.optionPatternCount >= 4) scores.FLASH_CARDS += 20;
  if ([DOC_TYPES.FORMULA_SHEET, DOC_TYPES.MATH, DOC_TYPES.PROGRAMMING].includes(docType)) scores.FLASH_CARDS += 15;

  if (signals.glossaryHits >= 1) scores.KEYWORDS += 10;
  if (signals.shortTermLines >= 12) scores.KEYWORDS += 20;
  if (docType === DOC_TYPES.TABLES_DATA_SHEET) scores.KEYWORDS += 20;
  if (docType === DOC_TYPES.FORMULA_SHEET) scores.KEYWORDS += 15;

  scores.STUDY_NOTES += Math.min(25, 5 * signals.headingCount);
  if (signals.charCount >= 1200) scores.STUDY_NOTES += 10;
  if (signals.definitionalHits >= 2) scores.STUDY_NOTES += 10;
  if ([DOC_TYPES.LECTURE_NOTES_REFERENCE, DOC_TYPES.PROGRAMMING, DOC_TYPES.MATH].includes(docType)) scores.STUDY_NOTES += 10;
  if (signals.answerKeyHits >= 1) scores.STUDY_NOTES += 10;
  if (signals.outlineHits >= 2) scores.STUDY_NOTES += 10;

  if (docType === DOC_TYPES.COURSE_OUTLINE) {
    scores.STUDY_NOTES += 30;
    scores.KEYWORDS += 20;
    scores.FLASH_CARDS -= 20;
    scores.ASSIGNMENT -= 30;
  } else if (docType === DOC_TYPES.LECTURE_NOTES_REFERENCE) {
    scores.STUDY_NOTES += 20;
    scores.FLASH_CARDS += 15;
    scores.KEYWORDS += 40;
    scores.ASSIGNMENT -= 15;
  } else if (docType === DOC_TYPES.ASSIGNMENT_SHEET) {
    scores.ASSIGNMENT += 60;
    scores.STUDY_NOTES += 15;
    scores.FLASH_CARDS -= 30;
    scores.KEYWORDS -= 20;
  } else if (docType === DOC_TYPES.FORMULA_SHEET) {
    scores.FLASH_CARDS += 40;
    scores.KEYWORDS += 25;
    scores.ASSIGNMENT -= 40;
  } else if (docType === DOC_TYPES.MATH) {
    scores.FLASH_CARDS += 30;
    scores.STUDY_NOTES += 25;
    scores.ASSIGNMENT -= 20;
  } else if (docType === DOC_TYPES.PROGRAMMING) {
    scores.STUDY_NOTES += 35;
    scores.FLASH_CARDS += 25;
    scores.KEYWORDS += 40;
    scores.ASSIGNMENT -= 10;
  } else if (docType === DOC_TYPES.TABLES_DATA_SHEET) {
    scores.KEYWORDS += 40;
    scores.STUDY_NOTES += 10;
    scores.ASSIGNMENT -= 25;
  } else if (docType === DOC_TYPES.QUESTION_PAPER) {
    scores.FLASH_CARDS += 35;
    scores.STUDY_NOTES += 10;
    scores.KEYWORDS += 10;
    scores.ASSIGNMENT -= 30;
  } else if (docType === DOC_TYPES.ANSWER_KEY) {
    scores.STUDY_NOTES += 25;
    scores.FLASH_CARDS += 20;
    scores.KEYWORDS += 10;
    scores.ASSIGNMENT -= 30;
  }

  for (const key of Object.keys(scores)) {
    scores[key] = clamp(Math.round(scores[key]), 0, 100);
  }

  return scores;
}

function buildReasons(signals, docType, suggestedCategory) {
  const reasons = [];
  if (signals.outlineFileNameHits >= 1) reasons.push("Filename indicates a course outline/curriculum document");
  if (docType === DOC_TYPES.COURSE_OUTLINE && signals.outlineHits) reasons.push("Detected course outline signals: grading/schedule");
  if (docType === DOC_TYPES.FORMULA_SHEET && (signals.equationCount >= 8 || signals.mathSymbolHits >= 3)) reasons.push("High equation density suggests formula sheet");
  if (docType === DOC_TYPES.PROGRAMMING && (signals.codeBlockHits || signals.languageKeywordHits >= 6)) reasons.push("Code blocks and language keywords detected");
  if (docType === DOC_TYPES.TABLES_DATA_SHEET && signals.tableLikeLines >= 8) reasons.push("Table-like lines and data dictionary headers detected");
  if (docType === DOC_TYPES.ASSIGNMENT_SHEET && signals.dueDateHits >= 2) reasons.push("Assignment signals detected: due dates, submission, rubric");
  if (docType === DOC_TYPES.QUESTION_PAPER && signals.optionPatternCount >= 4) reasons.push("Question numbering and option patterns suggest a question paper");
  if (docType === DOC_TYPES.ANSWER_KEY && signals.answerPatternCount >= 3) reasons.push("Answer key patterns like '1) B' were detected");
  if (docType === DOC_TYPES.LECTURE_NOTES_REFERENCE && signals.headingCount >= 2) reasons.push("Reference-style headings and explanations detected");
  if (suggestedCategory === "FLASH_CARDS" && signals.definitionalHits >= 2) reasons.push("Definition-heavy content matches flash card generation");
  if (suggestedCategory === "KEYWORDS" && (signals.glossaryHits || signals.shortTermLines >= 12)) reasons.push("Glossary-style short terms suggest keyword extraction");
  if (suggestedCategory === "ASSIGNMENT" && signals.instructionVerbsHits >= 2) reasons.push("Instruction-heavy wording suggests assignment output");
  if (suggestedCategory === "STUDY_NOTES" && signals.headingCount >= 2) reasons.push("Section headings and explanatory text suit study notes");
  return reasons.slice(0, 5);
}

function analyzeDocumentForCategories(extractedText, options = {}) {
  const signals = computeSignals(extractedText, options.originalFileName || "");
  if (signals.charCount < 300 || signals.wordCount < 60) {
    const error = new Error("Document has insufficient readable text.");
    error.code = "INSUFFICIENT_TEXT";
    error.status = 400;
    throw error;
  }

  const docTypeScores = computeDocTypeScores(signals);
  const { topKey, topScore, secondScore } = pickTopTwo(docTypeScores);
  let docType = topKey;
  let docTypeConfidence = clamp((topScore - secondScore) / 100, 0, 1);
  if (topScore < 35) {
    docType = DOC_TYPES.OTHER_UNKNOWN;
    docTypeConfidence = Math.min(0.4, docTypeConfidence);
  }

  const categoryScores = computeCategoryScores(signals, docType);
  const categoryTop = pickTopTwo(categoryScores);
  const suggestedCategory = categoryTop.topKey;
  const categoryConfidence = clamp((categoryTop.topScore - categoryTop.secondScore) / 100, 0, 1);
  let finalConfidence = clamp(Math.max(docTypeConfidence, categoryConfidence), 0, 1);
  if (finalConfidence < 0.7 && categoryTop.topScore >= 55 && CATEGORY_KEYS.some((key) => categoryScores[key] <= 35)) {
    finalConfidence = 0.7;
  }

  const visibleCategories = [];
  const hiddenCategories = [];
  if (finalConfidence >= 0.7) {
    for (const key of CATEGORY_KEYS) {
      if (categoryScores[key] <= 35) hiddenCategories.push(key);
      else visibleCategories.push(key);
    }
  } else {
    visibleCategories.push(...CATEGORY_KEYS);
  }

  return {
    docType,
    confidence: Number(finalConfidence.toFixed(3)),
    categoryScores,
    suggestedCategory,
    visibleCategories,
    hiddenCategories,
    reasons: buildReasons(signals, docType, suggestedCategory),
  };
}

module.exports = {
  DOC_TYPES,
  CATEGORY_KEYS,
  analyzeDocumentForCategories,
};
