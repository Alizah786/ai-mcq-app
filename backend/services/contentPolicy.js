function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const blockedPatterns = [
  /how\s+to\s+make\s+a\s+bomb/i,
  /build\s+a\s+bomb/i,
  /explosive\s+device/i,
  /phishing\s+(email|kit|attack)/i,
  /credit\s+card\s+fraud/i,
  /identity\s+theft/i,
  /bypass\s+2fa/i,
  /steal\s+password/i,
  /hate\s+speech/i,
  /racial\s+slur/i,
  /explicit\s+sexual/i,
  /pornographic/i,
  /self[-\s]?harm\s+instruction/i,
];

const nonEducationalIntentPatterns = [
  /\bfor\s+fun\s+only\b/i,
  /\bprank\b/i,
  /\brevenge\b/i,
  /\bharm\s+someone\b/i,
  /\bcheat\s+in\s+exam\b/i,
];

function checkPolicyText(text) {
  const source = String(text || "").trim();
  if (!source) return null;

  for (const re of blockedPatterns) {
    if (re.test(source)) {
      return "Content violates ethical/safety rules.";
    }
  }

  for (const re of nonEducationalIntentPatterns) {
    if (re.test(source)) {
      return "Content must be for educational purpose only.";
    }
  }

  return null;
}

function validateEducationalQuizEntry({
  quizTitle,
  topic,
  questionText,
  explanation,
  options = [],
}) {
  const checks = [
    { label: "Quiz title", text: quizTitle },
    { label: "Topic", text: topic },
    { label: "Question", text: questionText },
    { label: "Explanation", text: explanation },
  ];

  for (const opt of options) {
    checks.push({ label: "Option", text: opt });
  }

  for (const c of checks) {
    const err = checkPolicyText(c.text);
    if (err) return `${c.label}: ${err}`;
  }

  const q = normalizeText(questionText);
  if (q && (q.includes("kill") || q.includes("attack tutorial") || q.includes("hack account"))) {
    return "Question: Content violates ethical/safety rules.";
  }

  return null;
}

module.exports = {
  validateEducationalQuizEntry,
};

