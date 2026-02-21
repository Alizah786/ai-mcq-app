import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiGet, apiPut } from "../api/http";

const LABELS = ["A", "B", "C", "D", "E", "F"];

function emptyOption(label) {
  return { label: label || "A", text: "", isCorrect: false };
}

function emptyQuestion() {
  return { questionText: "", explanation: "", options: [emptyOption("A"), emptyOption("B"), emptyOption("C"), emptyOption("D")] };
}

export default function QuizEdit() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState([]);

  useEffect(() => {
    let alive = true;
    setError("");
    async function load() {
      try {
        const data = await apiGet(`/api/quizzes/${quizId}`);
        if (!alive) return;
        setTitle(data.title);
        if (data.questions && data.questions.length) {
          setQuestions(
            data.questions.map((q) => ({
              questionText: q.questionText,
              explanation: q.explanation || "",
              options: (q.options || []).map((o) => ({ label: o.label || "A", text: o.text, isCorrect: !!o.isCorrect })),
            }))
          );
        } else {
          setQuestions([emptyQuestion()]);
        }
      } catch (e) {
        if (alive) setError(e.message || "Failed to load quiz");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [quizId]);

  function addQuestion() {
    setQuestions((prev) => [...prev, emptyQuestion()]);
  }

  function removeQuestion(idx) {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateQuestion(idx, field, value) {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, [field]: value } : q)));
  }

  function updateOption(qIdx, oIdx, field, value) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== qIdx ? q : { ...q, options: q.options.map((o, j) => (j === oIdx ? { ...o, [field]: value } : o)) }
      )
    );
  }

  function setCorrectOption(qIdx, oIdx) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== qIdx ? q : { ...q, options: q.options.map((o, j) => ({ ...o, isCorrect: j === oIdx })) }
      )
    );
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const body = {
        questions: questions.map((q) => ({
          questionText: q.questionText.trim(),
          explanation: q.explanation?.trim() || null,
          options: q.options.filter((o) => o.text.trim()).map((o) => ({ label: o.label, text: o.text.trim(), isCorrect: !!o.isCorrect })),
        })),
      };
      if (body.questions.some((q) => !q.questionText || q.options.length < 1)) {
        setError("Each question needs text and at least one option. Exactly one option must be marked correct.");
        setSaving(false);
        return;
      }
      if (body.questions.some((q) => q.options.filter((o) => o.isCorrect).length !== 1)) {
        setError("Each question must have exactly one correct option.");
        setSaving(false);
        return;
      }
      await apiPut(`/api/quizzes/${quizId}/content`, body);
      navigate(`/dashboard?manageQuiz=${quizId}`);
    } catch (e) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div>Loading quiz…</div>;
  if (error && !questions.length) return <div style={{ color: "#dc2626" }}>{error}</div>;

  return (
    <div style={{ maxWidth: 800 }}>
      <h2 style={{ marginTop: 0 }}>Input / Edit Quiz</h2>
      <p style={{ color: "#6b7280" }}>{title}</p>
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {questions.map((q, qIdx) => (
        <div
          key={qIdx}
          style={{
            marginBottom: 24,
            padding: 16,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong>Question {qIdx + 1}</strong>
            <button type="button" onClick={() => removeQuestion(qIdx)} style={{ padding: "4px 10px", fontSize: 13, color: "#dc2626" }}>
              Remove
            </button>
          </div>
          <input
            placeholder="Question text"
            value={q.questionText}
            onChange={(e) => updateQuestion(qIdx, "questionText", e.target.value)}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          <input
            placeholder="Explanation (optional)"
            value={q.explanation}
            onChange={(e) => updateQuestion(qIdx, "explanation", e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 12, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 14 }}
          />
          <div style={{ marginLeft: 8 }}>
            {q.options.map((opt, oIdx) => (
              <div key={oIdx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <input
                  type="radio"
                  name={`correct-${qIdx}`}
                  checked={opt.isCorrect}
                  onChange={() => setCorrectOption(qIdx, oIdx)}
                  title="Correct answer"
                />
                <span style={{ width: 24 }}>{opt.label || LABELS[oIdx]}</span>
                <input
                  placeholder="Option text"
                  value={opt.text}
                  onChange={(e) => updateOption(qIdx, oIdx, "text", e.target.value)}
                  style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={addQuestion} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
          ➕ Add Question
        </button>
        <button type="button" onClick={handleSave} disabled={saving} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>
          {saving ? "Saving…" : "Save Quiz"}
        </button>
        <button type="button" onClick={() => navigate("/dashboard")} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
