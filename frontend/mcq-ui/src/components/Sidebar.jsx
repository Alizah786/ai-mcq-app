import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSidebarRefresh } from "../context/SidebarRefreshContext";
import { apiDelete, apiGet } from "../api/http";

export default function Sidebar({ onNavigate, isMobile = false, searchQuery = "" }) {
  const navigate = useNavigate();
  const { user, logout, isManager, selectedStudentId, setSelectedStudentId } = useAuth();
  const { refreshKey, triggerRefresh } = useSidebarRefresh();
  const [openClassId, setOpenClassId] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiCapability, setAiCapability] = useState({ canGenerate: true, reason: "", provider: "" });

  useEffect(() => {
    let alive = true;
    async function fetchStudentsIfManager() {
      if (!isManager) {
        setStudents([]);
        return;
      }
      try {
        const res = await apiGet("/api/teacher/students");
        if (!alive) return;
        const list = res.students || [];
        setStudents(list);
        if (!selectedStudentId && list.length > 0) {
          setSelectedStudentId(list[0].studentId);
        }
      } catch (e) {
        if (!alive) return;
        setError(e.message || "Failed to load students");
      }
    }
    fetchStudentsIfManager();
    return () => {
      alive = false;
    };
  }, [isManager, refreshKey, selectedStudentId, setSelectedStudentId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    async function fetchClasses() {
      try {
        const query = isManager && selectedStudentId ? `?studentId=${selectedStudentId}` : "";
        const res = await apiGet(`/api/classes${query}`);
        if (alive) setClasses(res.classes || []);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    if (isManager && !selectedStudentId) {
      setClasses([]);
      setLoading(false);
      return;
    }
    fetchClasses();
    return () => {
      alive = false;
    };
  }, [refreshKey, isManager, selectedStudentId]);

  useEffect(() => {
    let alive = true;
    async function fetchAICapability() {
      try {
        const cap = await apiGet("/api/ai/capability");
        if (!alive) return;
        setAiCapability({
          canGenerate: !!cap.canGenerate,
          reason: cap.reason || "",
          provider: cap.provider || "",
        });
      } catch (e) {
        if (!alive) return;
        setAiCapability({
          canGenerate: false,
          reason: e.message || "AI capability check failed",
          provider: "",
        });
      }
    }
    fetchAICapability();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function handleDeleteQuiz(e, quizId) {
    e.stopPropagation();
    const ok = window.confirm("Delete this quiz and all related attempts?");
    if (!ok) return;
    try {
      await apiDelete(`/api/quizzes/${quizId}`);
      triggerRefresh();
    } catch (err) {
      alert(err.message || "Failed to delete quiz");
    }
  }

  async function handleDeleteClass(e, classId) {
    e.stopPropagation();
    const ok = window.confirm("Delete this empty class?");
    if (!ok) return;
    try {
      await apiDelete(`/api/classes/${classId}`);
      if (openClassId === classId) setOpenClassId(null);
      triggerRefresh();
    } catch (err) {
      alert(err.message || "Failed to delete class");
    }
  }

  function go(path) {
    navigate(path);
    if (onNavigate) onNavigate();
  }

  const studentLabel = isManager
    ? students.find((s) => s.studentId === Number(selectedStudentId))?.studentCode || "Select student"
    : user?.displayName || "";
  const selectedStudent = students.find((s) => s.studentId === Number(selectedStudentId)) || null;
  const roleLabel = user?.role === "Manager" ? "Teacher" : (user?.role || "User");
  const normalizedQuery = String(searchQuery || "").trim().toLowerCase();
  const filteredClasses = !normalizedQuery
    ? classes
    : classes
        .map((c) => {
          const classMatch = String(c.className || "").toLowerCase().includes(normalizedQuery);
          const quizzes = Array.isArray(c.quizzes) ? c.quizzes : [];
          const matchedQuizzes = quizzes.filter((q) =>
            String(q.title || "").toLowerCase().includes(normalizedQuery)
          );

          if (classMatch) return c;
          if (matchedQuizzes.length) return { ...c, quizzes: matchedQuizzes };
          return null;
        })
        .filter(Boolean);

  return (
    <aside
      style={{
        width: isMobile ? "min(92vw, 380px)" : 380,
        minWidth: isMobile ? "min(92vw, 380px)" : 380,
        height: isMobile ? "100vh" : "auto",
        background: "#eef1f5",
        borderRight: "1px solid #e5e7eb",
        padding: 18,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          background: "#f3f4f6",
          border: "1px solid #d7dde6",
          borderRadius: 34,
          padding: 18,
          minHeight: "calc(100vh - 28px)",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <div
            style={{
              width: 66,
              height: 66,
              borderRadius: 18,
              background: "linear-gradient(145deg,#fdecc8,#f6dea7)",
              display: "grid",
              placeItems: "center",
              fontSize: 22,
              fontWeight: 800,
              color: "#ef8d3a",
              letterSpacing: 0.5,
            }}
          >
            MCQ
          </div>
          <div style={{ color: "#26334d", fontWeight: 800, fontSize: 24, lineHeight: 1.05 }}>
            AI MCQ
            <br />
            Classroom
          </div>
        </div>

        <div style={{ height: 1, background: "#d7dde6", marginBottom: 14 }} />

        <div style={{ color: "#7484a1", fontWeight: 700, fontSize: 15, letterSpacing: 1, marginBottom: 16 }}>
          ROLE: <span style={{ color: "#25324a", fontWeight: 800, fontSize: 20 }}>{roleLabel}</span>
        </div>

        <div style={{ color: "#7484a1", fontWeight: 700, fontSize: 15, letterSpacing: 1, marginBottom: 10 }}>
          CURRENT STUDENT
        </div>

        {isManager ? (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              background: "#eef2f7",
              border: "1px solid #d7dde6",
              borderRadius: 18,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "linear-gradient(145deg,#f7b262,#ec8e33)",
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                fontWeight: 800,
                color: "#fff",
              }}
            >
              USER
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#111827", fontSize: 18, fontWeight: 800, lineHeight: 1 }}>
                {selectedStudent?.studentCode || "Select student"}
              </div>
              <div style={{ color: "#7484a1", fontSize: 13, fontWeight: 700, marginTop: 4, wordBreak: "break-all" }}>
                {selectedStudent?.userName || ""}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              background: "#eef2f7",
              border: "1px solid #d7dde6",
              borderRadius: 18,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "linear-gradient(145deg,#f7b262,#ec8e33)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 800,
                color: "#fff",
              }}
            >
              USER
            </div>
            <div style={{ color: "#111827", fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>{studentLabel}</div>
          </div>
        )}

        {isManager && (
          <>
            <div style={{ color: "#7484a1", fontWeight: 700, fontSize: 15, letterSpacing: 0.4, marginBottom: 8 }}>Select Student</div>
            <select
              value={selectedStudentId || ""}
              onChange={(e) => setSelectedStudentId(e.target.value ? Number(e.target.value) : null)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 16,
                border: "1px solid #d7dde6",
                marginBottom: 10,
                fontSize: 14,
                fontWeight: 700,
                color: "#26334d",
                background: "#ffffff",
              }}
            >
              {!students.length && <option value="">No students</option>}
              {students.map((s) => (
                <option key={s.studentId} value={s.studentId}>
                  {s.studentCode} ({s.userName})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => go("/dashboard?createStudent=1")}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 999,
                border: "1px solid #d7dde6",
                background: "#f6f7f9",
                cursor: "pointer",
                marginBottom: 12,
                fontSize: 18,
                fontWeight: 800,
                color: "#111827",
              }}
            >
              <span style={{ color: "#ef8d3a", marginRight: 8 }}>+</span>
              Create Student
            </button>
          </>
        )}

        <div style={{ color: "#7484a1", fontWeight: 700, fontSize: 15, letterSpacing: 1, marginBottom: 10 }}>MY CLASSES</div>

        {loading && <div style={{ color: "#374151", fontSize: 17, fontWeight: 700 }}>Loading...</div>}
        {error && <div style={{ color: "#dc2626", fontSize: 15 }}>{error}</div>}
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>
          {!loading &&
            !error &&
            filteredClasses.map((c) => (
              <div key={c.classId} style={{ marginBottom: 10 }}>
                <button
                  onClick={() => {
                    const nextOpen = openClassId === c.classId ? null : c.classId;
                    setOpenClassId(nextOpen);
                    if (nextOpen) {
                      go(`/dashboard?classInfo=${c.classId}`);
                    } else {
                      go("/dashboard");
                    }
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 16,
                    border: "1px solid #d7dde6",
                    background: openClassId === c.classId ? "#e8edf6" : "#f7f8fa",
                    cursor: "pointer",
                    fontWeight: 800,
                    fontSize: 18,
                    color: "#121826",
                  }}
                >
                  <span style={{ color: "#9a8df1", marginRight: 8 }}>[ ]</span>
                  {c.className}
                </button>

                {openClassId === c.classId && (
                  <div style={{ marginTop: 8, paddingLeft: 8 }}>
                    {c.joinCode && (
                      <div style={{ padding: "0 8px 8px", fontSize: 14, fontWeight: 700, color: "#5f6f8d" }}>
                        Join code: <b>{c.joinCode}</b>
                      </div>
                    )}
                    {(c.quizzes || []).map((q) => (
                      <div
                        key={q.quizId}
                        onClick={() => {
                          if (q.status === "Draft") {
                            go(`/quiz/${q.quizId}/edit`);
                            return;
                          }
                          go(`/quiz/${q.quizId}`);
                        }}
                        style={{
                          padding: "10px 8px",
                          borderRadius: 12,
                          cursor: "pointer",
                          color: "#111827",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          fontWeight: 700,
                          fontSize: 16,
                        }}
                      >
                        <span>
                          [Quiz] {q.title}
                          <span style={{ marginLeft: 6, fontSize: 15, fontWeight: 800, color: "#111827" }}>
                            ({Number(q.questionCount || 0)} Q)
                          </span>
                          {q.isAssigned && (
                            <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 800, color: "#0f766e" }}>(Assigned)</span>
                          )}
                          {q.status === "Draft" && (
                            <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 700, color: "#5f6f8d" }}>(Draft)</span>
                          )}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {isManager && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                go(`/quiz/${q.quizId}/edit`);
                              }}
                              style={{
                                border: "1px solid #d1d5db",
                                background: "#f9fafb",
                                color: "#111827",
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 700,
                                padding: "3px 8px",
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                          )}
                          {isManager && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                go(`/dashboard?assignQuiz=${q.quizId}`);
                              }}
                              style={{
                                border: "1px solid #bfdbfe",
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 700,
                                padding: "3px 8px",
                                cursor: "pointer",
                              }}
                            >
                              Assign
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteQuiz(e, q.quizId)}
                            style={{
                              border: "1px solid #fecaca",
                              background: "#fff1f2",
                              color: "#be123c",
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 700,
                              padding: "3px 8px",
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    <div
                      onClick={() => go(`/dashboard?createQuiz=${c.classId}`)}
                      style={{ padding: "9px 8px", borderRadius: 10, cursor: "pointer", color: "#2563eb", fontWeight: 700, fontSize: 16 }}
                    >
                      + Create Quiz
                    </div>
                    <div
                      onClick={() => {
                        if (!aiCapability.canGenerate) return;
                        go(`/dashboard?generateAi=${c.classId}`);
                      }}
                      style={{
                        padding: "9px 8px",
                        borderRadius: 10,
                        cursor: aiCapability.canGenerate ? "pointer" : "not-allowed",
                        color: aiCapability.canGenerate ? "#0f766e" : "#9ca3af",
                        fontWeight: 700,
                        fontSize: 16,
                      }}
                      title={aiCapability.canGenerate ? `Provider: ${aiCapability.provider || "ai"}` : aiCapability.reason || "AI not available"}
                    >
                      + Generate AI Quiz
                    </div>
                    <div
                      onClick={() => go(`/dashboard?importExcel=${c.classId}`)}
                      style={{ padding: "9px 8px", borderRadius: 10, cursor: "pointer", color: "#7c3aed", fontWeight: 700, fontSize: 16 }}
                    >
                      + Import Excel Quiz
                    </div>
                    {(c.quizzes || []).length === 0 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteClass(e, c.classId)}
                        style={{
                          marginTop: 8,
                          marginLeft: 8,
                          border: "1px solid #fecaca",
                          background: "#fff1f2",
                          color: "#be123c",
                          borderRadius: 8,
                          fontSize: 14,
                          fontWeight: 700,
                          padding: "6px 10px",
                          cursor: "pointer",
                        }}
                      >
                        Delete Class
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          {!loading && !error && !filteredClasses.length && !!normalizedQuery && (
            <div style={{ color: "#6b7280", fontSize: 14, padding: "6px 2px" }}>
              No classes or quizzes found for "{searchQuery}".
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => go("/dashboard?createClass=1")}
          disabled={isManager && !selectedStudentId}
          style={{
            width: "100%",
            padding: "12px 12px",
            borderRadius: 999,
            border: "1px solid #d7dde6",
            background: "#f6f7f9",
            cursor: isManager && !selectedStudentId ? "not-allowed" : "pointer",
            marginTop: 10,
            marginBottom: 8,
            fontSize: 18,
            fontWeight: 800,
            color: "#111827",
          }}
        >
          <span style={{ color: "#ef8d3a", marginRight: 8 }}>+</span>
          Create Class
        </button>

        {isManager && (
          <button
            type="button"
            onClick={() => go("/dashboard?importStudents=1")}
            style={{
              width: "100%",
              padding: "11px 12px",
              borderRadius: 999,
              border: "1px solid #d7dde6",
              background: "#f6f7f9",
              cursor: "pointer",
              marginBottom: 8,
              fontSize: 16,
              fontWeight: 800,
              color: "#111827",
            }}
          >
            <span style={{ color: "#2563eb", marginRight: 8 }}>+</span>
            Import Students (Excel)
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            logout();
            navigate("/login", { replace: true });
            if (onNavigate) onNavigate();
          }}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid #d7dde6",
            background: "#ffffff",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: 700,
            color: "#334155",
          }}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
