export function isQuestionAnswered(question, answer) {
  const qType = String(question?.questionType || "MCQ").toUpperCase();
  if (qType === "MCQ" || qType === "TRUE_FALSE") return answer?.selectedOptionId != null;
  if (qType === "SHORT_TEXT" || qType === "LONG") return String(answer?.textAnswer || "").trim().length > 0;
  if (qType === "NUMERIC") return Number.isFinite(Number(answer?.numberAnswer));
  if (qType === "MIX_MATCH_DRAG") {
    const leftItems = Array.isArray(question?.leftItems) ? question.leftItems : [];
    const matchMap = answer?.matchMap || {};
    return leftItems.length > 0 && leftItems.every((item) => Number(matchMap[item.leftMatchPairId] || 0) > 0);
  }
  return false;
}

export function isStudentQuizComplete(quiz, answers) {
  if (!Array.isArray(quiz?.questions)) return false;
  return quiz.questions.every((question) => isQuestionAnswered(question, answers?.[question.questionId]));
}

function rankQuestionType(questionType) {
  const normalized = String(questionType || "MCQ").toUpperCase();
  if (normalized === "MCQ") return 0;
  if (normalized === "SHORT_TEXT") return 1;
  if (normalized === "TRUE_FALSE") return 2;
  if (normalized === "NUMERIC") return 3;
  if (normalized === "MIX_MATCH_DRAG") return 4;
  if (normalized === "LONG") return 5;
  return 6;
}

export function orderQuizQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return [...questions].sort((a, b) => {
    const ra = rankQuestionType(a?.questionType);
    const rb = rankQuestionType(b?.questionType);
    if (ra !== rb) return ra - rb;
    return Number(a?.questionId || 0) - Number(b?.questionId || 0);
  });
}

export function canSubmitQuizAttempt({ quiz, answers, isManager }) {
  const isAssignmentQuiz = String(quiz?.assessmentType || "").toUpperCase() === "ASSIGNMENT";
  if (isAssignmentQuiz) return false;
  if (isManager) return true;
  return isStudentQuizComplete(quiz, answers);
}

export function getExportHeadingTitle(title, isAssignment = false) {
  const text = String(title || "").trim();
  if (!text) return isAssignment ? "Assignment" : "Quiz";
  if (/assignment/i.test(text)) {
    const numberMatch = text.match(/\d+/);
    return `Assignment${numberMatch ? ` ${numberMatch[0]}` : ""}`;
  }
  return text;
}

export function formatRemaining(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export function formatHeaderDate(value, includeTime = false) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (!includeTime) return datePart;
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} ${timePart}`;
}

export function formatCompactNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Number.isInteger(num) ? String(num) : String(num);
}
