import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSidebarRefresh } from "../context/SidebarRefreshContext";
import { apiPost } from "../api/http";

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { triggerRefresh } = useSidebarRefresh();
  const createClass = searchParams.get("createClass") === "1";
  const createQuizClassId = searchParams.get("createQuiz");
  const manageQuizId = searchParams.get("manageQuiz");

  const [className, setClassName] = useState("");
  const [subject, setSubject] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [quizTitle, setQuizTitle] = useState("");
  const [quizDescription, setQuizDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setError("");
    setSuccess("");
  }, [createClass, createQuizClassId, manageQuizId]);

  async function handlePublishQuiz() {
    if (!manageQuizId) return;
    setError("");
    setSubmitting(true);
    try {
      await apiPost(`/api/quizzes/${manageQuizId}/publish`, {});
      setSuccess("Quiz published.");
      triggerRefresh();
      // Keep manage panel open so user sees success.
    } catch (err) {
      setError(err.message || "Failed to publish quiz");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateClass(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const created = await apiPost("/api/classes", {
        className: className.trim(),
        subject: subject.trim() || undefined,
        gradeLevel: gradeLevel.trim() || undefined,
      });
      setSuccess(
        created?.joinCode
          ? `Class created. Join code: ${created.joinCode}`
          : "Class created."
      );
      setClassName("");
      setSubject("");
      setGradeLevel("");
      triggerRefresh();
      setSearchParams({});
    } catch (err) {
      setError(err.message || "Failed to create class");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateQuiz(e) {
    e.preventDefault();
    if (!createQuizClassId) return;
    setError("");
    setSubmitting(true);
    try {
      const created = await apiPost(`/api/classes/${createQuizClassId}/quizzes`, {
        title: quizTitle.trim(),
        description: quizDescription.trim() || undefined,
      });
      setSuccess("Quiz created (draft).");
      setQuizTitle("");
      setQuizDescription("");
      triggerRefresh();
      // Open manage panel so teacher can publish immediately.
      if (created?.quizId) setSearchParams({ manageQuiz: String(created.quizId) });
      else setSearchParams({});
    } catch (err) {
      setError(err.message || "Failed to create quiz");
    } finally {
      setSubmitting(false);
    }
  }

  function cancel() {
    setSearchParams({});
    setError("");
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>

      {createClass && (
        <div style={{ maxWidth: 400, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Create Class</h3>
          <form onSubmit={handleCreateClass}>
            <input
              placeholder="Class name"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <input
              placeholder="Subject (optional)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <input
              placeholder="Grade level (optional)"
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={submitting} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>
                {submitting ? "Creating…" : "Create"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {createQuizClassId && (
        <div style={{ maxWidth: 400, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Create Quiz</h3>
          <form onSubmit={handleCreateQuiz}>
            <input
              placeholder="Quiz title"
              value={quizTitle}
              onChange={(e) => setQuizTitle(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <textarea
              placeholder="Description (optional)"
              value={quizDescription}
              onChange={(e) => setQuizDescription(e.target.value)}
              rows={2}
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={submitting} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>
                {submitting ? "Creating…" : "Create"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {manageQuizId && (
        <div style={{ maxWidth: 520, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Manage Quiz</h3>
          {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
          {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              onClick={() => navigate(`/quiz/${manageQuizId}/edit`)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
            >
              Input / Edit Quiz
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handlePublishQuiz}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}
            >
              {submitting ? "Publishing…" : "Publish"}
            </button>
            <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {!createClass && !createQuizClassId && !manageQuizId && (
        <p style={{ color: "#6b7280" }}>Select a class and quiz from the sidebar, or create a class or quiz.</p>
      )}
    </div>
  );
}
