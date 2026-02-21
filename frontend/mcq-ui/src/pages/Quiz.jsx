import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiGet, apiPost, apiPut } from "../api/http";

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
    return <div style={{ color: "#6b7280", fontSize: 13 }}>Rendering diagram...</div>;
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
  const { isManager, selectedStudentId } = useAuth();
  const exportRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [attemptId, setAttemptId] = useState(null);

  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [showPostExplanations, setShowPostExplanations] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState({});

  const showResults = Boolean(result);

  function formatDateTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
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
        if (isManager && !selectedStudentId) {
          setErr("Select a student from sidebar before starting quiz.");
          return;
        }

        const studentQuery = isManager && selectedStudentId ? `?studentId=${selectedStudentId}` : "";
        const data = await apiPost(`/api/quizzes/${quizId}/attempts/start${studentQuery}`, {});
        if (!alive) return;

        if (!data?.quiz?.questions?.length) {
          setErr("Quiz has no questions yet. Add questions before attempting.");
          setAttemptId(data?.attemptId ?? null);
          setQuiz(data?.quiz ?? null);
          return;
        }

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
  }, [quizId, isManager, selectedStudentId]);

  function onSelect(questionId, optionId) {
    if (showResults) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  }

  async function handleSubmit() {
    if (!quiz?.questions?.length) return;
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

    if (isCorrect) return { border: "2px solid #16a34a", background: "#dcfce7" };
    if (isWrongSelected) return { border: "2px solid #dc2626", background: "#fee2e2" };
    return { border: "1px solid #e5e7eb", background: "#fff" };
  }

  function renderBadge(questionId, optionId) {
    if (!showResults) return null;
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
      const { jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas");
      const MAX_PDF_BYTES = 10 * 1024 * 1024;

      const canvas = await html2canvas(exportRef.current, {
        scale: 1.1,
        backgroundColor: "#f6f8fc",
        useCORS: true,
      });

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      let quality = 0.85;
      let pdf = null;
      let pdfSize = Number.MAX_SAFE_INTEGER;

      while (quality >= 0.35) {
        const imgData = canvas.toDataURL("image/jpeg", quality);

        const nextPdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4", compress: true });
        const pdfWidth = nextPdf.internal.pageSize.getWidth();
        const pdfHeight = nextPdf.internal.pageSize.getHeight();
        const renderWidth = pdfWidth - 24;
        const renderHeight = (imgHeight * renderWidth) / imgWidth;

        let heightLeft = renderHeight;
        let positionY = 12;
        nextPdf.addImage(imgData, "JPEG", 12, positionY, renderWidth, renderHeight);
        heightLeft -= pdfHeight;

        while (heightLeft > 0) {
          nextPdf.addPage();
          positionY = heightLeft - renderHeight + 12;
          nextPdf.addImage(imgData, "JPEG", 12, positionY, renderWidth, renderHeight);
          heightLeft -= pdfHeight;
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

      const safeTitle = String(quiz?.title || "quiz")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 60);
      const phase = result ? "solved" : "preview";
      pdf.save(`${safeTitle}_attempt_${attemptId || "na"}_${phase}.pdf`);
    } catch (e) {
      setErr(e.message || "Failed to export PDF");
    } finally {
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

  if (loading) return <div>Loading quiz...</div>;
  if (!quiz && err) return <div style={{ color: "crimson" }}>Error: {err}</div>;
  if (!quiz) return <div>No quiz found.</div>;

  return (
    <div ref={exportRef} style={{ maxWidth: "100%", padding: "8px 6px 20px" }}>
      <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 26, lineHeight: 1.2 }}>{quiz.title}</h2>
      <p style={{ color: "#6b7280", marginTop: 0, fontSize: 14, marginBottom: 12 }}>
        Quiz ID: {quizId} | Attempt ID: {attemptId}
        {quiz?.createDate ? ` | Created: ${formatDateTime(quiz.createDate)}` : ""}
      </p>
      {err && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            fontSize: 14,
          }}
        >
          {err}
        </div>
      )}
      {quiz.questions.map((q, idx) => {
        const hiddenForStudent = !!q.isHiddenForStudent;
        const managerHiddenPreview = isManager && hiddenForStudent;
        const detail = getDetail(q.questionId);
        const unanswered = showResults && !detail?.selectedOptionId;
        const explanationText = showResults
          ? showPostExplanations
            ? detail?.explanation || ""
            : ""
          : showHints
            ? getHintSteps(q.explanation || "")
            : "";

        return (
          <div
            key={q.questionId}
            style={{
              background: managerHiddenPreview ? "#f8fafc" : "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 14,
              marginBottom: 14,
              opacity: managerHiddenPreview ? 0.72 : 1,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(480px, 2fr) minmax(230px, 0.9fr) minmax(260px, 1fr)",
                gap: 14,
                alignItems: "start",
              }}
            >
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 20, lineHeight: 1.35 }}>
                  {idx + 1}. {q.questionText}
                </div>

                {managerHiddenPreview && (
                  <div style={{ marginBottom: 12, color: "#9a3412", fontWeight: 700, fontSize: 16 }}>
                    Hidden for students (teacher preview only)
                  </div>
                )}
                {isManager && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 14, color: "#374151" }}>
                    <input
                      type="checkbox"
                      checked={hiddenForStudent}
                      disabled={!!visibilityBusy[q.questionId]}
                      onChange={(e) => handleQuestionVisibility(q.questionId, e.target.checked)}
                    />
                    Hide this question for students
                  </label>
                )}

                {unanswered && (
                  <div style={{ marginBottom: 12, color: "#b45309", fontWeight: 700, fontSize: 20 }}>
                    Not answered
                  </div>
                )}

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
                        checked={answers[q.questionId] === o.optionId}
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
              </div>

              <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb", minHeight: 220 }}>
                <div style={{ fontWeight: 800, marginBottom: 8, color: "#111827", fontSize: 18 }}>Diagram</div>
                {renderDiagram(q) || <div style={{ color: "#6b7280", fontSize: 14 }}>No diagram</div>}
              </div>

              <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb", minHeight: 220 }}>
                <div style={{ fontWeight: 800, marginBottom: 8, color: "#111827", fontSize: 18 }}>Explanation</div>
                {showResults ? (
                  showPostExplanations ? (
                    explanationText ? (
                      <div style={{ color: "#374151", whiteSpace: "pre-line", lineHeight: 1.55, fontSize: 14 }}>{explanationText}</div>
                    ) : (
                      <div style={{ color: "#6b7280", fontSize: 14 }}>No explanation.</div>
                    )
                  ) : (
                    <div style={{ color: "#6b7280", fontSize: 14 }}>Click "Show Explanations" below to view full explanation.</div>
                  )
                ) : showHints ? (
                  explanationText ? (
                    <div style={{ color: "#374151", whiteSpace: "pre-line", lineHeight: 1.55, fontSize: 14 }}>{explanationText}</div>
                  ) : (
                    <div style={{ color: "#6b7280", fontSize: 14 }}>No hint available.</div>
                  )
                ) : (
                  <div style={{ color: "#6b7280", fontSize: 14 }}>Click "Show Hint (3 steps)" below to view a short hint before test.</div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {!showResults ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setShowHints((v) => !v)}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#111827",
              cursor: "pointer",
            }}
          >
            {showHints ? "Hide Hint" : "Show Hint (3 steps)"}
          </button>
          <button
            type="button"
            onClick={handleExportSolvedPdf}
            disabled={pdfBusy}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#111827",
              cursor: pdfBusy ? "wait" : "pointer",
            }}
          >
            {pdfBusy ? "Generating PDF..." : "Download Quiz PDF"}
          </button>
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
        </div>
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
            Green = correct answer | Red = your wrong selection
          </div>
          <button
            type="button"
            onClick={() => setShowPostExplanations((v) => !v)}
            style={{
              marginTop: 12,
              marginRight: 10,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#111827",
              cursor: "pointer",
            }}
          >
            {showPostExplanations ? "Hide Explanations" : "Show Explanations"}
          </button>
          <button
            type="button"
            onClick={handleExportSolvedPdf}
            disabled={pdfBusy}
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#111827",
              cursor: pdfBusy ? "wait" : "pointer",
            }}
          >
            {pdfBusy ? "Generating PDF..." : "Download Solved Quiz PDF"}
          </button>
        </div>
      )}
    </div>
  );
}
