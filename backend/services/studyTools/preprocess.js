const { StudyToolError } = require("./common");

const GENERIC_TERMS = new Set([
  "study",
  "guide",
  "study guide",
  "notes",
  "chapter",
  "subject",
  "all subjects",
  "test prep",
  "prep",
  "content",
  "material",
]);

const SUBJECT_KEYWORDS = {
  english: ["english", "writing", "essay", "grammar", "thesis", "paragraph", "citation"],
  math: ["math", "algebra", "geometry", "calculus", "equation", "formula", "theorem"],
  science: ["science", "biology", "chemistry", "physics", "cell", "molecule", "energy"],
  software: ["software", "programming", "database", "system", "requirement", "uml", "testing"],
  history: ["history", "civilization", "war", "empire", "revolution"],
};

const ASSIGNMENT_KEYWORDS = [
  "assignment",
  "worksheet",
  "problem set",
  "practice questions",
  "questions",
  "solve",
  "find",
  "calculate",
  "evaluate",
  "determine",
  "show that",
  "prove",
  "simplify",
  "marks",
  "total marks",
  "submit",
];

const STUDY_KEYWORDS = [
  "definition",
  "concept",
  "overview",
  "summary",
  "explanation",
  "example",
  "chapter",
  "lesson",
  "unit",
  "introduction",
];

function normalizeStudyText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\[(document|word|pdf)[^\]]*\]/gi, " ")
    .replace(/document\.(md|word|pdf)/gi, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeComparable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateSpecificSubjectTopic(subject, topic) {
  const normSubject = normalizeComparable(subject);
  const normTopic = normalizeComparable(topic);
  if (!normSubject || !normTopic || normSubject.length < 2 || normTopic.length < 2) {
    throw new StudyToolError(
      "Please enter a specific subject and topic, for example: English Composition / Thesis Statements.",
      400,
      "SUBJECT_TOPIC_TOO_GENERIC"
    );
  }
  if (GENERIC_TERMS.has(normSubject) || GENERIC_TERMS.has(normTopic)) {
    throw new StudyToolError(
      "Please enter a specific subject and topic, for example: English Composition / Thesis Statements.",
      400,
      "SUBJECT_TOPIC_TOO_GENERIC"
    );
  }
}

function isHeadingLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (/^(chapter|unit|lesson|module)\s+\d+/i.test(trimmed)) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^\d+(\.\d+)*[.)-]?\s+[A-Z][A-Za-z]/.test(trimmed)) return true;
  if (/^[A-Z][A-Za-z0-9/&,:'()\- ]{4,80}$/.test(trimmed) && !/[.!?]$/.test(trimmed)) return true;
  return false;
}

function splitIntoSections(text) {
  const lines = normalizeStudyText(text).split(/\n+/);
  const sections = [];
  let current = { heading: "Introduction", body: [] };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isHeadingLine(line)) {
      if (current.body.length) {
        sections.push({ heading: current.heading, body: current.body.join(" ").trim() });
      }
      current = { heading: line.replace(/^#+\s*/, "").trim(), body: [] };
      continue;
    }
    current.body.push(line);
  }
  if (current.body.length) {
    sections.push({ heading: current.heading, body: current.body.join(" ").trim() });
  }
  return sections.filter((section) => section.body);
}

function buildChunks(sections, maxChars = 2500) {
  const chunks = [];
  let current = { headings: [], text: "", startSection: 0, endSection: 0 };
  sections.forEach((section, index) => {
    const block = `${section.heading}\n${section.body}`;
    if (!current.text) {
      current = { headings: [section.heading], text: block, startSection: index, endSection: index };
      return;
    }
    if ((current.text + "\n\n" + block).length > maxChars) {
      chunks.push({ ...current, chunkId: `c${chunks.length + 1}` });
      current = { headings: [section.heading], text: block, startSection: index, endSection: index };
      return;
    }
    current.headings.push(section.heading);
    current.text += `\n\n${block}`;
    current.endSection = index;
  });
  if (current.text) chunks.push({ ...current, chunkId: `c${chunks.length + 1}` });
  return chunks;
}

function scoreChunksAgainstTopic(chunks, subject, topic) {
  const queryTerms = [...new Set([...normalizeComparable(subject).split(" "), ...normalizeComparable(topic).split(" ")].filter(Boolean))];
  return chunks
    .map((chunk) => {
      const headingText = normalizeComparable(chunk.headings.join(" "));
      const bodyText = normalizeComparable(chunk.text);
      let score = 0;
      for (const term of queryTerms) {
        if (headingText.includes(term)) score += 6;
        if (bodyText.includes(term)) score += 2;
      }
      return { ...chunk, score };
    })
    .sort((a, b) => b.score - a.score || a.startSection - b.startSection);
}

function detectMixedSubject(text, subject, topic) {
  const low = normalizeComparable(text);
  const active = Object.entries(SUBJECT_KEYWORDS)
    .map(([name, keywords]) => ({ name, score: keywords.reduce((sum, keyword) => sum + (low.includes(keyword) ? 1 : 0), 0) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const query = normalizeComparable(`${subject} ${topic}`);
  const dominant = active[0] || null;
  const second = active[1] || null;
  const isMixedSubject = !!(dominant && second && second.score >= Math.max(2, dominant.score - 1) && !query.includes(dominant.name));
  return {
    isMixedSubject,
    dominantSubject: dominant ? dominant.name : null,
    alternatives: second ? [second.name] : [],
    confidence: dominant ? dominant.score / Math.max(1, dominant.score + (second?.score || 0)) : 0,
  };
}

function selectRelevantChunks(scoredChunks, maxChars = 60000) {
  const chosen = [];
  let total = 0;
  for (const chunk of scoredChunks) {
    if (!chunk.text) continue;
    if (chosen.length >= 8) break;
    const nextLen = total + chunk.text.length;
    if (chosen.length && nextLen > maxChars) continue;
    chosen.push(chunk);
    total = nextLen;
    if (total >= maxChars) break;
  }
  if (!chosen.length && scoredChunks.length) return [scoredChunks[0]];
  return chosen;
}

function preprocessStudyText(text, subject, topic) {
  const normalized = normalizeStudyText(text);
  const sections = splitIntoSections(normalized);
  const chunks = buildChunks(sections.length ? sections : [{ heading: "Content", body: normalized }]);
  const scoredChunks = scoreChunksAgainstTopic(chunks, subject, topic);
  const selectedChunks = selectRelevantChunks(scoredChunks);
  const filteredText = selectedChunks.map((chunk) => chunk.text).join("\n\n").trim() || normalized;
  const mixed = detectMixedSubject(normalized, subject, topic);
  return {
    normalizedText: normalized,
    sections,
    selectedChunks,
    selectedHeadings: [...new Set(selectedChunks.flatMap((chunk) => chunk.headings))].slice(0, 12),
    filteredText,
    ...mixed,
  };
}

function ensureStructuredNotes(notesMarkdown) {
  const text = String(notesMarkdown || "").trim();
  if (!text) return;
  const required = ["# ", "## Overview", "## Key Concepts"];
  if (required.some((token) => !text.includes(token))) {
    throw new StudyToolError("Generated notes were not structured correctly.", 422, "INVALID_GENERATED_STRUCTURE");
  }
}

function classifyStudySource(text, fileName = "") {
  const combined = `${fileName}\n${text}`;
  const normalized = normalizeComparable(combined);
  const assignmentScore =
    ASSIGNMENT_KEYWORDS.reduce((sum, keyword) => sum + (normalized.includes(normalizeComparable(keyword)) ? 2 : 0), 0) +
    ((combined.match(/\b\d+[.)]\s+/g) || []).length >= 4 ? 4 : 0) +
    ((combined.match(/\b(question|q\.|problem)\s*\d+/gi) || []).length >= 3 ? 4 : 0);
  const studyScore = STUDY_KEYWORDS.reduce((sum, keyword) => sum + (normalized.includes(normalizeComparable(keyword)) ? 2 : 0), 0);

  if (assignmentScore >= Math.max(5, studyScore + 2)) {
    return { type: "assignment", confidence: assignmentScore, reason: "Content appears to be assignment-style." };
  }
  return { type: "study", confidence: Math.max(studyScore, 1), reason: "Content appears to be study/reference material." };
}

module.exports = {
  validateSpecificSubjectTopic,
  normalizeStudyText,
  splitIntoSections,
  buildChunks,
  scoreChunksAgainstTopic,
  selectRelevantChunks,
  detectMixedSubject,
  preprocessStudyText,
  ensureStructuredNotes,
  classifyStudySource,
};
