import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiGet } from "../api/http";
import { useAuth } from "../context/AuthContext";

function isAiQuizTitle(title) {
  return /\bai quiz\b/i.test(String(title || ""));
}

function formatQuizTitle(title) {
  const text = String(title || "").trim();
  if (!text) return "Untitled Quiz";
  return text
    .replace(/\s*quiz\s*$/i, "")
    .replace(/\s*-\s*ai\s*$/i, "")
    .trim();
}

function hashString(input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatUtcDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function statusLabel(quiz) {
  if (quiz.availabilityState === "scheduled") return "Inactive";
  if (quiz.availabilityState === "expired") return "Expired";
  if (quiz.progressState === "completed") return "Completed";
  if (quiz.progressState === "in_progress") return "In progress";
  if (quiz.progressState === "attempted") return "Attempted";
  return "Not started";
}

function cardMeta(quiz) {
  const parts = [];
  parts.push(`${Number(quiz.questionCount || 0)} Q`);
  parts.push(Number(quiz.timeLimitMinutes || 0) > 0 ? `${Number(quiz.timeLimitMinutes)} min` : "No timer");
  parts.push(`${Number(quiz.attemptsRemaining || 0)} attempts left`);
  return parts.join(" | ");
}

export default function AssignedQuizzes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quizzes, setQuizzes] = useState([]);

  const isAssignedStudent =
    user?.role === "Student" &&
    Number(user?.managerId || 0) > 0 &&
    !user?.isDirectStudent;

  useEffect(() => {
    let alive = true;
    async function loadAssignedQuizzes() {
      try {
        setLoading(true);
        setError("");
        const res = await apiGet("/api/assigned-quizzes");
        if (!alive) return;
        setQuizzes(Array.isArray(res?.quizzes) ? res.quizzes : []);
      } catch (e) {
        if (!alive) return;
        setError(e.message || "Failed to load assigned quizzes.");
        setQuizzes([]);
      } finally {
        if (alive) setLoading(false);
      }
    }
    if (isAssignedStudent) {
      loadAssignedQuizzes();
      return () => {
        alive = false;
      };
    }
    setLoading(false);
    return () => {
      alive = false;
    };
  }, [isAssignedStudent]);

  const grouped = useMemo(() => {
    const daySeed = new Date().toISOString().slice(0, 10);
    const byClass = new Map();

    for (const quiz of quizzes) {
      const classKey = String(quiz.sourceClassName || "Assigned Quizzes");
      if (!byClass.has(classKey)) {
        byClass.set(classKey, {
          className: classKey,
          subject: quiz.sourceSubject || "",
          gradeLevel: quiz.sourceGradeLevel || "",
          ai: [],
          manual: [],
        });
      }
      const bucket = isAiQuizTitle(quiz.title) ? "ai" : "manual";
      byClass.get(classKey)[bucket].push(quiz);
    }

    return Array.from(byClass.values()).map((group) => {
      const sortGroup = (items, categoryKey) =>
        [...items].sort((a, b) => {
          const aSeed = hashString(`${user?.userId || 0}:${daySeed}:${group.className}:${categoryKey}:${a.quizId}`);
          const bSeed = hashString(`${user?.userId || 0}:${daySeed}:${group.className}:${categoryKey}:${b.quizId}`);
          if (aSeed !== bSeed) return aSeed - bSeed;
          return Number(a.quizId || 0) - Number(b.quizId || 0);
        });
      return {
        ...group,
        ai: sortGroup(group.ai, "ai"),
        manual: sortGroup(group.manual, "manual"),
      };
    });
  }, [quizzes, user?.userId]);

  if (!isAssignedStudent) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, color: "#142033", fontSize: 34, lineHeight: 1.1 }}>Assigned Quizzes</h1>
        <div style={{ color: "#6b7280", marginTop: 8, fontSize: 15 }}>
          Teacher-assigned published quizzes only. Order is shuffled per student and refreshed daily.
        </div>
      </div>

      {error && <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 16 }}>{error}</div>}
      {loading && <div style={{ color: "#475569", marginBottom: 16 }}>Loading assigned quizzes...</div>}

      {!loading && !error && grouped.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 20, color: "#64748b" }}>
          No assigned quizzes are available right now.
        </div>
      )}

      {!loading && !error && grouped.map((group) => (
        <section
          key={group.className}
          style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 18, marginBottom: 20 }}
        >
          <div style={{ marginBottom: 14 }}>
            <div style={{ color: "#142033", fontWeight: 800, fontSize: 22 }}>{group.className}</div>
            <div style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>
              {[group.subject, group.gradeLevel].filter(Boolean).join(" • ") || "Assigned quiz category"}
            </div>
          </div>

          {[
            { key: "ai", label: "AI Quiz", items: group.ai },
            { key: "manual", label: "Manual Quiz", items: group.manual },
          ].map((category) =>
            category.items.length ? (
              <div key={`${group.className}-${category.key}`} style={{ marginBottom: 14 }}>
                <div style={{ color: "#64748b", fontSize: 13, fontWeight: 800, letterSpacing: 0.3, marginBottom: 10 }}>
                  {category.label}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                  {category.items.map((quiz) => (
                    <button
                      key={quiz.quizId}
                      type="button"
                      onClick={() => {
                        if (quiz.availabilityState === "scheduled" || quiz.availabilityState === "expired") return;
                        navigate(`/quiz/${quiz.quizId}`);
                      }}
                      style={{
                        textAlign: "left",
                        border: "1px solid #dbe3ef",
                        background: quiz.availabilityState === "scheduled" || quiz.availabilityState === "expired" ? "#f8fafc" : "#f8fafc",
                        borderRadius: 16,
                        padding: 16,
                        cursor: quiz.availabilityState === "scheduled" || quiz.availabilityState === "expired" ? "not-allowed" : "pointer",
                        opacity: quiz.availabilityState === "scheduled" || quiz.availabilityState === "expired" ? 0.8 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                        <div style={{ color: "#142033", fontWeight: 800, fontSize: 18, lineHeight: 1.3 }}>
                          {formatQuizTitle(quiz.title)}
                        </div>
                        <div
                          style={{
                            whiteSpace: "nowrap",
                            color:
                              quiz.availabilityState === "scheduled"
                                ? "#92400e"
                                : quiz.availabilityState === "expired"
                                  ? "#991b1b"
                                  : quiz.progressState === "completed"
                                    ? "#166534"
                                    : "#1d4ed8",
                            background:
                              quiz.availabilityState === "scheduled"
                                ? "#fef3c7"
                                : quiz.availabilityState === "expired"
                                  ? "#fee2e2"
                                  : quiz.progressState === "completed"
                                    ? "#dcfce7"
                                    : "#dbeafe",
                            borderRadius: 999,
                            padding: "4px 8px",
                            fontSize: 12,
                            fontWeight: 800,
                            alignSelf: "flex-start",
                          }}
                        >
                          {statusLabel(quiz)}
                        </div>
                      </div>
                      <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>{cardMeta(quiz)}</div>
                      {quiz.availabilityState === "scheduled" && !!quiz.publishStartUtc && (
                        <div style={{ color: "#92400e", fontSize: 13, marginBottom: 8 }}>
                          Active on: {formatUtcDate(quiz.publishStartUtc)}
                        </div>
                      )}
                      {quiz.availabilityState === "expired" && !!quiz.publishEndUtc && (
                        <div style={{ color: "#991b1b", fontSize: 13, marginBottom: 8 }}>
                          Expired on: {formatUtcDate(quiz.publishEndUtc)}
                        </div>
                      )}
                      {!!quiz.topic && <div style={{ color: "#334155", fontSize: 14, marginBottom: 8 }}>Topic: {quiz.topic}</div>}
                      {!!quiz.lastSubmittedAtUtc && (
                        <div style={{ color: "#64748b", fontSize: 12 }}>Last submitted: {formatUtcDate(quiz.lastSubmittedAtUtc)}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          )}
        </section>
      ))}
    </div>
  );
}
