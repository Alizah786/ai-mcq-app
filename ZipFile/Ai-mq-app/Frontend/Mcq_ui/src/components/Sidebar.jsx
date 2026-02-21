import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSidebarRefresh } from "../context/SidebarRefreshContext";
import { apiGet, apiPost } from "../api/http";

export default function Sidebar() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { refreshKey, triggerRefresh } = useSidebarRefresh();
  const [openClassId, setOpenClassId] = useState(null);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    async function fetchClasses() {
      try {
        const res = await apiGet("/api/classes");
        if (alive) setClasses(res.classes || []);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    fetchClasses();
    return () => { alive = false; };
  }, [refreshKey]);

  async function handleJoinClass() {
    const joinCode = window.prompt("Enter class join code:");
    if (!joinCode?.trim()) return;
    try {
      await apiPost("/api/classes/join", { joinCode: joinCode.trim() });
      triggerRefresh();
    } catch (e) {
      alert(e.message || "Failed to join class");
    }
  }

  return (
    <aside
      style={{
        width: 280,
        background: "#ffffff",
        borderRight: "1px solid #e5e7eb",
        padding: 16,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
        AI MCQ Classroom
      </div>
      {user && (
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
          {user.displayName}
        </div>
      )}

      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
        My Classes
      </div>

      {loading && <div style={{ color: "#6b7280" }}>Loading…</div>}
      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}
      {!loading && !error && classes.map((c) => (
        <div key={c.classId} style={{ marginBottom: 10 }}>
          <button
            onClick={() => setOpenClassId(openClassId === c.classId ? null : c.classId)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: openClassId === c.classId ? "#eef2ff" : "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {c.className}
          </button>

          {openClassId === c.classId && (
            <div style={{ marginTop: 8, paddingLeft: 10 }}>
              {c.joinCode && (
                <div style={{ padding: "0 10px 8px", fontSize: 12, color: "#6b7280" }}>
                  Join code: <b>{c.joinCode}</b>
                </div>
              )}
              {(c.quizzes || []).map((q) => (
                <div
                  key={q.quizId}
                  onClick={() => {
                    if (q.status === "Draft") {
                      navigate(`/quiz/${q.quizId}/edit`);
                      return;
                    }
                    navigate(`/quiz/${q.quizId}`);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                    color: "#111827",
                  }}
                >
                  📄 {q.title}
                  {q.status === "Draft" && <span style={{ marginLeft: 6, fontSize: 11, color: "#6b7280" }}>(Draft)</span>}
                </div>
              ))}
              <div
                onClick={() => navigate(`/dashboard?createQuiz=${c.classId}`)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  cursor: "pointer",
                  color: "#2563eb",
                  fontWeight: 500,
                }}
              >
                ➕ Create Quiz
              </div>
            </div>
          )}
        </div>
      ))}

      <hr style={{ margin: "16px 0", borderColor: "#eee" }} />

      <button
        type="button"
        onClick={() => navigate("/dashboard?createClass=1")}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#fff",
          cursor: "pointer",
          marginBottom: 10,
        }}
      >
        ➕ Create Class
      </button>

      <button
        type="button"
        onClick={handleJoinClass}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#fff",
          cursor: "pointer",
          marginBottom: 10,
        }}
      >
        🔗 Join Class
      </button>

      <button
        type="button"
        onClick={() => { logout(); navigate("/login", { replace: true }); }}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#fff",
          cursor: "pointer",
          marginTop: "auto",
        }}
      >
        Logout
      </button>
    </aside>
  );
}
