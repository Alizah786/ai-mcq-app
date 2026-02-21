import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../api/http";
import { useAuth } from "../context/AuthContext";

const LABELS = ["A", "B", "C", "D", "E", "F"];

function emptyOption(label) {
  return { label: label || "A", text: "", isCorrect: false };
}

function emptyQuestion() {
  return {
    questionText: "",
    explanation: "",
    diagramType: "none",
    diagramData: "",
    isHiddenForStudent: false,
    options: [emptyOption("A"), emptyOption("B"), emptyOption("C"), emptyOption("D")],
  };
}

function normalizeQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) return [emptyQuestion()];
  return rawQuestions.map((q) => ({
    questionId: q.questionId || null,
    questionText: q.questionText || "",
    explanation: q.explanation || "",
    diagramType: q.diagramType || "none",
    diagramData: q.diagramData || "",
    isHiddenForStudent: !!q.isHiddenForStudent,
    options: Array.isArray(q.options) && q.options.length
      ? q.options.map((o, idx) => ({
          label: o.label || LABELS[idx] || String(idx + 1),
          text: o.text || "",
          isCorrect: !!o.isCorrect,
        }))
      : [emptyOption("A"), emptyOption("B"), emptyOption("C"), emptyOption("D")],
  }));
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function shortValue(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
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

  const [reviewMode, setReviewMode] = useState(false);
  const [sourceQuizId, setSourceQuizId] = useState(null);
  const [workingQuizId, setWorkingQuizId] = useState(null);
  const [activeVersion, setActiveVersion] = useState("working");
  const [originalQuestions, setOriginalQuestions] = useState([]);
  const [changeLog, setChangeLog] = useState([]);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [isEdited, setIsEdited] = useState(false);

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
              setTitle(review?.working?.title || review?.original?.title || "");
              setQuestions(normalizeQuestions(review?.working?.questions || []));
              setOriginalQuestions(normalizeQuestions(review?.original?.questions || []));
              setChangeLog(Array.isArray(review.changeLog) ? review.changeLog : []);
              const editedFlag =
                !!review?.working?.isTeacherEdited ||
                !!review?.working?.isManagerEdited ||
                Number(review.workingQuizId) !== Number(review.sourceQuizId) ||
                (Array.isArray(review.changeLog) && review.changeLog.length > 0);
              setIsEdited(editedFlag);
              return;
            }
          } catch {
            // Fallback to normal edit endpoint.
          }
        }

        const data = await apiGet(`/api/quizzes/${quizId}`);
        if (!alive) return;
        setReviewMode(false);
        setTitle(data.title || "");
        setQuestions(normalizeQuestions(data.questions || []));
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
  const isReadOnlyVersion = reviewMode && activeVersion === "original";

  function addQuestion() {
    if (isReadOnlyVersion) return;
    setQuestions((prev) => [...prev, emptyQuestion()]);
  }

  function removeQuestion(idx) {
    if (isReadOnlyVersion) return;
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateQuestion(idx, field, value) {
    if (isReadOnlyVersion) return;
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

  function buildPayload() {
    return {
      questions: questions.map((q) => ({
        questionText: String(q.questionText || "").trim(),
        explanation: q.explanation?.trim() || null,
        diagramType: q.diagramType || "none",
        diagramData: q.diagramType && q.diagramType !== "none" ? (q.diagramData?.trim() || null) : null,
        isHiddenForStudent: !!q.isHiddenForStudent,
        options: q.options
          .filter((o) => String(o.text || "").trim())
          .map((o, idx) => ({
            label: o.label || LABELS[idx] || String(idx + 1),
            text: String(o.text || "").trim(),
            isCorrect: !!o.isCorrect,
          })),
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
      if (body.questions.some((q) => !q.questionText || q.options.length < 1)) {
        setError("Each question needs text and at least one option.");
        setSaving(false);
        return;
      }
      if (body.questions.some((q) => q.options.filter((o) => o.isCorrect).length !== 1)) {
        setError("Each question must have exactly one correct option.");
        setSaving(false);
        return;
      }

      if (reviewMode) {
        const result = await apiPut(`/api/quizzes/${sourceQuizId}/teacher-review/content`, body);
        setIsEdited(true);
        setChangeLog(Array.isArray(result?.changeLog) ? result.changeLog : []);
        setSuccess("Teacher updates saved.");
      } else {
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
    setPublishing(true);
    setError("");
    setSuccess("");
    try {
      await apiPost(`/api/quizzes/${sourceQuizId}/teacher-review/publish`, { approved: true });
      setSuccess("Teacher reviewed quiz published.");
      navigate(`/dashboard?manageQuiz=${workingQuizId || sourceQuizId}`);
    } catch (e) {
      setError(e.message || "Failed to publish reviewed quiz");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) return <div>Loading quiz...</div>;
  if (error && !questions.length && !originalQuestions.length) return <div style={{ color: "#dc2626" }}>{error}</div>;

  return (
    <div style={{ maxWidth: 1360, margin: "0 auto", paddingBottom: 92 }}>
      {reviewMode && (
        <div
          style={{
            marginBottom: 14,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #f59e0b",
            background: "#fffbeb",
            color: "#7c2d12",
            fontWeight: 800,
            fontSize: 22,
          }}
        >
          AI-Generated Quiz: Teacher Must Review Before Publishing
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 36, lineHeight: 1.15 }}>
          {reviewMode ? "Teacher Review & Edit Quiz" : "Input / Edit Quiz"}
        </h2>
        {reviewMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setActiveVersion("original")}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: activeVersion === "original" ? "#eef2ff" : "#fff",
                fontWeight: 700,
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              Original AI Version
            </button>
            <button
              type="button"
              onClick={() => setActiveVersion("working")}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: activeVersion === "working" ? "#eef2ff" : "#fff",
                fontWeight: 700,
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              Teacher Modified Version
            </button>
            {isEdited && (
              <span
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid #fcd34d",
                  background: "#fef3c7",
                  color: "#92400e",
                  fontWeight: 800,
                  fontSize: 16,
                }}
              >
                Edited
              </span>
            )}
          </div>
        )}
      </div>

      <p style={{ color: "#6b7280", marginTop: 0, fontSize: 22, fontWeight: 700 }}>{title}</p>
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      {success && <p style={{ color: "#16a34a" }}>{success}</p>}

      {displayedQuestions.map((q, qIdx) => (
        <div
          key={`${activeVersion}-${qIdx}`}
          style={{
            marginBottom: 20,
            padding: 18,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: 24 }}>Question {qIdx + 1}</strong>
            {!isReadOnlyVersion && (
              <button type="button" onClick={() => removeQuestion(qIdx)} style={{ padding: "6px 12px", fontSize: 15, borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#dc2626" }}>
                Delete
              </button>
            )}
          </div>
          <input
            placeholder="Question text"
            value={q.questionText}
            disabled={isReadOnlyVersion}
            onChange={(e) => updateQuestion(qIdx, "questionText", e.target.value)}
            style={{ width: "100%", padding: 12, marginBottom: 8, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 16 }}
          />
          <input
            placeholder="Explanation (optional)"
            value={q.explanation}
            disabled={isReadOnlyVersion}
            onChange={(e) => updateQuestion(qIdx, "explanation", e.target.value)}
            style={{ width: "100%", padding: 12, marginBottom: 12, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 16 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select
              value={q.diagramType || "none"}
              disabled={isReadOnlyVersion}
              onChange={(e) => updateQuestion(qIdx, "diagramType", e.target.value)}
              style={{ width: 220, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 16 }}
            >
              <option value="none">No Diagram</option>
              <option value="svg">SVG Diagram</option>
              <option value="mermaid">Mermaid Diagram</option>
            </select>
          </div>
          {!isReadOnlyVersion && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "#374151", fontSize: 16, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={!!q.isHiddenForStudent}
                onChange={(e) => updateQuestion(qIdx, "isHiddenForStudent", e.target.checked)}
              />
              Hide this question for students (teacher preview only)
            </label>
          )}
          {(q.diagramType === "svg" || q.diagramType === "mermaid") && (
            <textarea
              placeholder={q.diagramType === "svg" ? "<svg>...</svg>" : "graph TD; A-->B;"}
              value={q.diagramData || ""}
              disabled={isReadOnlyVersion}
              onChange={(e) => updateQuestion(qIdx, "diagramData", e.target.value)}
              rows={4}
              style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 14, fontFamily: "monospace" }}
            />
          )}

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
        </div>
      ))}

      {reviewMode && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: "1px solid #fcd34d", background: "#fffbeb" }}>
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
        </div>
      )}

      <div style={{ position: "sticky", bottom: 10, zIndex: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "#fffffffa", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
        {!isReadOnlyVersion && (
          <>
            <button type="button" onClick={addQuestion} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
              Add Question
            </button>
            <button type="button" onClick={handleSave} disabled={saving} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 800, fontSize: 16 }}>
              {saving ? "Saving..." : reviewMode ? "Save Teacher Changes" : "Save Quiz"}
            </button>
          </>
        )}

        {reviewMode && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8, fontSize: 16, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={approvalChecked}
                onChange={(e) => setApprovalChecked(e.target.checked)}
              />
              I have reviewed and approve this quiz.
            </label>
            <button
              type="button"
              disabled={!approvalChecked || publishing}
              onClick={handlePublishReviewedQuiz}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: !approvalChecked ? "#bfdbfe" : "#2563eb",
                color: "#fff",
                cursor: !approvalChecked ? "not-allowed" : "pointer",
                fontWeight: 800,
                fontSize: 16,
              }}
            >
              {publishing ? "Publishing..." : "Publish Quiz"}
            </button>
          </>
        )}

        <button type="button" onClick={() => navigate("/dashboard")} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
