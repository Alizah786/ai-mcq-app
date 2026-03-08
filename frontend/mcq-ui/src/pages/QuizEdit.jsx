import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../api/http";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import FormActions from "../components/ui/FormActions";
import FormSection from "../components/ui/FormSection";
import InlineAlert from "../components/ui/InlineAlert";
import StatusPill from "../components/ui/StatusPill";

const LABELS = ["A", "B", "C", "D", "E", "F"];
const MAX_HEADER_ROWS = 20;

function MermaidDiagram({ code }) {
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
        const id = `mmd-edit-${Math.random().toString(36).slice(2)}`;
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
    return <div style={{ color: "#6b7280", fontSize: 13 }}>Rendering diagram...</div>;
  }

  return (
    <div
      style={{ marginTop: 8, padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, overflowX: "auto" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function emptyOption(label) {
  return { label: label || "A", text: "", isCorrect: false };
}

function emptyQuestion() {
  return {
    questionText: "",
    explanation: "",
    points: 1,
    questionType: "MCQ",
    expectedAnswerText: "",
    answerMatchMode: "EXACT",
    expectedAnswerNumber: "",
    numericTolerance: "",
    shuffleLeft: false,
    shuffleRight: true,
    allowPartialMarks: true,
    diagramType: "none",
    diagramData: "",
    isHiddenForStudent: false,
    pairs: [
      { leftText: "", rightText: "", displayOrder: 0, isActive: true },
      { leftText: "", rightText: "", displayOrder: 1, isActive: true },
    ],
    options: [emptyOption("A"), emptyOption("B"), emptyOption("C"), emptyOption("D")],
  };
}

function emptyLongQuestion() {
  return {
    questionText: "",
    explanation: "",
    points: 10,
    questionType: "LONG",
    expectedAnswerText: "",
    answerMatchMode: "EXACT",
    expectedAnswerNumber: "",
    numericTolerance: "",
    shuffleLeft: false,
    shuffleRight: true,
    allowPartialMarks: true,
    diagramType: "none",
    diagramData: "",
    isHiddenForStudent: false,
    pairs: [],
    options: [],
  };
}

function trueFalseOptions() {
  return [
    { label: "A", text: "True", isCorrect: true },
    { label: "B", text: "False", isCorrect: false },
  ];
}

function normalizeQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) return [emptyQuestion()];
  return rawQuestions.map((q) => ({
    questionId: q.questionId || null,
    questionText: q.questionText || "",
    explanation: q.explanation || "",
    points: Number(q.points || 1),
    questionType: q.questionType || "MCQ",
    expectedAnswerText: q.expectedAnswerText || "",
    answerMatchMode: q.answerMatchMode || "EXACT",
    expectedAnswerNumber: q.expectedAnswerNumber ?? "",
    numericTolerance: q.numericTolerance ?? "",
    shuffleLeft: !!q.shuffleLeft,
    shuffleRight: q.shuffleRight == null ? true : !!q.shuffleRight,
    allowPartialMarks: q.allowPartialMarks == null ? true : !!q.allowPartialMarks,
    diagramType: q.diagramType || "none",
    diagramData: q.diagramData || "",
    isHiddenForStudent: !!q.isHiddenForStudent,
    pairs: Array.isArray(q.pairs) && q.pairs.length
      ? q.pairs.map((pair, idx) => ({
          matchPairId: pair.matchPairId || null,
          leftText: pair.leftText || "",
          rightText: pair.rightText || "",
          displayOrder: Number.isFinite(Number(pair.displayOrder)) ? Number(pair.displayOrder) : idx,
          isActive: pair.isActive == null ? true : !!pair.isActive,
        }))
      : [
          { leftText: "", rightText: "", displayOrder: 0, isActive: true },
          { leftText: "", rightText: "", displayOrder: 1, isActive: true },
        ],
    options: Array.isArray(q.options) && q.options.length
      ? q.options.map((o, idx) => ({
          label: o.label || LABELS[idx] || String(idx + 1),
          text: o.text || "",
          isCorrect: !!o.isCorrect,
        }))
      : (q.questionType === "TRUE_FALSE"
          ? trueFalseOptions()
          : [emptyOption("A"), emptyOption("B"), emptyOption("C"), emptyOption("D")]),
  }));
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function toLocalDateTimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function shortValue(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function normalizeHeaderExtraLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      text: String(line?.text || "").replace(/\s+/g, " ").trim().slice(0, 200),
      showOnHeader: line?.showOnHeader == null ? true : !!line.showOnHeader,
    }))
    .filter((line) => line.text);
}

function hasIncompleteQuestionContent(questions = [], isAssignmentQuiz = false) {
  const isPlaceholderText = (value) => {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    return (
      text === "option text" ||
      text.includes("enter question text") ||
      text.includes("mcq") ||
      text.includes("true/false") ||
      text.includes("short question")
    );
  };

  return (questions || []).some((q) => {
    const questionType = isAssignmentQuiz ? "LONG" : String(q.questionType || "MCQ").toUpperCase();
    const questionText = String(q.questionText || "").trim();
    if (!questionText || isPlaceholderText(questionText)) return true;

    if (questionType === "MCQ" || questionType === "TRUE_FALSE") {
      const options = Array.isArray(q.options) ? q.options : [];
      if (!options.length) return true;
      if (options.some((o) => isPlaceholderText(o?.text))) return true;
      const correctCount = options.filter((o) => !!o.isCorrect).length;
      if (correctCount !== 1) return true;
    }

    if (questionType === "SHORT_TEXT" && !String(q.expectedAnswerText || "").trim()) return true;
    if (questionType === "NUMERIC" && !Number.isFinite(Number(q.expectedAnswerNumber))) return true;

    if (questionType === "MIX_MATCH_DRAG") {
      const pairs = Array.isArray(q.pairs) ? q.pairs : [];
      if (pairs.length < 2) return true;
      if (pairs.some((pair) => !String(pair.leftText || "").trim() || !String(pair.rightText || "").trim())) return true;
    }

    if (questionType === "LONG" && questionText.length < 20) return true;
    return false;
  });
}

export default function QuizEdit() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const { isManager } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState([]);
  const [headerExtraLines, setHeaderExtraLines] = useState([]);
  const [originalHeaderExtraLines, setOriginalHeaderExtraLines] = useState([]);

  const [reviewMode, setReviewMode] = useState(false);
  const [sourceQuizId, setSourceQuizId] = useState(null);
  const [workingQuizId, setWorkingQuizId] = useState(null);
  const [sourceType, setSourceType] = useState("");
  const [assessmentType, setAssessmentType] = useState("QUIZ");
  const [activeVersion, setActiveVersion] = useState("working");
  const [originalQuestions, setOriginalQuestions] = useState([]);
  const [changeLog, setChangeLog] = useState([]);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [isEdited, setIsEdited] = useState(false);
  const [maxMcqsPerQuiz, setMaxMcqsPerQuiz] = useState(20);
  const [publishNow, setPublishNow] = useState(true);
  const [publishStartLocal, setPublishStartLocal] = useState("");
  const [publishEndLocal, setPublishEndLocal] = useState("");
  const [headerRowsOpen, setHeaderRowsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setError("");
    setSuccess("");

    async function load() {
      try {
        setLoading(true);
        if (isManager) {
          try {
            const review = await apiGet(`/api/quizzes/${quizId}/teacher-review`);
            if (!alive) return;
            if (review?.reviewMode) {
              setReviewMode(true);
              setSourceQuizId(Number(review.sourceQuizId || quizId));
              setWorkingQuizId(Number(review.workingQuizId || quizId));
              setSourceType(String(review?.working?.sourceType || review?.original?.sourceType || ""));
              setAssessmentType(String(review?.working?.assessmentType || review?.original?.assessmentType || "QUIZ").toUpperCase() === "ASSIGNMENT" ? "ASSIGNMENT" : "QUIZ");
              setTitle(review?.working?.title || review?.original?.title || "");
              setHeaderExtraLines(normalizeHeaderExtraLines(review?.working?.headerExtraLines || []));
              setOriginalHeaderExtraLines(normalizeHeaderExtraLines(review?.original?.headerExtraLines || []));
              setPublishStartLocal(toLocalDateTimeInputValue(review?.working?.publishStartUtc || review?.original?.publishStartUtc || null));
              setPublishEndLocal(toLocalDateTimeInputValue(review?.working?.publishEndUtc || review?.original?.publishEndUtc || null));
              setPublishNow(!(review?.working?.publishStartUtc || review?.original?.publishStartUtc));
              setQuestions(normalizeQuestions(review?.working?.questions || []));
              setOriginalQuestions(normalizeQuestions(review?.original?.questions || []));
              setChangeLog(Array.isArray(review.changeLog) ? review.changeLog : []);
              const editedFlag =
                !!review?.working?.isTeacherEdited ||
                !!review?.working?.isManagerEdited ||
                Number(review.workingQuizId) !== Number(review.sourceQuizId) ||
                (Array.isArray(review.changeLog) && review.changeLog.length > 0);
              setIsEdited(editedFlag);
              setMaxMcqsPerQuiz(Math.max(1, Number(review?.maxMcqsPerQuiz || 20)));
              return;
            }
          } catch {
            // Fallback to normal edit endpoint.
          }
        }

        const data = await apiGet(`/api/quizzes/${quizId}`);
        if (!alive) return;
        setReviewMode(false);
        setSourceType(String(data?.sourceType || ""));
        setAssessmentType(String(data?.assessmentType || "QUIZ").toUpperCase() === "ASSIGNMENT" ? "ASSIGNMENT" : "QUIZ");
        setTitle(data.title || "");
        setHeaderExtraLines(normalizeHeaderExtraLines(data?.headerExtraLines || []));
        setPublishStartLocal(toLocalDateTimeInputValue(data?.publishStartUtc || null));
        setPublishEndLocal(toLocalDateTimeInputValue(data?.publishEndUtc || null));
        setPublishNow(!data?.publishStartUtc);
        setOriginalHeaderExtraLines([]);
        setQuestions(normalizeQuestions(data.questions || []));
        setMaxMcqsPerQuiz(Math.max(1, Number(data?.maxMcqsPerQuiz || 20)));
      } catch (e) {
        if (alive) setError(e.message || "Failed to load quiz");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [quizId, isManager]);

  const displayedQuestions = useMemo(
    () => (reviewMode && activeVersion === "original" ? originalQuestions : questions),
    [reviewMode, activeVersion, originalQuestions, questions]
  );
  const displayedHeaderExtraLines = useMemo(
    () => (reviewMode && activeVersion === "original" ? originalHeaderExtraLines : headerExtraLines),
    [reviewMode, activeVersion, originalHeaderExtraLines, headerExtraLines]
  );
  const isReadOnlyVersion = reviewMode && activeVersion === "original";
  const isAssignmentQuiz = String(assessmentType || "").toUpperCase() === "ASSIGNMENT";
  const isAiQuiz = String(sourceType || "").toUpperCase().startsWith("AI");
  const maxQuestionsLimit = isAssignmentQuiz ? 5 : (isAiQuiz ? maxMcqsPerQuiz : 25);

  useEffect(() => {
    if (displayedHeaderExtraLines.length > 0) {
      setHeaderRowsOpen(true);
    }
  }, [displayedHeaderExtraLines.length]);

  function addQuestion() {
    if (isReadOnlyVersion) return;
    if ((questions || []).length >= maxQuestionsLimit) {
      setError(
        isAiQuiz
          ? `You can add up to ${maxQuestionsLimit} questions for this AI plan.`
          : "You can add up to 25 questions for manual/import quizzes."
      );
      return;
    }
    setError("");
    setQuestions((prev) => [...prev, isAssignmentQuiz ? emptyLongQuestion() : emptyQuestion()]);
  }

  function addHeaderExtraLine() {
    if (isReadOnlyVersion) return;
    setHeaderExtraLines((prev) => (prev.length >= MAX_HEADER_ROWS
      ? prev
      : [...prev, { text: "", showOnHeader: true }]));
  }

  function updateHeaderExtraLine(index, field, value) {
    if (isReadOnlyVersion) return;
    setHeaderExtraLines((prev) => prev.map((line, idx) => (
      idx === index
        ? {
            ...line,
            [field]: field === "text" ? String(value || "").slice(0, 200) : !!value,
          }
        : line
    )));
  }

  function removeHeaderExtraLine(index) {
    if (isReadOnlyVersion) return;
    setHeaderExtraLines((prev) => prev.filter((_, idx) => idx !== index));
  }

  function removeQuestion(idx) {
    if (isReadOnlyVersion) return;
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateQuestion(idx, field, value) {
    if (isReadOnlyVersion) return;
    if (isAssignmentQuiz && field === "questionType") return;
    if (field === "questionType") {
      setQuestions((prev) =>
        prev.map((q, i) => {
          if (i !== idx) return q;
          const nextType = value || "MCQ";
          if (nextType === "TRUE_FALSE") {
            return { ...q, questionType: nextType, options: trueFalseOptions() };
          }
          if (nextType === "MCQ" && (!Array.isArray(q.options) || q.options.length < 4)) {
            return { ...q, questionType: nextType, options: [emptyOption("A"), emptyOption("B"), emptyOption("C"), emptyOption("D")] };
          }
          if (nextType === "LONG") {
            return { ...q, questionType: nextType, options: [] };
          }
          if (nextType === "MIX_MATCH_DRAG") {
            return {
              ...q,
              questionType: nextType,
              options: [],
              shuffleLeft: !!q.shuffleLeft,
              shuffleRight: q.shuffleRight == null ? true : !!q.shuffleRight,
              allowPartialMarks: q.allowPartialMarks == null ? true : !!q.allowPartialMarks,
              pairs: Array.isArray(q.pairs) && q.pairs.length
                ? q.pairs
                : [
                    { leftText: "", rightText: "", displayOrder: 0, isActive: true },
                    { leftText: "", rightText: "", displayOrder: 1, isActive: true },
                  ],
            };
          }
          return { ...q, questionType: nextType };
        })
      );
      return;
    }
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, [field]: value } : q)));
  }

  function updateOption(qIdx, oIdx, field, value) {
    if (isReadOnlyVersion) return;
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== qIdx ? q : { ...q, options: q.options.map((o, j) => (j === oIdx ? { ...o, [field]: value } : o)) }
      )
    );
  }

  function setCorrectOption(qIdx, oIdx) {
    if (isReadOnlyVersion) return;
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== qIdx ? q : { ...q, options: q.options.map((o, j) => ({ ...o, isCorrect: j === oIdx })) }
      )
    );
  }

  function updatePair(qIdx, pIdx, field, value) {
    if (isReadOnlyVersion) return;
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== qIdx
          ? q
          : {
              ...q,
              pairs: (q.pairs || []).map((pair, j) =>
                j === pIdx ? { ...pair, [field]: value } : pair
              ),
            }
      )
    );
  }

  function addPairRow(qIdx) {
    if (isReadOnlyVersion) return;
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== qIdx
          ? q
          : {
              ...q,
              pairs: [...(q.pairs || []), { leftText: "", rightText: "", displayOrder: (q.pairs || []).length, isActive: true }],
            }
      )
    );
  }

  function removePairRow(qIdx, pIdx) {
    if (isReadOnlyVersion) return;
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== qIdx
          ? q
          : {
              ...q,
              pairs: (q.pairs || [])
                .filter((_, j) => j !== pIdx)
                .map((pair, nextIdx) => ({ ...pair, displayOrder: nextIdx })),
            }
      )
    );
  }

  function buildPayload() {
    return {
      questions: questions.map((q) => ({
        questionText: String(q.questionText || "").trim(),
        explanation: q.explanation?.trim() || null,
        points: Number(q.points || (isAssignmentQuiz ? 10 : 1)),
        questionType: isAssignmentQuiz ? "LONG" : (q.questionType || "MCQ"),
        expectedAnswerText: isAssignmentQuiz ? null : (q.questionType === "SHORT_TEXT" ? (q.expectedAnswerText?.trim() || null) : null),
        answerMatchMode: isAssignmentQuiz ? null : (q.questionType === "SHORT_TEXT" ? (q.answerMatchMode || "EXACT") : null),
        expectedAnswerNumber: isAssignmentQuiz ? null : (q.questionType === "NUMERIC" && q.expectedAnswerNumber !== "" ? Number(q.expectedAnswerNumber) : null),
        numericTolerance: isAssignmentQuiz ? null : (q.questionType === "NUMERIC" && q.numericTolerance !== "" ? Number(q.numericTolerance) : null),
        shuffleLeft: isAssignmentQuiz ? false : (q.questionType === "MIX_MATCH_DRAG" ? !!q.shuffleLeft : false),
        shuffleRight: isAssignmentQuiz ? true : (q.questionType === "MIX_MATCH_DRAG" ? !!q.shuffleRight : true),
        allowPartialMarks: isAssignmentQuiz ? true : (q.questionType === "MIX_MATCH_DRAG" ? !!q.allowPartialMarks : true),
        diagramType: q.diagramType || "none",
        diagramData: q.diagramType && q.diagramType !== "none" ? (q.diagramData?.trim() || null) : null,
        isHiddenForStudent: !!q.isHiddenForStudent,
        pairs:
          !isAssignmentQuiz && q.questionType === "MIX_MATCH_DRAG"
            ? (q.pairs || [])
                .map((pair, idx) => ({
                  matchPairId: pair.matchPairId || null,
                  leftText: String(pair.leftText || "").trim(),
                  rightText: String(pair.rightText || "").trim(),
                  displayOrder: idx,
                  isActive: pair.isActive == null ? true : !!pair.isActive,
                }))
                .filter((pair) => pair.leftText || pair.rightText)
            : [],
        options:
          !isAssignmentQuiz && ((q.questionType || "MCQ") === "MCQ" || (q.questionType || "MCQ") === "TRUE_FALSE")
            ? q.options
                .filter((o) => String(o.text || "").trim())
                .map((o, idx) => ({
                  label: o.label || LABELS[idx] || String(idx + 1),
                  text: String(o.text || "").trim(),
                  isCorrect: !!o.isCorrect,
                }))
            : [],
      })),
    };
  }

  async function handleSave() {
    if (isReadOnlyVersion) return;
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const body = buildPayload();
      if (body.questions.some((q) => !q.questionText)) {
        setError("Each question needs text.");
        setSaving(false);
        return;
      }
      if (
        body.questions.some((q) => {
          if (q.questionType === "MCQ") return q.options.length < 1 || q.options.filter((o) => o.isCorrect).length !== 1;
          if (q.questionType === "TRUE_FALSE") return q.options.length !== 2 || q.options.filter((o) => o.isCorrect).length !== 1;
          if (q.questionType === "SHORT_TEXT") return !String(q.expectedAnswerText || "").trim();
          if (q.questionType === "NUMERIC") return !Number.isFinite(Number(q.expectedAnswerNumber));
          if (q.questionType === "MIX_MATCH_DRAG") {
            const pairs = Array.isArray(q.pairs) ? q.pairs : [];
            if (pairs.length < 2 || pairs.length > 10) return true;
            const leftSeen = new Set();
            const rightSeen = new Set();
            for (const pair of pairs) {
              const left = String(pair.leftText || "").trim().toLowerCase();
              const right = String(pair.rightText || "").trim().toLowerCase();
              if (!left || !right || leftSeen.has(left) || rightSeen.has(right)) return true;
              leftSeen.add(left);
              rightSeen.add(right);
            }
            return false;
          }
          if (q.questionType === "LONG") {
            const qt = String(q.questionText || "").trim();
            return qt.length < 20 || qt.length > 4000 || !Number.isFinite(Number(q.points)) || Number(q.points) < 1 || Number(q.points) > 100;
          }
          return false;
        })
      ) {
        setError("MCQ needs exactly one correct option. Short/Numeric need expected answers. MIX_MATCH_DRAG needs 2-10 unique pairs. LONG needs 20-4000 text and points 1-100.");
        setSaving(false);
        return;
      }
      const longCount = body.questions.filter((q) => q.questionType === "LONG").length;
      if (longCount > 5) {
        setError("A quiz can have a maximum of 5 long questions.");
        setSaving(false);
        return;
      }
      if (body.questions.length > maxQuestionsLimit) {
        setError(
          isAiQuiz
            ? `Maximum number of MCQ's per quiz for your plan is ${maxQuestionsLimit}.`
            : "Maximum number of MCQ's for manual/import quiz is 25."
        );
        setSaving(false);
        return;
      }

      const metadataPayload = {
        assessmentType,
        headerExtraLines: normalizeHeaderExtraLines(headerExtraLines),
      };

      if (reviewMode) {
        await apiPut(`/api/quizzes/${workingQuizId || sourceQuizId}`, metadataPayload);
        const result = await apiPut(`/api/quizzes/${sourceQuizId}/teacher-review/content`, body);
        setIsEdited(true);
        setChangeLog(Array.isArray(result?.changeLog) ? result.changeLog : []);
        setSuccess("Teacher updates saved.");
      } else {
        await apiPut(`/api/quizzes/${quizId}`, metadataPayload);
        await apiPut(`/api/quizzes/${quizId}/content`, body);
        setSuccess("Quiz saved.");
        navigate(`/dashboard?manageQuiz=${quizId}`);
      }
    } catch (e) {
      setError(e.message || "Failed to save quiz");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishReviewedQuiz() {
    if (!reviewMode) return;
    if (!approvalChecked) {
      setError("Confirm teacher review checkbox before publishing.");
      return;
    }
    if (hasIncompleteQuestionContent(questions, isAssignmentQuiz)) {
      const proceed = window.confirm(
        "Some questions or options are not complete. Do you still want to proceed with publish?"
      );
      if (!proceed) return;
    }
    setPublishing(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        approved: true,
        publishNow: !!publishNow,
        publishStartUtc: publishNow || !publishStartLocal ? null : new Date(publishStartLocal).toISOString(),
        publishEndUtc: publishNow || !publishEndLocal ? null : new Date(publishEndLocal).toISOString(),
      };
      await apiPost(`/api/quizzes/${sourceQuizId}/teacher-review/publish`, payload);
      setSuccess("Teacher reviewed quiz published.");
      navigate(`/dashboard?manageQuiz=${workingQuizId || sourceQuizId}`);
    } catch (e) {
      setError(e.message || "Failed to publish reviewed quiz");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) return <div>Loading quiz...</div>;
  if (error && !questions.length && !originalQuestions.length) return <InlineAlert tone="danger">{error}</InlineAlert>;
  const exportQuizId = workingQuizId || sourceQuizId || quizId;

  return (
    <div style={{ maxWidth: 1360, margin: "0 auto", paddingBottom: 92 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>
            {reviewMode ? "Teacher Review & Edit Quiz" : "Input / Edit Quiz"}
          </h2>
          {reviewMode && (
            <div style={{ color: "#b45309", fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>
              Teacher Must Review
            </div>
          )}
        </div>
        <FormActions style={{ gap: 8, marginLeft: "auto", alignItems: "center" }}>
          {reviewMode && (
            <>
            <Button
              type="button"
              onClick={() => setActiveVersion("original")}
              variant={activeVersion === "original" ? "primary" : "secondary"}
              size="sm"
            >
              Original AI Version
            </Button>
            <Button
              type="button"
              onClick={() => setActiveVersion("working")}
              variant={activeVersion === "working" ? "primary" : "secondary"}
              size="sm"
            >
              Teacher Modified Version
            </Button>
            {isEdited && <StatusPill tone="warning">Edited</StatusPill>}
            </>
          )}
          <button
            type="button"
            onClick={() => setHeaderRowsOpen((prev) => !prev)}
            style={{
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#0f172a",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 10,
              padding: "6px 10px",
              lineHeight: 1.2,
            }}
          >
            <span>{headerRowsOpen ? "v" : ">"}</span>
            <span>Custom Header Rows</span>
          </button>
        </FormActions>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ color: "#6b7280", fontSize: 15, fontWeight: 700 }}>{title}</div>
        <div style={{ color: "#6b7280", fontSize: 12, fontWeight: 700 }}>
          {isAssignmentQuiz
            ? `Max assignment questions allowed: ${maxQuestionsLimit}`
            : `Max MCQ's allowed in this ${isAiQuiz ? "AI" : "manual/import"} quiz: ${maxQuestionsLimit}`}
        </div>
      </div>
      {error && <InlineAlert tone="danger" style={{ marginBottom: 10 }}>{error}</InlineAlert>}
      {success && <InlineAlert tone="success" style={{ marginBottom: 10 }}>{success}</InlineAlert>}

      {headerRowsOpen && (
        <div
          style={{
            marginBottom: 14,
            border: "2px solid #94a3b8",
            borderRadius: 16,
            background: "#fff",
            padding: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Button
              type="button"
              onClick={addHeaderExtraLine}
              disabled={headerExtraLines.length >= MAX_HEADER_ROWS}
              variant="secondary"
              size="sm"
              style={{ opacity: headerExtraLines.length >= MAX_HEADER_ROWS ? 0.6 : 1 }}
            >
              + Add Row
            </Button>
          </div>
          <>
            {!displayedHeaderExtraLines.length && (
              <div style={{ color: "#6b7280", fontSize: 14 }}>No custom header rows yet.</div>
            )}
            {displayedHeaderExtraLines.map((line, index) => (
              <div key={`${activeVersion}-header-line-${index}`} style={{ display: "grid", gridTemplateColumns: isReadOnlyVersion ? "1fr auto" : "1fr auto auto", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <input
                  placeholder="Header text"
                  value={line.text || ""}
                  disabled={isReadOnlyVersion}
                  onChange={(e) => updateHeaderExtraLine(index, "text", e.target.value)}
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 13 }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc", whiteSpace: "nowrap", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={line.showOnHeader == null ? true : !!line.showOnHeader}
                    disabled={isReadOnlyVersion}
                    onChange={(e) => updateHeaderExtraLine(index, "showOnHeader", e.target.checked)}
                  />
                  Show on the header of the quiz
                </label>
                {!isReadOnlyVersion && (
                  <button
                    type="button"
                    onClick={() => removeHeaderExtraLine(index)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#dc2626", cursor: "pointer" }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </>
        </div>
      )}

      {displayedQuestions.map((q, qIdx) => (
        <Card
          key={`${activeVersion}-${qIdx}`}
          tone="accent"
          padding="md"
          style={{
            marginBottom: 12,
            border: "2px solid #94a3b8",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 12, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 17, lineHeight: 1.1 }}>Question {qIdx + 1}</strong>
          </div>
          <input
            placeholder="Question text"
            value={q.questionText}
            disabled={isReadOnlyVersion}
            onChange={(e) => updateQuestion(qIdx, "questionText", e.target.value)}
            style={{ width: "100%", padding: "8px 10px", marginBottom: 6, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 13 }}
          />
          <input
            placeholder="Explanation (optional)"
            value={q.explanation}
            disabled={isReadOnlyVersion}
            onChange={(e) => updateQuestion(qIdx, "explanation", e.target.value)}
            style={{ width: "100%", padding: "8px 10px", marginBottom: 8, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 13 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "end" }}>
            {isAssignmentQuiz ? (
              <div style={{ width: 170 }}>
                <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Question Type</div>
                <div style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f8fafc", fontSize: 12, color: "#374151", fontWeight: 700 }}>
                  LONG
                </div>
              </div>
            ) : (
              <div style={{ width: 170 }}>
                <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Question Type</div>
                <select
                  value={q.questionType || "MCQ"}
                  disabled={isReadOnlyVersion}
                  onChange={(e) => updateQuestion(qIdx, "questionType", e.target.value)}
                  style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 12 }}
                >
                  <option value="MCQ">MCQ</option>
                  <option value="SHORT_TEXT">Short Text</option>
                  <option value="TRUE_FALSE">True / False</option>
                  <option value="NUMERIC">Numeric</option>
                  <option value="MIX_MATCH_DRAG">Mix Match Drag</option>
                  <option value="LONG">Long</option>
                </select>
              </div>
            )}
            <div style={{ width: 106 }}>
              <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Marks</div>
              <input
                type="number"
                min="1"
                max="100"
                placeholder="Marks"
                value={q.points ?? 1}
                disabled={isReadOnlyVersion}
                onChange={(e) => updateQuestion(qIdx, "points", e.target.value)}
                style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 12 }}
              />
            </div>
            {!isAssignmentQuiz && (
              <div style={{ width: 176 }}>
                <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Diagram Type</div>
                <select
                  value={q.diagramType || "none"}
                  disabled={isReadOnlyVersion}
                  onChange={(e) => updateQuestion(qIdx, "diagramType", e.target.value)}
                  style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 12 }}
                >
                  <option value="none">No Diagram</option>
                  <option value="svg">SVG Diagram</option>
                  <option value="mermaid">Mermaid Diagram</option>
                </select>
              </div>
            )}
            {!isReadOnlyVersion && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc", color: "#374151", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={!!q.isHiddenForStudent}
                  onChange={(e) => updateQuestion(qIdx, "isHiddenForStudent", e.target.checked)}
                />
                Hide for students
              </label>
            )}
            {!isReadOnlyVersion && (
              <Button type="button" onClick={() => removeQuestion(qIdx)} variant="danger" size="sm">
                Delete
              </Button>
            )}
            {(q.questionType || "MCQ") === "SHORT_TEXT" && (
              <>
                <input
                  placeholder="Expected answer text"
                  value={q.expectedAnswerText || ""}
                  disabled={isReadOnlyVersion}
                  onChange={(e) => updateQuestion(qIdx, "expectedAnswerText", e.target.value)}
                  style={{ flex: 1, minWidth: 240, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 15 }}
                />
                <select
                  value={q.answerMatchMode || "EXACT"}
                  disabled={isReadOnlyVersion}
                  onChange={(e) => updateQuestion(qIdx, "answerMatchMode", e.target.value)}
                  style={{ width: 160, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 15 }}
                >
                  <option value="EXACT">Exact</option>
                  <option value="CONTAINS">Contains</option>
                  <option value="KEYWORDS">Keywords</option>
                </select>
              </>
            )}
            {(q.questionType || "MCQ") === "NUMERIC" && (
              <>
                <input
                  type="number"
                  step="any"
                  placeholder="Expected number"
                  value={q.expectedAnswerNumber ?? ""}
                  disabled={isReadOnlyVersion}
                  onChange={(e) => updateQuestion(qIdx, "expectedAnswerNumber", e.target.value)}
                  style={{ width: 180, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 15 }}
                />
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Tolerance (optional)"
                  value={q.numericTolerance ?? ""}
                  disabled={isReadOnlyVersion}
                  onChange={(e) => updateQuestion(qIdx, "numericTolerance", e.target.value)}
                  style={{ width: 200, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 15 }}
                />
              </>
            )}
            {(q.questionType || "MCQ") === "MIX_MATCH_DRAG" && (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc" }}>
                  <input
                    type="checkbox"
                    checked={!!q.shuffleLeft}
                    disabled={isReadOnlyVersion}
                    onChange={(e) => updateQuestion(qIdx, "shuffleLeft", e.target.checked)}
                  />
                  Shuffle Left
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc" }}>
                  <input
                    type="checkbox"
                    checked={q.shuffleRight == null ? true : !!q.shuffleRight}
                    disabled={isReadOnlyVersion}
                    onChange={(e) => updateQuestion(qIdx, "shuffleRight", e.target.checked)}
                  />
                  Shuffle Right
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc" }}>
                  <input
                    type="checkbox"
                    checked={q.allowPartialMarks == null ? true : !!q.allowPartialMarks}
                    disabled={isReadOnlyVersion}
                    onChange={(e) => updateQuestion(qIdx, "allowPartialMarks", e.target.checked)}
                  />
                  Allow Partial Marks
                </label>
              </>
            )}
          </div>
          {isAssignmentQuiz && (q.diagramType === "svg" || q.diagramType === "mermaid") && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Diagram (read-only)
              </div>
              {q.diagramType === "svg" ? (
                <div
                  style={{ marginTop: 4, padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, overflowX: "auto" }}
                  dangerouslySetInnerHTML={{ __html: String(q.diagramData || "") }}
                />
              ) : (
                <MermaidDiagram code={q.diagramData || ""} />
              )}
            </div>
          )}
          {!isAssignmentQuiz && (q.diagramType === "svg" || q.diagramType === "mermaid") && (
            <textarea
              placeholder={q.diagramType === "svg" ? "<svg>...</svg>" : "graph TD; A-->B;"}
              value={q.diagramData || ""}
              disabled={isReadOnlyVersion}
              onChange={(e) => updateQuestion(qIdx, "diagramData", e.target.value)}
              rows={4}
              style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 14, fontFamily: "monospace" }}
            />
          )}
          {(q.diagramType === "svg" || q.diagramType === "mermaid") && String(q.diagramData || "").trim() && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Diagram Preview
              </div>
              {q.diagramType === "svg" ? (
                <div
                  style={{ marginTop: 4, padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, overflowX: "auto" }}
                  dangerouslySetInnerHTML={{ __html: String(q.diagramData || "") }}
                />
              ) : (
                <MermaidDiagram code={q.diagramData || ""} />
              )}
            </div>
          )}

          {((q.questionType || "MCQ") === "MCQ" || (q.questionType || "MCQ") === "TRUE_FALSE") && (
            <div style={{ marginLeft: 8 }}>
              {q.options.map((opt, oIdx) => (
                <div key={oIdx} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <input
                    type="radio"
                    name={`correct-${activeVersion}-${qIdx}`}
                    checked={!!opt.isCorrect}
                    disabled={isReadOnlyVersion}
                    onChange={() => setCorrectOption(qIdx, oIdx)}
                    title="Correct answer"
                  />
                  <span style={{ width: 24, fontSize: 20, fontWeight: 700 }}>{opt.label || LABELS[oIdx]}</span>
                  <input
                    placeholder="Option text"
                    value={opt.text}
                    disabled={isReadOnlyVersion}
                    onChange={(e) => updateOption(qIdx, oIdx, "text", e.target.value)}
                    style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 16 }}
                  />
                </div>
              ))}
            </div>
          )}
          {(q.questionType || "MCQ") === "MIX_MATCH_DRAG" && (
            <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>Matching Pairs</div>
                {!isReadOnlyVersion && (
                  <button
                    type="button"
                    onClick={() => addPairRow(qIdx)}
                    disabled={(q.pairs || []).length >= 10}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: (q.pairs || []).length >= 10 ? "not-allowed" : "pointer", opacity: (q.pairs || []).length >= 10 ? 0.6 : 1 }}
                  >
                    Add Pair
                  </button>
                )}
              </div>
              {(q.pairs || []).map((pair, pairIdx) => (
                <div key={pairIdx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, marginBottom: 10, alignItems: "center" }}>
                  <input
                    placeholder="Left item"
                    value={pair.leftText || ""}
                    disabled={isReadOnlyVersion}
                    onChange={(e) => updatePair(qIdx, pairIdx, "leftText", e.target.value)}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 15 }}
                  />
                  <input
                    placeholder="Right item"
                    value={pair.rightText || ""}
                    disabled={isReadOnlyVersion}
                    onChange={(e) => updatePair(qIdx, pairIdx, "rightText", e.target.value)}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 15 }}
                  />
                  {!isReadOnlyVersion && (
                    <button
                      type="button"
                      onClick={() => removePairRow(qIdx, pairIdx)}
                      disabled={(q.pairs || []).length <= 2}
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#dc2626", cursor: (q.pairs || []).length <= 2 ? "not-allowed" : "pointer", opacity: (q.pairs || []).length <= 2 ? 0.6 : 1 }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}

      {reviewMode && (
        <Card tone="subtle" style={{ marginBottom: 16, border: "1px solid #fcd34d", background: "#fffbeb" }}>
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 20 }}>Change Log</div>
          {!changeLog.length && <div style={{ color: "#6b7280" }}>No teacher changes logged yet.</div>}
          {!!changeLog.length &&
            changeLog.slice(0, 8).map((item) => (
              <div key={item.logId} style={{ fontSize: 14, marginBottom: 8, background: "#fff", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px" }}>
                <b>{item.actionType || "Change"}</b>
                {item.fieldName ? ` (${item.fieldName})` : ""} at {formatDateTime(item.loggedAtUtc)}
                {(item.oldValue || item.newValue) && (
                  <div style={{ color: "#6b7280", marginTop: 4 }}>
                    {shortValue(item.oldValue) ? `"${shortValue(item.oldValue)}"` : "(empty)"} {" -> "} {shortValue(item.newValue) ? `"${shortValue(item.newValue)}"` : "(empty)"}
                  </div>
                )}
              </div>
            ))}
        </Card>
      )}

      <Card style={{ position: "sticky", bottom: 10, zIndex: 10, background: "#fffffffa", border: "1px solid #e5e7eb" }}>
        <FormActions>
        {!isReadOnlyVersion && (
          <>
            <Button
              type="button"
              onClick={() => window.open(`/quiz/${exportQuizId}?autoExport=1`, "_blank", "noopener,noreferrer")}
              variant="secondary"
            >
              Export PDF
            </Button>
            <Button
              type="button"
              onClick={addQuestion}
              disabled={(questions || []).length >= maxQuestionsLimit}
              variant="secondary"
              style={{ opacity: (questions || []).length >= maxQuestionsLimit ? 0.6 : 1 }}
            >
              Add Question
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : reviewMode ? "Save Teacher Changes" : "Save Quiz"}
            </Button>
          </>
        )}

        {reviewMode && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginLeft: 8,
                padding: "8px 10px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                background: "#f8fafc",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
                Publish now
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "#475569",
                  fontWeight: 700,
                  opacity: publishNow ? 0.55 : 1,
                }}
              >
                Quiz Start Date and time:
                <input
                  type="datetime-local"
                  value={publishStartLocal}
                  disabled={publishNow}
                  onChange={(e) => setPublishStartLocal(e.target.value)}
                  style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "#475569",
                  fontWeight: 700,
                  opacity: publishNow ? 0.55 : 1,
                }}
              >
                Quiz Expiry Date and time:
                <input
                  type="datetime-local"
                  value={publishEndLocal}
                  disabled={publishNow}
                  onChange={(e) => setPublishEndLocal(e.target.value)}
                  style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
                />
              </label>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8, fontSize: 16, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={approvalChecked}
                onChange={(e) => setApprovalChecked(e.target.checked)}
              />
              I have reviewed and approve this quiz.
            </label>
            <Button
              type="button"
              disabled={!approvalChecked || publishing || (!publishNow && !publishStartLocal)}
              onClick={handlePublishReviewedQuiz}
            >
              {publishing ? "Publishing..." : "Publish Quiz"}
            </Button>
          </>
        )}

        <Button type="button" onClick={() => navigate("/dashboard")} variant="secondary">
          Back to Dashboard
        </Button>
        </FormActions>
      </Card>
    </div>
  );
}
