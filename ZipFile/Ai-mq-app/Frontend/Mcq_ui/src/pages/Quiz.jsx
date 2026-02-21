import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/http";

export default function Quiz() {
  const { quizId } = useParams();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [attemptId, setAttemptId] = useState(null);

  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({}); // { [questionId]: optionId }
  const [result, setResult] = useState(null); // { score,total,scorePercent,details[] }

  const showResults = Boolean(result);

  useEffect(() => {
    let alive = true;

    async function start() {
      try {
        setLoading(true);
        setErr("");
        setResult(null);
        setAnswers({});

        const data = await apiPost(`/api/quizzes/${quizId}/attempts/start`, {});
        if (!alive) return;

        setAttemptId(data.attemptId);
        setQuiz(data.quiz);
      } catch (e) {
        if (!alive) return;
        setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    start();
    return () => {
      alive = false;
    };
  }, [quizId]);

  function onSelect(questionId, optionId) {
    if (showResults) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  }

  async function handleSubmit() {
    try {
      setErr("");

      const payload = {
        answers: quiz.questions.map((q) => ({
          questionId: q.questionId,
          selectedOptionId: answers[q.questionId] ?? null,
        })),
      };

      await apiPost(`/api/attempts/${attemptId}/submit`, payload);
      const res = await apiGet(`/api/attempts/${attemptId}/result`);
      setResult(res);
    } catch (e) {
      setErr(e.message);
    }
  }

  function getDetail(questionId) {
    return result?.details?.find((d) => d.questionId === questionId) || null;
  }

  function getOptionStyle(questionId, optionId) {
    if (!showResults) {
      const selected = answers[questionId] === optionId;
      return {
        border: selected ? "2px solid #2563eb" : "1px solid #e5e7eb",
        background: selected ? "#eff6ff" : "#fff",
      };
    }

    const detail = getDetail(questionId);
    const isCorrect = detail?.correctOptionId === optionId;
    const isWrongSelected =
      detail?.selectedOptionId === optionId && detail?.selectedOptionId !== detail?.correctOptionId;

    if (isCorrect) return { border: "2px solid #16a34a", background: "#dcfce7" }; // green
    if (isWrongSelected) return { border: "2px solid #dc2626", background: "#fee2e2" }; // red
    return { border: "1px solid #e5e7eb", background: "#fff" };
  }

  function renderBadge(questionId, optionId) {
    if (!showResults) return null;
    const detail = getDetail(questionId);
    const isCorrect = detail?.correctOptionId === optionId;
    const isWrongSelected =
      detail?.selectedOptionId === optionId && detail?.selectedOptionId !== detail?.correctOptionId;

    if (isCorrect) return <span style={{ marginLeft: 8 }}>✅</span>;
    if (isWrongSelected) return <span style={{ marginLeft: 8 }}>❌</span>;
    return null;
  }

  if (loading) return <div>Loading quiz...</div>;
  if (err) return <div style={{ color: "crimson" }}>Error: {err}</div>;
  if (!quiz) return <div>No quiz found.</div>;

  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ marginTop: 0 }}>{quiz.title}</h2>
      <p style={{ color: "#6b7280", marginTop: -6 }}>
        Quiz ID: {quizId} • Attempt ID: {attemptId}
      </p>

      {quiz.questions.map((q, idx) => {
        const detail = getDetail(q.questionId);
        const unanswered = showResults && !detail?.selectedOptionId;

        return (
          <div
            key={q.questionId}
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {idx + 1}. {q.questionText}
            </div>

            {unanswered && (
              <div style={{ marginBottom: 10, color: "#b45309" }}>
                ⚠️ Not answered
              </div>
            )}

            <div style={{ display: "grid", gap: 10 }}>
              {q.options.map((o) => (
                <label
                  key={o.optionId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    cursor: showResults ? "default" : "pointer",
                    ...getOptionStyle(q.questionId, o.optionId),
                  }}
                >
                  <input
                    type="radio"
                    name={`q-${q.questionId}`}
                    checked={answers[q.questionId] === o.optionId}
                    onChange={() => onSelect(q.questionId, o.optionId)}
                    disabled={showResults}
                  />
                  <div style={{ flex: 1 }}>
                    <b style={{ marginRight: 8 }}>{o.label}.</b> {o.text}
                    {renderBadge(q.questionId, o.optionId)}
                  </div>
                </label>
              ))}
            </div>

            {showResults && detail?.explanation && (
              <div style={{ marginTop: 12, color: "#374151" }}>
                <b>Explanation:</b> {detail.explanation}
              </div>
            )}
          </div>
        );
      })}

      {!showResults ? (
        <button
          onClick={handleSubmit}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "none",
            background: "#2563eb",
            color: "white",
            cursor: "pointer",
          }}
        >
          Submit Quiz
        </button>
      ) : (
        <div
          style={{
            marginTop: 12,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 16,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Result</h3>
          <div style={{ fontSize: 16 }}>
            Score: <b>{result.score}</b> / <b>{result.total}</b> (<b>{result.scorePercent}%</b>)
          </div>
          <div style={{ color: "#6b7280", marginTop: 6 }}>
            Green = correct answer • Red = your wrong selection
          </div>
        </div>
      )}
    </div>
  );
}
