import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { apiGet, apiPost, apiPut } from "../api/http";
import { useUIText } from "../context/UITextContext";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import InlineAlert from "../components/ui/InlineAlert";
import StatusPill from "../components/ui/StatusPill";
import QuizActionPanel from "./QuizActionPanel";
import QuizQuestionAssistPanel from "./QuizQuestionAssistPanel";
import {
  formatCompactNumber,
  formatDateTime,
  formatHeaderDate,
  formatRemaining,
  getExportHeadingTitle,
  isStudentQuizComplete,
  orderQuizQuestions,
} from "./quizUtils";
import { getRoleCode } from "../utils/domainCodes";

function normalizeExportQuestionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildExportQuestionSignature(question = {}) {
  const questionType = String(question?.questionType || "MCQ").toUpperCase();
  const base = [
    questionType,
    normalizeExportQuestionText(question?.questionText),
    normalizeExportQuestionText(question?.diagramType),
    normalizeExportQuestionText(question?.diagramData),
  ];
  if (questionType === "MCQ" || questionType === "TRUE_FALSE") {
    const options = (Array.isArray(question?.options) ? question.options : [])
      .map((option) => `${normalizeExportQuestionText(option?.label)}:${normalizeExportQuestionText(option?.text)}`);
    base.push(options.join("|"));
  } else if (questionType === "SHORT_TEXT" || questionType === "LONG") {
    base.push(normalizeExportQuestionText(question?.expectedAnswerText));
  } else if (questionType === "NUMERIC") {
    base.push(String(question?.expectedAnswerNumber ?? ""));
    base.push(String(question?.numericTolerance ?? ""));
  } else if (questionType === "MIX_MATCH_DRAG") {
    const pairs = (Array.isArray(question?.pairs) ? question.pairs : [])
      .map((pair) => `${normalizeExportQuestionText(pair?.leftText)}=>${normalizeExportQuestionText(pair?.rightText)}`)
      .sort();
    base.push(pairs.join("|"));
  }
  return base.join("::");
}

function dedupeQuestionsForExport(questions = []) {
  const seen = new Set();
  return (questions || []).filter((question) => {
    const signature = buildExportQuestionSignature(question);
    if (!signature) return true;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function dedupeQuizQuestions(questions = []) {
  const seen = new Set();
  return (questions || []).filter((question) => {
    const signature = buildExportQuestionSignature(question);
    if (!signature) return true;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function sanitizeQuizPayload(quiz) {
  if (!quiz || typeof quiz !== "object") return quiz;
  return {
    ...quiz,
    questions: dedupeQuizQuestions(Array.isArray(quiz.questions) ? quiz.questions : []),
  };
}

function isArcadeSuitableQuestion(question) {
  const qType = String(question?.questionType || "MCQ").toUpperCase();
  if (qType !== "MCQ" && qType !== "TRUE_FALSE") return false;

  const questionText = String(question?.questionText || "").trim();
  const options = Array.isArray(question?.options) ? question.options : [];
  if (!questionText || questionText.length > 140) return false;
  if (options.length < 2 || options.length > 6) return false;

  const totalOptionTextLength = options.reduce(
    (sum, option) => sum + String(option?.text || "").trim().length,
    0
  );
  if (totalOptionTextLength > 240) return false;

  return options.every((option) => {
    const optionText = String(option?.text || "").trim();
    return !!optionText && optionText.length <= 80;
  });
}

function MermaidDiagram({ code }) {
  const { t } = useTranslation();
  const [svg, setSvg] = useState("");
  const [renderErr, setRenderErr] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setRenderErr("");
      setSvg("");
      try {
        const mermaidMod = await import("mermaid");
        const mermaid = mermaidMod.default || mermaidMod;
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "default" });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const { svg: rendered } = await mermaid.render(id, String(code || ""));
        if (!cancelled) setSvg(rendered || "");
      } catch (e) {
        if (!cancelled) setRenderErr(e.message || "Failed to render diagram");
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (renderErr) {
    return (
      <div>
        <div style={{ color: "#b91c1c", fontSize: 12, marginBottom: 6 }}>{renderErr}</div>
        <pre style={{ margin: 0, padding: 10, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflowX: "auto" }}>
          {code}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return <div style={{ color: "#6b7280", fontSize: 13 }}>{t("quiz.renderingDiagram", "Rendering diagram...")}</div>;
  }

  return (
    <div
      style={{ margin: "8px 0 12px", padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, overflowX: "auto" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function Quiz() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isManager, selectedStudentId, user } = useAuth();
  const { loadCategoryKeys, t, msg } = useUIText();
  const { t: ti18n } = useTranslation();
  const exportRef = useRef(null);
  const exportHeaderRef = useRef(null);
  const exportQuestionRefs = useRef(new Map());

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [attemptId, setAttemptId] = useState(null);
  const [attemptLimit, setAttemptLimit] = useState(1);
  const [attemptsRemaining, setAttemptsRemaining] = useState(0);
  const [attemptSummary, setAttemptSummary] = useState([]);
  const [attemptStartedAtUtc, setAttemptStartedAtUtc] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [timerRunning, setTimerRunning] = useState(true);
  const [submittingAttempt, setSubmittingAttempt] = useState(false);
  const [confirmIncompleteSubmitOpen, setConfirmIncompleteSubmitOpen] = useState(false);
  const autoSubmitRef = useRef(false);

  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [showPostExplanations, setShowPostExplanations] = useState(false);
  const [hintCardOpen, setHintCardOpen] = useState({});
  const [explanationCardOpen, setExplanationCardOpen] = useState({});
  const [visibilityBusy, setVisibilityBusy] = useState({});
  const [subscription, setSubscription] = useState(null);
  const [oneQuestionAtATime, setOneQuestionAtATime] = useState(true);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const autoExportTriggeredRef = useRef(false);
  const autoExportRequested = searchParams.get("autoExport") === "1";

  const showResults = Boolean(result);
  const isAssignedStudent =
    getRoleCode(user) === "STUDENT" &&
    Number(user?.managerId || 0) > 0 &&
    !user?.isDirectStudent;
  const allowRevealAfterSubmit = !!quiz?.revealAnswersAfterSubmit;
  const revealCorrectAnswers =
    showResults &&
    (isManager || (allowRevealAfterSubmit && Number(attemptsRemaining || 0) === 0));
  const isFreePlan = !!subscription && (!!subscription.isTrial || Number(subscription.price || 0) <= 0);
  const hintLockedForFreePlan = !isManager && isFreePlan && !!subscription?.lockHintForFreePlan;
  const studentWatermarkExport = !isManager && getRoleCode(user) === "STUDENT" && isFreePlan;
  const pdfLockedForFreePlan = !studentWatermarkExport && !isManager && isFreePlan && !!subscription?.lockPdfForFreePlan;

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "quiz.loading",
      "quiz.noQuizFound",
      "quiz.timeLeft.label",
      "quiz.pause.button",
      "quiz.resume.button",
      "quiz.downloadPdf.button",
      "quiz.downloadSolvedPdf.button",
      "quiz.exportWatermark.student",
      "quiz.submit.button",
      "quiz.submitting.button",
      "quiz.clear.button",
      "quiz.showHint.button",
      "quiz.hideHint.button",
      "quiz.result.title",
      "quiz.showExplanations.button",
      "quiz.hideExplanations.button",
      "quiz.startNextAttempt.button",
      "quiz.explanation.title",
      "quiz.diagram.title",
      "quiz.notAnswered",
      "quiz.questionType.mcq",
      "quiz.questionType.short",
      "quiz.questionType.trueFalse",
      "quiz.questionType.numeric",
      "quiz.questionType.long",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "quiz.selectStudent.error",
      "quiz.noQuestions.error",
      "quiz.submitIncomplete.error",
      "quiz.timeUp.error",
      "quiz.paidFeatureOnly.error",
      "quiz.hiddenForStudents.label",
      "quiz.noExplanation.label",
      "quiz.hintPrompt.label",
    ]).catch(() => {});
    loadCategoryKeys("UI_PLACEHOLDER", [
      "quiz.answer.numeric.placeholder",
      "quiz.answer.long.placeholder",
      "quiz.answer.short.placeholder",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  function questionTypeLabel(qType) {
    const normalized = String(qType || "MCQ").toUpperCase();
    if (normalized === "MCQ") return t("quiz.questionType.mcq", "MCQ");
    if (normalized === "SHORT_TEXT") return t("quiz.questionType.short", "Short");
    if (normalized === "TRUE_FALSE") return t("quiz.questionType.trueFalse", "True/False");
    if (normalized === "NUMERIC") return t("quiz.questionType.numeric", "Numeric");
    if (normalized === "MIX_MATCH_DRAG") return ti18n("quiz.questionType.match", "Match");
    if (normalized === "LONG") return t("quiz.questionType.long", "Long");
    return normalized;
  }

  async function loadLatestSubmittedResult({ latestAttemptId, quizData, summary, limit }) {
    const submitted = Array.isArray(summary) ? summary.filter((item) => item?.submitted) : [];
    const fallbackAttemptId = submitted.length ? Number(submitted[submitted.length - 1]?.attemptId || 0) || null : null;
    const resolvedAttemptId = Number(latestAttemptId || 0) || fallbackAttemptId;
    if (!resolvedAttemptId) return false;
    const resultData = await apiGet(`/api/attempts/${resolvedAttemptId}/result`);
    setAttemptId(resolvedAttemptId);
    if (quizData) setQuiz(sanitizeQuizPayload(quizData));
    setAttemptLimit(Number(resultData?.attemptLimit || limit || 1));
    setAttemptsRemaining(Number(resultData?.attemptsRemaining || 0));
    setAttemptSummary(Array.isArray(resultData?.attemptSummary) ? resultData.attemptSummary : submitted);
    setAttemptStartedAtUtc(submitted.length ? submitted[submitted.length - 1]?.startedAtUtc || null : null);
    setResult(resultData || null);
    setTimerRunning(false);
    return true;
  }

  useEffect(() => {
    let alive = true;

    async function start() {
      try {
        setLoading(true);
        setErr("");
        setResult(null);
        setAnswers({});
        setShowHints(false);
        setShowPostExplanations(false);
        setHintCardOpen({});
        setExplanationCardOpen({});
        if (autoExportRequested && isManager) {
          const draftQuiz = await apiGet(`/api/quizzes/${quizId}`);
          if (!alive) return;
          setAttemptId(null);
          setQuiz(sanitizeQuizPayload(draftQuiz || null));
          setAttemptLimit(1);
          setAttemptsRemaining(0);
          setAttemptSummary([]);
          setAttemptStartedAtUtc(null);
          setTimerRunning(false);
          return;
        }

        if (isManager && !selectedStudentId) {
          setErr(msg("quiz.selectStudent.error", "Select a student from sidebar before starting quiz."));
          return;
        }

        const studentQuery = isManager && selectedStudentId ? `?studentId=${selectedStudentId}` : "";
        const data = await apiPost(`/api/quizzes/${quizId}/attempts/start${studentQuery}`, {});
        if (!alive) return;

        if (!data?.quiz?.questions?.length) {
          setErr(msg("quiz.noQuestions.error", "Quiz has no questions yet. Add questions before attempting."));
          setAttemptId(data?.attemptId ?? null);
          setQuiz(sanitizeQuizPayload(data?.quiz ?? null));
          return;
        }

        setAttemptId(data.attemptId);
        setQuiz(sanitizeQuizPayload(data.quiz));
        setAttemptLimit(Number(data.attemptLimit || 1));
        setAttemptsRemaining(Number(data.attemptsRemaining || 0));
        setAttemptSummary(Array.isArray(data.attemptSummary) ? data.attemptSummary : []);
        setAttemptStartedAtUtc(data?.attemptStartedAtUtc || null);
      } catch (e) {
        if (!alive) return;
        const payload = e?.payload || {};
        const attemptsExhausted =
          Number(payload?.attemptsRemaining) === 0
          && (payload?.errorCode === "QUIZ_ATTEMPT_LIMIT_REACHED" || /maximum attempts reached/i.test(String(e?.message || "")));
        if (attemptsExhausted) {
          try {
            const opened = await loadLatestSubmittedResult({
              latestAttemptId: payload?.latestSubmittedAttemptId,
              quizData: payload?.quiz || null,
              summary: payload?.attemptSummary || [],
              limit: payload?.attemptLimit || 1,
            });
            if (opened) {
              setErr("");
              return;
            }
          } catch {}
        }
        setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    start();
    return () => {
      alive = false;
    };
  }, [quizId, isManager, selectedStudentId]);

  useEffect(() => {
    let alive = true;
    async function loadSubscription() {
      try {
        const res = await apiGet("/api/billing/subscription-status");
        if (!alive) return;
        setSubscription(res.subscription || null);
      } catch {
        if (!alive) return;
        setSubscription(null);
      }
    }
    loadSubscription();
    return () => {
      alive = false;
    };
  }, [user?.userId]);

  function onSelect(questionId, optionId) {
    if (showResults) return;
    setAnswers((prev) => ({ ...prev, [questionId]: { selectedOptionId: optionId } }));
  }

  function onTextAnswer(questionId, value) {
    if (showResults) return;
    setAnswers((prev) => ({ ...prev, [questionId]: { textAnswer: value } }));
  }

  function onNumberAnswer(questionId, value) {
    if (showResults) return;
    setAnswers((prev) => ({ ...prev, [questionId]: { numberAnswer: value } }));
  }

  function onMatchAnswer(questionId, leftMatchPairId, rightMatchPairId) {
    if (showResults) return;
    const normalizedRightId = Number(rightMatchPairId || 0) || null;
    if (!normalizedRightId) {
      clearMatchAnswer(questionId, leftMatchPairId);
      return;
    }
    setAnswers((prev) => {
      const current = prev[questionId]?.matchMap || {};
      const nextMap = { ...current };
      for (const [leftId, assignedRightId] of Object.entries(nextMap)) {
        if (Number(leftId) !== Number(leftMatchPairId) && Number(assignedRightId) === normalizedRightId) {
          delete nextMap[leftId];
        }
      }
      nextMap[leftMatchPairId] = normalizedRightId;
      return {
        ...prev,
        [questionId]: {
          ...prev[questionId],
          matchMap: nextMap,
        },
      };
    });
  }

  function clearMatchAnswer(questionId, leftMatchPairId) {
    if (showResults) return;
    setAnswers((prev) => {
      const current = prev[questionId]?.matchMap || {};
      const nextMap = { ...current };
      delete nextMap[leftMatchPairId];
      return {
        ...prev,
        [questionId]: {
          ...prev[questionId],
          matchMap: nextMap,
        },
      };
    });
  }

  const studentAllAnswered = isStudentQuizComplete(quiz, answers);
  const isAssignmentQuiz = String(quiz?.assessmentType || "").toUpperCase() === "ASSIGNMENT";
  const canAttemptSubmit = !isAssignmentQuiz && !!quiz?.questions?.length;
  const orderedQuestions = orderQuizQuestions(quiz?.questions);
  const arcadeEligible =
    !isAssignmentQuiz &&
    !!orderedQuestions.length &&
    orderedQuestions.every((question) => isArcadeSuitableQuestion(question));
  useEffect(() => {
    if (!orderedQuestions.length) {
      setCurrentQuestionIndex(0);
      return;
    }
    setCurrentQuestionIndex((prev) => Math.min(prev, orderedQuestions.length - 1));
  }, [orderedQuestions.length]);

  useEffect(() => {
    if (!quiz) {
      setRemainingSeconds(null);
      return;
    }
    if (isAssignmentQuiz) {
      setRemainingSeconds(null);
      return;
    }
    const timeLimitMinutes = Math.max(0, Number(quiz?.timeLimitMinutes || 0));
    if (timeLimitMinutes <= 0) {
      setRemainingSeconds(null);
      return;
    }
    const startMs = attemptStartedAtUtc ? new Date(attemptStartedAtUtc).getTime() : Date.now();
    const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const initial = Math.max(0, timeLimitMinutes * 60 - elapsed);
    autoSubmitRef.current = false;
    setRemainingSeconds(initial);
    setTimerRunning(!showResults && initial > 0);
  }, [quiz?.timeLimitMinutes, attemptStartedAtUtc, showResults, attemptId, isAssignmentQuiz]);

  useEffect(() => {
    if (isAssignmentQuiz) return;
    if (showResults || remainingSeconds == null || !timerRunning) return;
    if (remainingSeconds <= 0) return;
    const t = setTimeout(() => {
      setRemainingSeconds((s) => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearTimeout(t);
  }, [showResults, remainingSeconds, timerRunning, isAssignmentQuiz]);

  useEffect(() => {
    if (isAssignmentQuiz) return;
    if (showResults || remainingSeconds == null) return;
    if (remainingSeconds > 0) return;
    if (autoSubmitRef.current) return;
    autoSubmitRef.current = true;
    setErr(msg("quiz.timeUp.error", "Time is up. Submitting your quiz now."));
    handleSubmit(true);
  }, [remainingSeconds, showResults, msg, isAssignmentQuiz]);

  useEffect(() => {
    if (!autoExportRequested || autoExportTriggeredRef.current) return;
    if (loading || !quiz || showResults) return;
    autoExportTriggeredRef.current = true;
    handleExportSolvedPdf();
  }, [autoExportRequested, loading, quiz, showResults]);

  async function handleSubmit(forceSubmit = false) {
    if (submittingAttempt) return;
    if (!quiz?.questions?.length) return;
    if (isAssignmentQuiz) return;
    if (!forceSubmit && !studentAllAnswered) {
      setConfirmIncompleteSubmitOpen(true);
      setErr("");
      return;
    }
    try {
      setSubmittingAttempt(true);
      setErr("");

      const payload = {
        answers: quiz.questions.map((q) => ({
          questionId: q.questionId,
          selectedOptionId: answers[q.questionId]?.selectedOptionId ?? null,
          textAnswer: String(answers[q.questionId]?.textAnswer || "").trim() || null,
          numberAnswer:
            answers[q.questionId]?.numberAnswer === "" || answers[q.questionId]?.numberAnswer == null
              ? null
              : Number(answers[q.questionId]?.numberAnswer),
          matchAnswers:
            String(q.questionType || "MCQ").toUpperCase() === "MIX_MATCH_DRAG"
              ? (q.leftItems || []).map((item) => ({
                  leftMatchPairId: Number(item.leftMatchPairId),
                  selectedRightMatchPairId: Number(answers[q.questionId]?.matchMap?.[item.leftMatchPairId] || 0) || null,
                }))
              : undefined,
        })),
      };

      const submitRes = await apiPost(`/api/attempts/${attemptId}/submit`, payload);
      setAttemptLimit(Number(submitRes?.attemptLimit || attemptLimit || 1));
      setAttemptsRemaining(Number(submitRes?.attemptsRemaining || 0));
      setAttemptSummary(Array.isArray(submitRes?.attemptSummary) ? submitRes.attemptSummary : attemptSummary);
      const res = await apiGet(`/api/attempts/${attemptId}/result`);
      setAttemptLimit(Number(res?.attemptLimit || attemptLimit || 1));
      setAttemptsRemaining(Number(res?.attemptsRemaining || 0));
      setAttemptSummary(Array.isArray(res?.attemptSummary) ? res.attemptSummary : attemptSummary);
      setResult(res);
      setTimerRunning(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmittingAttempt(false);
    }
  }

  function handleClearAnswers() {
    setAnswers({});
  }

  async function handleStartNextAttempt() {
    if (!quizId) return;
    try {
      setErr("");
      const studentQuery = isManager && selectedStudentId ? `?studentId=${selectedStudentId}` : "";
      const data = await apiPost(`/api/quizzes/${quizId}/attempts/start${studentQuery}`, {});
      setAttemptId(data.attemptId);
      setQuiz(sanitizeQuizPayload(data.quiz));
      setAttemptLimit(Number(data.attemptLimit || 1));
      setAttemptsRemaining(Number(data.attemptsRemaining || 0));
      setAttemptSummary(Array.isArray(data.attemptSummary) ? data.attemptSummary : []);
      setAttemptStartedAtUtc(data?.attemptStartedAtUtc || null);
      setAnswers({});
      setResult(null);
      setShowHints(false);
      setShowPostExplanations(false);
      setHintCardOpen({});
      setExplanationCardOpen({});
      setTimerRunning(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr(e.message || "Failed to start next attempt");
    }
  }

  function renderAttemptMarks() {
    const submitted = (attemptSummary || []).filter((a) => a && a.submitted);
    if (!submitted.length) return null;
    return (
      <div style={{ marginTop: 8, color: "#374151", fontSize: 13 }}>
        {submitted.map((a, idx) => {
          const score = Number(a.score || 0);
          const total = Number(a.total || 0);
          const pct = Number.isFinite(Number(a.scorePercent)) ? Number(a.scorePercent) : (total > 0 ? Math.round((score * 10000) / total) / 100 : 0);
          return (
            <span key={a.attemptId} style={{ marginRight: 14 }}>
              Attempt {idx + 1}: <b>{score}/{total}</b> ({pct}%)
            </span>
          );
        })}
      </div>
    );
  }

  function getDetail(questionId) {
    return result?.details?.find((d) => d.questionId === questionId) || null;
  }

  function getHintSteps(text) {
    if (!text) return "";
    const lines = String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.slice(0, 3).join("\n");
  }

  function renderDiagram(question) {
    const detail = showResults ? getDetail(question.questionId) : null;
    const diagramType = detail?.diagramType || question.diagramType || "none";
    const diagramData = detail?.diagramData || question.diagramData || null;
    if (!diagramData || diagramType === "none") return null;

    if (diagramType === "svg") {
      return (
        <div
          style={{ margin: "8px 0 12px", padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10 }}
          dangerouslySetInnerHTML={{ __html: diagramData }}
        />
      );
    }

    if (diagramType === "mermaid") {
      return <MermaidDiagram code={diagramData} />;
    }

    return null;
  }

  function getOptionStyle(questionId, optionId) {
    if (!showResults) {
      const selected = answers[questionId]?.selectedOptionId === optionId;
      return {
        border: selected ? "2px solid #2563eb" : "1px solid #e5e7eb",
        background: selected ? "#eff6ff" : "#fff",
      };
    }

    const detail = getDetail(questionId);
    if (!revealCorrectAnswers) {
      const selected = detail?.selectedOptionId === optionId;
      return {
        border: selected ? "2px solid #2563eb" : "1px solid #e5e7eb",
        background: selected ? "#eff6ff" : "#fff",
      };
    }
    const isCorrect = detail?.correctOptionId === optionId;
    const isWrongSelected =
      detail?.selectedOptionId === optionId && detail?.selectedOptionId !== detail?.correctOptionId;

    if (isCorrect) return { border: "2px solid #16a34a", background: "#dcfce7" };
    if (isWrongSelected) return { border: "2px solid #dc2626", background: "#fee2e2" };
    return { border: "1px solid #e5e7eb", background: "#fff" };
  }

  function renderBadge(questionId, optionId) {
    if (!showResults || !revealCorrectAnswers) return null;
    const detail = getDetail(questionId);
    const isCorrect = detail?.correctOptionId === optionId;
    const isWrongSelected =
      detail?.selectedOptionId === optionId && detail?.selectedOptionId !== detail?.correctOptionId;

    if (isCorrect) return <span style={{ marginLeft: 8 }}>[Correct]</span>;
    if (isWrongSelected) return <span style={{ marginLeft: 8 }}>[Wrong]</span>;
    return null;
  }

  async function handleExportSolvedPdf() {
    if (!exportRef.current) return;
    try {
      setPdfBusy(true);
      setIsExporting(true);
      const { jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas");
      const MAX_PDF_BYTES = 10 * 1024 * 1024;
      const exportQuestions = dedupeQuestionsForExport(orderQuizQuestions(quiz?.questions));
      await new Promise((resolve) => setTimeout(resolve, 120));

      let quality = 0.85;
      let pdf = null;
      let pdfSize = Number.MAX_SAFE_INTEGER;

      while (quality >= 0.35) {
        const nextPdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4", compress: true });
        const pdfWidth = nextPdf.internal.pageSize.getWidth();
        const pdfHeight = nextPdf.internal.pageSize.getHeight();
        const pageMargin = 32;
        const footerReserve = 24;
        const renderWidth = pdfWidth - pageMargin * 2;
        let cursorY = pageMargin;

        const captureSection = async (node) => {
          if (!node) return null;
          const canvas = await html2canvas(node, {
            scale: 1.1,
            backgroundColor: "#ffffff",
            useCORS: true,
          });
          return {
            width: canvas.width,
            height: canvas.height,
            dataUrl: canvas.toDataURL("image/jpeg", quality),
          };
        };

        const headerImage = await captureSection(exportHeaderRef.current);
        if (headerImage) {
          const headerHeight = (headerImage.height * renderWidth) / headerImage.width;
          nextPdf.addImage(headerImage.dataUrl, "JPEG", pageMargin, cursorY, renderWidth, headerHeight);
          cursorY += headerHeight + 8;
        }

        for (let i = 0; i < exportQuestions.length; i++) {
          const question = exportQuestions[i];
          const questionRefKey = String(question?.questionId ?? `export-${i}`);
          const questionNode = exportQuestionRefs.current.get(questionRefKey);
          const questionImage = await captureSection(questionNode);
          if (!questionImage) continue;
          const questionHeight = (questionImage.height * renderWidth) / questionImage.width;
          const maxUsableHeight = pdfHeight - pageMargin - footerReserve;
          if (cursorY + questionHeight > maxUsableHeight && cursorY > pageMargin) {
            nextPdf.addPage();
            cursorY = pageMargin;
          }
          nextPdf.addImage(questionImage.dataUrl, "JPEG", pageMargin, cursorY, renderWidth, questionHeight);
          cursorY += questionHeight + 6;
        }

        const bytes = nextPdf.output("arraybuffer").byteLength;
        pdf = nextPdf;
        pdfSize = bytes;
        if (bytes <= MAX_PDF_BYTES) break;
        quality -= 0.1;
      }

      if (!pdf || pdfSize > MAX_PDF_BYTES) {
        setErr("PDF is still larger than 10 MB. Try fewer questions or shorter content.");
        return;
      }

      if (studentWatermarkExport) {
        const watermarkText = t("quiz.exportWatermark.student", "Student Free Trial Export");
        const pageCount = pdf.getNumberOfPages();
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
          pdf.setPage(pageNo);
          pdf.saveGraphicsState();
          pdf.setTextColor(180, 188, 204);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(34);
          pdf.text(watermarkText, pageWidth / 2, pageHeight / 2, {
            align: "center",
            angle: 32,
          });
          pdf.setFontSize(10);
          pdf.text(watermarkText, pageWidth / 2, pageHeight - 22, { align: "center" });
          pdf.restoreGraphicsState();
        }
      }

      {
        const pageCount = pdf.getNumberOfPages();
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
          pdf.setPage(pageNo);
          pdf.saveGraphicsState();
          pdf.setTextColor(90, 100, 120);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(9);
          pdf.text(`Page ${pageNo} of ${pageCount}`, pageWidth - 36, pageHeight - 16, { align: "right" });
          pdf.restoreGraphicsState();
        }
      }

      const safeTitle = String(quiz?.title || "quiz")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 60);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      pdf.save(`${safeTitle}_${stamp}.pdf`);
    } catch (e) {
      setErr(e.message || "Failed to export PDF");
    } finally {
      setIsExporting(false);
      setPdfBusy(false);
    }
  }

  async function handleQuestionVisibility(questionId, isHiddenForStudent) {
    if (!isManager) return;
    setErr("");
    setVisibilityBusy((prev) => ({ ...prev, [questionId]: true }));
    try {
      await apiPut(`/api/questions/${questionId}/visibility`, { isHiddenForStudent });
      setQuiz((prev) => {
        if (!prev?.questions) return prev;
        return {
          ...prev,
          questions: prev.questions.map((q) =>
            q.questionId === questionId ? { ...q, isHiddenForStudent } : q
          ),
        };
      });
    } catch (e) {
      setErr(e.message || "Failed to update question visibility");
    } finally {
      setVisibilityBusy((prev) => ({ ...prev, [questionId]: false }));
    }
  }

  if (loading) return <div>{t("quiz.loading", "Loading quiz...")}</div>;
  if (!quiz && err) return <div style={{ color: "crimson" }}>Error: {err}</div>;
  if (!quiz) return <div>{t("quiz.noQuizFound", "No quiz found.")}</div>;
  const isAssignment = isAssignmentQuiz;

  const exportTopLine = [
    quiz?.showClassNameOnExport ? quiz?.className : "",
    quiz?.showCourseCodeOnExport ? quiz?.courseCode : "",
    quiz?.showTermOnExport ? quiz?.term : "",
  ].filter(Boolean).join(" - ");
  const derivedTotalMarks = (() => {
    if (quiz?.totalMarks != null) return formatCompactNumber(quiz.totalMarks);
    const sum = Array.isArray(quiz?.questions)
      ? quiz.questions.reduce((acc, q) => acc + Math.max(0, Number(q?.points || 0)), 0)
      : 0;
    if (!Number.isFinite(sum) || sum <= 0) return null;
    return formatCompactNumber(sum);
  })();
  const exportMetaParts = [
    quiz?.showSubjectOnExport && quiz?.subject ? `Subject: ${quiz.subject}.` : "",
    quiz?.showGradeLevelOnExport && quiz?.gradeLevel ? `Grade Level: ${quiz.gradeLevel}.` : "",
    quiz?.deadlineUtc
      ? `Deadline: ${formatHeaderDate(quiz.deadlineUtc, isAssignment)}.`
      : "",
    derivedTotalMarks != null
      ? `Total: ${derivedTotalMarks} marks.`
      : (isAssignment ? "Total: Not set." : ""),
    quiz?.weightPercent != null
      ? `Weight: ${formatCompactNumber(quiz.weightPercent)}%.`
      : (isAssignment ? "Weight: Not set." : ""),
  ].filter(Boolean);
  const exportExtraHeaderLines = Array.isArray(quiz?.headerExtraLines)
    ? quiz.headerExtraLines
        .filter((line) => (line?.showOnHeader ?? true) && String(line?.text || "").trim())
        .map((line) => String(line.text || "").trim())
    : [];
  const assignmentExportMode = isAssignment && isExporting;
  const exportDocumentMode = isExporting;
  const exportQuestions = exportDocumentMode ? dedupeQuestionsForExport(orderedQuestions) : orderedQuestions;
  const displayedQuestions =
    exportDocumentMode
      ? exportQuestions
      : !showResults && !exportDocumentMode && oneQuestionAtATime
      ? orderedQuestions.slice(currentQuestionIndex, currentQuestionIndex + 1)
      : orderedQuestions;

  return (
    <div
      ref={exportRef}
      style={{
        maxWidth: exportDocumentMode ? 780 : "100%",
        margin: exportDocumentMode ? "0 auto" : "0",
        padding: assignmentExportMode ? "16px 24px 24px" : (exportDocumentMode ? "18px 26px 28px" : "0 0 20px"),
        background: exportDocumentMode ? "#fff" : "transparent",
      }}
    >
      {!exportDocumentMode && (
        <div style={{ marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            style={{
              padding: 0,
              border: "none",
              background: "transparent",
              color: "#1d4ed8",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {ti18n("common.backToDashboard", "< Back to Dashboard")}
          </button>
        </div>
      )}
      <div ref={exportHeaderRef}>
      <Card
        style={{ color: "#111827", padding: exportDocumentMode ? "4px 2px 14px" : "14px 16px 10px", marginBottom: 10, boxShadow: exportDocumentMode ? "none" : undefined, border: exportDocumentMode ? "none" : undefined }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, fontSize: 16, fontFamily: "Georgia, 'Times New Roman', serif" }}>
          <div style={{ fontWeight: 500 }}>{exportTopLine || quiz.title}</div>
          <div style={{ fontWeight: 500 }}>{quiz?.instructorNameLabel || quiz?.instructorLabel || ""}</div>
        </div>
        <div style={{ height: 1, background: "#111827", marginTop: 2, marginBottom: 24 }} />
        <div style={{ textAlign: "center", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 28, lineHeight: 1.2, marginBottom: 10 }}>
          {getExportHeadingTitle(quiz.title, isAssignment)}
        </div>
        {!!exportMetaParts.length && (
          <div style={{ textAlign: "center", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 16, lineHeight: 1.45, marginBottom: 18 }}>
            {exportMetaParts.join("  ")}
          </div>
        )}
        {!!exportExtraHeaderLines.length && (
          <div style={{ textAlign: assignmentExportMode ? "left" : "center", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 16, lineHeight: 1.45, marginBottom: 18 }}>
            {exportExtraHeaderLines.map((line, index) => (
              <div key={`header-extra-line-${index}`}>
                {assignmentExportMode && index === 0 ? <b>{ti18n("quiz.instructions", "Instructions")}:</b> : null}
                {assignmentExportMode && index === 0 ? " " : ""}
                {line}
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 1, background: "#111827", marginBottom: 14 }} />
        {!exportDocumentMode && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <StatusPill tone="accent">{getExportHeadingTitle(quiz.title, isAssignment)}</StatusPill>
              <StatusPill tone="neutral">
                {ti18n("quiz.attempts", "Attempts")}: {Math.max(0, Number(attemptLimit || 1) - Number(attemptsRemaining || 0))}/{Number(attemptLimit || 1)}
              </StatusPill>
              {quiz?.createDate ? <StatusPill tone="neutral">{ti18n("quiz.created", "Created")}: {formatDateTime(quiz.createDate)}</StatusPill> : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!showResults && arcadeEligible && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/quiz/${quizId}/arcade`)}
                >
                  {ti18n("quiz.arcade.button", "Arcade Mode")}
                </Button>
              )}
              {!showResults && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>
                  <input
                    type="checkbox"
                    checked={oneQuestionAtATime}
                    onChange={(e) => {
                      setOneQuestionAtATime(e.target.checked);
                      setCurrentQuestionIndex(0);
                    }}
                  />
                  {ti18n("quiz.oneQuestionAtATime", "One question at a time")}
                </label>
              )}
              <div style={{ color: "var(--text-muted)", fontSize: 13, whiteSpace: "nowrap" }}>
                {ti18n("quiz.session", "Session")}: quiz {quizId} • attempt {attemptId}
              </div>
            </div>
          </div>
        )}
      </Card>
      </div>
      {!isAssignment && !exportDocumentMode && remainingSeconds != null && (
        <Card
          tone="subtle"
          padding="sm"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 10,
            background: remainingSeconds <= 60 ? "#fff1f2" : "#f8fafc",
            padding: "10px 14px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, color: remainingSeconds <= 60 ? "#b91c1c" : "#111827", whiteSpace: "nowrap" }}>
              {t("quiz.timeLeft.label", "Time Left")}: {formatRemaining(remainingSeconds)}
            </div>
            {!showResults && (
              <Button
                type="button"
                onClick={() => setTimerRunning((v) => !v)}
                variant="secondary"
                size="sm"
              >
                {timerRunning ? t("quiz.pause.button", "Pause") : t("quiz.resume.button", "Resume")}
              </Button>
            )}
            {!!err && (
              <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 500 }}>
                {err}
              </div>
            )}
          </div>
        </Card>
      )}
      {!!err && !exportDocumentMode && (isAssignment || remainingSeconds == null) && (
        <InlineAlert tone="danger" style={{ marginBottom: 12 }}>
          {err}
        </InlineAlert>
      )}
      {showResults && !revealCorrectAnswers && !exportDocumentMode && (
        <InlineAlert tone="warning" style={{ marginBottom: 12, fontWeight: 600 }}>
          {allowRevealAfterSubmit
            ? ti18n("quiz.correctAnswersAfterAttempts", "Correct answers will be shown after all attempts are completed.")
            : ti18n("quiz.correctAnswersHidden", "Correct answers are hidden for this quiz.")}
        </InlineAlert>
      )}
      {confirmIncompleteSubmitOpen && !exportDocumentMode && (
        <Card
          tone="subtle"
          style={{
            marginBottom: 12,
            border: "1px solid #fdba74",
            background: "#fff7ed",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ color: "#9a3412", fontSize: 14, fontWeight: 700 }}>
              {ti18n("quiz.confirmIncomplete", "Quiz is not completed yet. Do you still want to submit?")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmIncompleteSubmitOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setConfirmIncompleteSubmitOpen(false);
                  handleSubmit(true);
                }}
              >
                {ti18n("quiz.submitAnyway", "Submit Anyway")}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {!showResults && !exportDocumentMode && oneQuestionAtATime && orderedQuestions.length > 1 && (
        <Card tone="subtle" padding="sm" style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12 }}>
            <div style={{ color: "#1e293b", fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>
              {ti18n("quiz.questionOf", "Question {{current}} of {{total}}", { current: currentQuestionIndex + 1, total: orderedQuestions.length })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Button
                type="button"
                variant="secondary"
                disabled={currentQuestionIndex <= 0}
                onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
                style={{ minWidth: 88, fontWeight: 800, padding: "10px 18px" }}
              >
                {ti18n("common.back", "Back")}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={currentQuestionIndex >= orderedQuestions.length - 1}
                onClick={() => setCurrentQuestionIndex((prev) => Math.min(orderedQuestions.length - 1, prev + 1))}
                style={{ minWidth: 88, fontWeight: 800, padding: "10px 18px" }}
              >
                {ti18n("common.next", "Next")}
              </Button>
            </div>
            <div />
          </div>
        </Card>
      )}

      {displayedQuestions.map((q) => {
        const idx = orderedQuestions.findIndex((item) => item.questionId === q.questionId);
        const hiddenForStudent = !!q.isHiddenForStudent;
        const managerHiddenPreview = isManager && hiddenForStudent;
        const detail = getDetail(q.questionId);
        const qType = String(q.questionType || "MCQ").toUpperCase();
        const diagramTypeForQuestion = detail?.diagramType || q.diagramType || "none";
        const diagramDataForQuestion = detail?.diagramData || q.diagramData || null;
        const hasDiagram =
          !!diagramDataForQuestion && String(diagramTypeForQuestion).toLowerCase() !== "none";
        const unanswered = showResults
          && !(
            detail?.selectedOptionId != null
            || String(detail?.selectedTextAnswer || "").trim()
            || detail?.selectedNumberAnswer != null
          );
        const explanationText = showResults
          ? (showPostExplanations || !!explanationCardOpen[q.questionId])
            ? detail?.explanation || ""
            : ""
          : (showHints || !!hintCardOpen[q.questionId])
            ? getHintSteps(q.explanation || "")
            : "";
        const showThisExplanation = showResults && (showPostExplanations || !!explanationCardOpen[q.questionId]);
        const showThisHint = !showResults && (showHints || !!hintCardOpen[q.questionId]);
        const isCardTextOpen = showResults ? showThisExplanation : showThisHint;

        return (
          <div
            key={q.questionId}
            ref={(node) => {
              const refKey = String(q?.questionId ?? `export-${idx}`);
              if (node) exportQuestionRefs.current.set(refKey, node);
              else exportQuestionRefs.current.delete(refKey);
            }}
            style={{
              breakInside: exportDocumentMode ? "avoid" : undefined,
              pageBreakInside: exportDocumentMode ? "avoid" : undefined,
            }}
          >
          <Card
            style={{
              background: assignmentExportMode ? "#fff" : (managerHiddenPreview ? "#f8fafc" : "#fff"),
              border: exportDocumentMode ? "none" : "2px solid #94a3b8",
              borderRadius: exportDocumentMode ? 0 : 14,
              padding: exportDocumentMode ? "0 0 6px" : 14,
              marginBottom: exportDocumentMode ? 8 : 14,
              opacity: managerHiddenPreview ? 0.72 : 1,
            }}
          >
            <div
              style={{
                display: exportDocumentMode ? "block" : "grid",
                gridTemplateColumns: exportDocumentMode
                  ? undefined
                  : hasDiagram
                  ? (isAssignment
                    ? "minmax(620px, 2.5fr) minmax(260px, 1fr)"
                    : "minmax(480px, 2fr) minmax(230px, 0.9fr) minmax(260px, 1fr)")
                  : (isAssignment
                    ? "minmax(740px, 1fr)"
                    : "minmax(520px, 2.3fr) minmax(300px, 1fr)"),
                gap: exportDocumentMode ? 8 : (assignmentExportMode ? 6 : 14),
                alignItems: "start",
              }}
            >
              <div>
                <div style={{ marginBottom: assignmentExportMode ? 2 : 8 }}>
                  <div style={{ fontWeight: exportDocumentMode ? 500 : 800, fontSize: exportDocumentMode ? 17 : 20, lineHeight: exportDocumentMode ? 1.38 : 1.35, fontFamily: exportDocumentMode ? "Georgia, 'Times New Roman', serif" : "inherit" }}>
                    {idx + 1}. {assignmentExportMode && Number(q?.points || 0) > 0 ? `[${formatCompactNumber(q.points)}] ` : ""}{q.questionText}
                  </div>
                  {((!isAssignment && !exportDocumentMode) || (isManager && !exportDocumentMode)) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                      {!isAssignment && !exportDocumentMode && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: "1px solid #cbd5e1",
                            background: "#f8fafc",
                            color: "#1e3a8a",
                            letterSpacing: 0.3,
                            textTransform: "uppercase",
                          }}
                        >
                          {questionTypeLabel(qType)}
                        </span>
                      )}
                      {isManager && !exportDocumentMode && (
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151" }}>
                          <input
                            type="checkbox"
                            checked={hiddenForStudent}
                            disabled={!!visibilityBusy[q.questionId]}
                            onChange={(e) => handleQuestionVisibility(q.questionId, e.target.checked)}
                          />
                          {ti18n("quiz.hideForStudents", "Hide this question for students")}
                        </label>
                      )}
                    </div>
                  )}
                </div>

                {managerHiddenPreview && !exportDocumentMode && (
                  <InlineAlert tone="warning" style={{ marginBottom: 12, fontWeight: 700 }}>
                    {msg("quiz.hiddenForStudents.label", "Hidden for students (teacher preview only)")}
                  </InlineAlert>
                )}

                {unanswered && !exportDocumentMode && (
                  <div style={{ marginBottom: 12, color: "#b45309", fontWeight: 700, fontSize: 18 }}>
                    {t("quiz.notAnswered", "Not answered")}
                  </div>
                )}

                {isAssignment ? null : exportDocumentMode ? (
                  qType === "MCQ" || qType === "TRUE_FALSE" ? (
                    <div style={{ marginTop: 4 }}>
                      {(q.options || []).map((o) => {
                        const detailSelected = detail?.selectedOptionId === o.optionId;
                        const detailCorrect = detail?.correctOptionId === o.optionId;
                        const marker = showResults
                          ? detailCorrect
                            ? " [Correct]"
                            : detailSelected
                              ? " [Selected]"
                              : ""
                          : "";
                        return (
                          <div key={o.optionId} style={{ margin: "2px 0", fontSize: 15, lineHeight: 1.4, fontFamily: "Georgia, 'Times New Roman', serif" }}>
                            {o.label}. {o.text}{marker}
                          </div>
                        );
                      })}
                    </div>
                  ) : qType === "MIX_MATCH_DRAG" ? (
                    <div style={{ marginTop: 4 }}>
                      {(q.leftItems || []).map((item) => {
                        const matchMap = answers[q.questionId]?.matchMap || {};
                        const selectedRightId = Number(matchMap[item.leftMatchPairId] || 0) || null;
                        const selectedRightItem = (q.rightItems || []).find((r) => Number(r.rightMatchPairId) === selectedRightId) || null;
                        const resultPair = (detail?.matchPairs || []).find((pair) => Number(pair.leftMatchPairId) === Number(item.leftMatchPairId)) || null;
                        return (
                          <div key={item.leftMatchPairId} style={{ margin: "3px 0", fontSize: 15, lineHeight: 1.4, fontFamily: "Georgia, 'Times New Roman', serif" }}>
                            {item.leftText}{" -> "}
                            {showResults ? (resultPair?.selectedRightText || "-") : (selectedRightItem?.rightText || "________")}
                            {showResults ? ` (Correct: ${resultPair?.correctRightText || "-"})` : ""}
                          </div>
                        );
                      })}
                    </div>
                  ) : qType === "NUMERIC" ? (
                    <div style={{ marginTop: 4, fontSize: 15, lineHeight: 1.45, fontFamily: "Georgia, 'Times New Roman', serif" }}>
                      {showResults ? `Answer: ${detail?.selectedNumberAnswer ?? "-"}` : "Answer: ____________________"}
                      {showResults && revealCorrectAnswers ? ` | Correct: ${detail?.expectedAnswerNumber ?? "-"}` : ""}
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, fontSize: 15, lineHeight: 1.45, fontFamily: "Georgia, 'Times New Roman', serif" }}>
                      {showResults
                        ? `Answer: ${detail?.selectedTextAnswer || "-"}`
                        : "Answer: ____________________________________________"}
                      {showResults && qType === "SHORT_TEXT" && revealCorrectAnswers
                        ? ` | Correct: ${detail?.expectedAnswerText || "-"}`
                        : ""}
                    </div>
                  )
                ) : qType === "MCQ" || qType === "TRUE_FALSE" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {q.options.map((o) => (
                      <label
                        key={o.optionId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 12px",
                          borderRadius: 12,
                          cursor: showResults || managerHiddenPreview ? "default" : "pointer",
                          fontSize: 16,
                          fontWeight: 600,
                          ...getOptionStyle(q.questionId, o.optionId),
                        }}
                      >
                        <input
                          type="radio"
                          name={`q-${q.questionId}`}
                          checked={answers[q.questionId]?.selectedOptionId === o.optionId}
                          onChange={() => onSelect(q.questionId, o.optionId)}
                          disabled={showResults || managerHiddenPreview}
                        />
                        <div style={{ flex: 1 }}>
                          <b style={{ marginRight: 8 }}>{o.label}.</b> {o.text}
                          {renderBadge(q.questionId, o.optionId)}
                        </div>
                      </label>
                    ))}
                  </div>
                ) : qType === "MIX_MATCH_DRAG" ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ marginBottom: 10, color: "#475569", fontSize: 14 }}>
                      Match each left item to one right item. Drag-and-drop is optional; dropdowns work on mobile and keyboard.
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {(q.leftItems || []).map((item) => {
                        const matchMap = answers[q.questionId]?.matchMap || {};
                        const selectedRightId = Number(matchMap[item.leftMatchPairId] || 0) || null;
                        const selectedRightItem = (q.rightItems || []).find((rightItem) => Number(rightItem.rightMatchPairId) === selectedRightId) || null;
                        const resultPair = (detail?.matchPairs || []).find((pair) => Number(pair.leftMatchPairId) === Number(item.leftMatchPairId)) || null;
                        const statusColor = showResults
                          ? resultPair?.isCorrect
                            ? "#166534"
                            : "#b91c1c"
                          : "#475569";
                        return (
                          <div key={item.leftMatchPairId} style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: 12, background: "#fff" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(220px, 1.1fr) auto", gap: 10, alignItems: "center" }}>
                              <div
                                draggable={!showResults && !managerHiddenPreview}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData("text/plain", String(item.leftMatchPairId));
                                }}
                                style={{ padding: "10px 12px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", fontWeight: 700, cursor: showResults || managerHiddenPreview ? "default" : "grab" }}
                              >
                                {item.leftText}
                              </div>
                              <div
                                style={{ padding: "10px 12px", borderRadius: 10, border: "1px dashed #cbd5e1", background: "#f8fafc" }}
                              >
                                <select
                                  value={selectedRightId || ""}
                                  disabled={showResults || managerHiddenPreview}
                                  onChange={(e) => onMatchAnswer(q.questionId, item.leftMatchPairId, Number(e.target.value))}
                                  aria-label={`Select match for ${item.leftText}`}
                                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff" }}
                                >
                                  <option value="">{ti18n("quiz.match.select", "Select matching item")}</option>
                                  {(q.rightItems || []).map((rightItem) => {
                                    const assignedLeftId = Object.entries(matchMap).find(([, value]) => Number(value) === Number(rightItem.rightMatchPairId))?.[0] || null;
                                    const assignedElsewhere = assignedLeftId && Number(assignedLeftId) !== Number(item.leftMatchPairId);
                                    return (
                                      <option key={rightItem.rightMatchPairId} value={rightItem.rightMatchPairId} disabled={!!assignedElsewhere}>
                                        {rightItem.rightText}
                                      </option>
                                    );
                                  })}
                                </select>
                                {!!selectedRightItem && !showResults && (
                                  <div style={{ marginTop: 8, fontSize: 13, color: "#475569" }}>
                                    {ti18n("quiz.match.selected", "Selected")}: <b>{selectedRightItem.rightText}</b>
                                  </div>
                                )}
                                {showResults && (
                                  <div style={{ marginTop: 8, fontSize: 13, color: statusColor }}>
                                    {ti18n("quiz.match.yourMatch", "Your match")}: <b>{resultPair?.selectedRightText || "-"}</b>
                                    {" | "}
                                    {ti18n("quiz.match.correct", "Correct")}: <b>{resultPair?.correctRightText || "-"}</b>
                                  </div>
                                )}
                              </div>
                              {!showResults && !managerHiddenPreview ? (
                                <Button
                                  type="button"
                                  onClick={() => clearMatchAnswer(q.questionId, item.leftMatchPairId)}
                                  variant="ghost"
                                  size="sm"
                                >
                                  Clear
                                </Button>
                              ) : <div />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {!!(q.rightItems || []).length && !showResults && (
                      <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>{ti18n("quiz.match.rightSideOptions", "Right-side options")}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {(q.rightItems || []).map((rightItem) => (
                            <div
                              key={rightItem.rightMatchPairId}
                              onDragOver={(event) => {
                                if (showResults || managerHiddenPreview) return;
                                event.preventDefault();
                              }}
                              onDrop={(event) => {
                                if (showResults || managerHiddenPreview) return;
                                event.preventDefault();
                                const draggedLeftId = Number(event.dataTransfer.getData("text/plain") || 0);
                                if (draggedLeftId) onMatchAnswer(q.questionId, draggedLeftId, rightItem.rightMatchPairId);
                              }}
                              aria-label={`Drop zone for ${rightItem.rightText}`}
                              style={{ padding: "9px 12px", borderRadius: 999, border: "1px solid #cbd5e1", background: "#fff", color: "#0f172a", fontWeight: 700 }}
                            >
                              {rightItem.rightText}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : qType === "NUMERIC" ? (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="number"
                      step="any"
                      value={answers[q.questionId]?.numberAnswer ?? ""}
                      onChange={(e) => onNumberAnswer(q.questionId, e.target.value)}
                      disabled={showResults || managerHiddenPreview}
                      placeholder={ti18n("quiz.answer.numeric.placeholder", "Enter numeric answer")}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        border: "1px solid #d1d5db",
                        borderRadius: 10,
                        padding: "10px 12px",
                        fontSize: 15,
                      }}
                    />
                    {showResults && (
                      <div style={{ marginTop: 8, color: "#374151", fontSize: 14 }}>
                        {ti18n("quiz.yourAnswer", "Your answer")}: <b>{detail?.selectedNumberAnswer ?? "-"}</b>
                      </div>
                    )}
                    {showResults && revealCorrectAnswers && (
                      <div style={{ marginTop: 6, color: "#065f46", fontSize: 14 }}>
                        {ti18n("quiz.correctAnswer", "Correct answer")}: <b>{detail?.expectedAnswerNumber ?? "-"}</b>
                      </div>
                    )}
                  </div>
                ) : qType === "LONG" ? (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      value={answers[q.questionId]?.textAnswer ?? ""}
                      onChange={(e) => onTextAnswer(q.questionId, e.target.value.slice(0, 8000))}
                      disabled={showResults || managerHiddenPreview}
                      placeholder={ti18n("quiz.answer.long.placeholder", "Write your answer")}
                      rows={7}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        border: "1px solid #d1d5db",
                        borderRadius: 10,
                        padding: "10px 12px",
                        fontSize: 15,
                        resize: "vertical",
                      }}
                    />
                    <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12 }}>
                      {String(answers[q.questionId]?.textAnswer || "").length} / 8000
                    </div>
                    {showResults && (
                      <div style={{ marginTop: 8, color: "#374151", fontSize: 14 }}>
                        {ti18n("quiz.yourAnswer", "Your answer")}: <b>{detail?.selectedTextAnswer || "-"}</b>
                      </div>
                    )}
                    {showResults && detail?.autoScore != null && (
                      <div style={{ marginTop: 8, color: "#065f46", fontSize: 14 }}>
                        {ti18n("quiz.aiScore", "AI score")}: <b>{detail.autoScore}</b>
                        {detail?.autoFeedback ? ` - ${detail.autoFeedback}` : ""}
                      </div>
                    )}
                    {showResults && detail?.isTeacherOverridden && detail?.teacherOverrideScore != null && (
                      <div style={{ marginTop: 6, color: "#1d4ed8", fontSize: 14 }}>
                        {ti18n("quiz.teacherOverride", "Teacher override")}: <b>{detail.teacherOverrideScore}</b>
                        {detail?.teacherOverrideFeedback ? ` - ${detail.teacherOverrideFeedback}` : ""}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="text"
                      value={answers[q.questionId]?.textAnswer ?? ""}
                      onChange={(e) => onTextAnswer(q.questionId, e.target.value)}
                      disabled={showResults || managerHiddenPreview}
                      placeholder={ti18n("quiz.answer.short.placeholder", "Enter short answer")}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        border: "1px solid #d1d5db",
                        borderRadius: 10,
                        padding: "10px 12px",
                        fontSize: 15,
                      }}
                    />
                    {showResults && (
                      <div style={{ marginTop: 8, color: "#374151", fontSize: 14 }}>
                        {ti18n("quiz.yourAnswer", "Your answer")}: <b>{detail?.selectedTextAnswer || "-"}</b>
                      </div>
                    )}
                    {showResults && revealCorrectAnswers && (
                      <div style={{ marginTop: 6, color: "#065f46", fontSize: 14 }}>
                        {ti18n("quiz.correctAnswer", "Correct answer")}: <b>{detail?.expectedAnswerText || "-"}</b>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {hasDiagram && (
                <div style={{ border: exportDocumentMode ? "none" : "1px solid #e5e7eb", borderRadius: exportDocumentMode ? 0 : 12, padding: exportDocumentMode ? 0 : 12, background: exportDocumentMode ? "#fff" : "#f9fafb", minHeight: exportDocumentMode ? 0 : 220 }}>
                  {!assignmentExportMode && !exportDocumentMode && <div style={{ fontWeight: 800, marginBottom: 8, color: "#111827", fontSize: 18 }}>{t("quiz.diagram.title", "Diagram")}</div>}
                  {renderDiagram(q)}
                </div>
              )}

              {!isAssignment && !exportDocumentMode && (
                <QuizQuestionAssistPanel
                  showResults={showResults}
                  showThisExplanation={showThisExplanation}
                  showThisHint={showThisHint}
                  explanationText={explanationText}
                  hintLockedForFreePlan={hintLockedForFreePlan}
                  isCardTextOpen={isCardTextOpen}
                  onToggle={() => {
                    if (showResults) {
                      setExplanationCardOpen((prev) => ({
                        ...prev,
                        [q.questionId]: !prev[q.questionId],
                      }));
                      return;
                    }
                    if (hintLockedForFreePlan) {
                      setErr(msg("quiz.paidFeatureOnly.error", "This feature is available in paid version."));
                      return;
                    }
                    setHintCardOpen((prev) => ({
                      ...prev,
                      [q.questionId]: !prev[q.questionId],
                    }));
                  }}
                  t={t}
                  msg={msg}
                />
              )}
            </div>
          </Card>
          </div>
        );
      })}

      <QuizActionPanel
        showResults={showResults}
        isAssignment={isAssignment}
        isExporting={isExporting}
        pdfBusy={pdfBusy}
        pdfLockedForFreePlan={pdfLockedForFreePlan}
        hintLockedForFreePlan={hintLockedForFreePlan}
        canSubmitQuiz={canAttemptSubmit}
        submittingAttempt={submittingAttempt}
        attemptsRemaining={attemptsRemaining}
        showHints={showHints}
        showPostExplanations={showPostExplanations}
        isManager={isManager}
        subscription={subscription}
        isAssignedStudent={isAssignedStudent}
        result={result}
        onToggleHints={() => {
          if (hintLockedForFreePlan) {
            setErr(msg("quiz.paidFeatureOnly.error", "This feature is available in paid version."));
            return;
          }
          setShowHints((v) => !v);
        }}
        onExportPdf={() => {
          if (pdfLockedForFreePlan) {
            setErr(msg("quiz.paidFeatureOnly.error", "This feature is available in paid version."));
            return;
          }
          handleExportSolvedPdf();
        }}
        onSubmitQuiz={() => handleSubmit(false)}
        onClearAnswers={handleClearAnswers}
        onToggleExplanations={() => setShowPostExplanations((v) => !v)}
        onStartNextAttempt={handleStartNextAttempt}
        renderAttemptMarks={renderAttemptMarks}
        t={t}
        msg={msg}
      />
    </div>
  );
}
