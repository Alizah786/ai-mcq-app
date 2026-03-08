import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/http";

export default function MyResults() {
  const { isStudent, user } = useAuth();
  const [attempts, setAttempts] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const attemptRes = await apiGet("/api/attempts/mine");
        if (!alive) return;
        setAttempts(Array.isArray(attemptRes.attempts) ? attemptRes.attempts : []);
      } catch (e) {
        if (!alive) return;
        setError(e.message || "Failed to load results.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    async function loadSubscription() {
      try {
        const subRes = await apiGet("/api/billing/subscription-status");
        if (!alive) return;
        setSubscription(subRes.subscription || null);
      } catch {
        if (!alive) return;
        setSubscription(null);
      }
    }
    load();
    loadSubscription();
    return () => {
      alive = false;
    };
  }, [user?.userId]);

  async function openAttemptResult(attemptId) {
    try {
      setSelectedAttempt(attemptId);
      setSelectedResult(null);
      const data = await apiGet(`/api/attempts/${attemptId}/result`);
      setSelectedResult(data || null);
    } catch (e) {
      setError(e.message || "Failed to load attempt result.");
    }
  }

  if (!isStudent) {
    return <div style={{ color: "#6b7280" }}>My Results is available for student accounts only.</div>;
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>My Results</h2>
      {subscription && (
        <div style={{ maxWidth: 900, marginBottom: 14, padding: 12, border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "#e0f2fe", color: "#075985" }}>
              Plan: {subscription.planName || "Student"}
            </span>
            <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: "#ecfdf5", color: "#065f46" }}>
              Basic Analytics: Enabled
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: subscription.advancedAnalyticsEnabled ? "#dcfce7" : "#fee2e2",
                color: subscription.advancedAnalyticsEnabled ? "#166534" : "#991b1b",
              }}
            >
              Advanced Analytics: {subscription.advancedAnalyticsEnabled ? "Enabled" : "Locked"}
            </span>
          </div>
        </div>
      )}

      {loading && <div>Loading results...</div>}
      {error && <div style={{ color: "#dc2626", marginBottom: 10 }}>{error}</div>}
      {!loading && !error && !attempts.length && <div style={{ color: "#6b7280" }}>No submitted attempts yet.</div>}

      {!!attempts.length && (
        <div style={{ maxWidth: 1100, border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 250px 170px 120px 190px 220px 120px", background: "#f8fafc", padding: "10px 12px", fontWeight: 700, fontSize: 13 }}>
            <div>ID</div>
            <div>Quiz</div>
            <div>Class</div>
            <div>Score %</div>
            <div>Submitted</div>
            <div>Analytics Badge</div>
            <div>Action</div>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {attempts.map((a) => (
              <div key={a.attemptId} style={{ display: "grid", gridTemplateColumns: "80px 250px 170px 120px 190px 220px 120px", padding: "10px 12px", borderTop: "1px solid #f1f5f9", fontSize: 13, alignItems: "center" }}>
                <div>{a.attemptId}</div>
                <div style={{ fontWeight: 700 }}>{a.quizTitle}</div>
                <div>{a.className}</div>
                <div>{a.scorePercent}%</div>
                <div>{a.submittedAtUtc ? new Date(a.submittedAtUtc).toLocaleString() : "-"}</div>
                <div>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      background: subscription?.advancedAnalyticsEnabled ? "#dcfce7" : "#fee2e2",
                      color: subscription?.advancedAnalyticsEnabled ? "#166534" : "#991b1b",
                    }}
                  >
                    Advanced {subscription?.advancedAnalyticsEnabled ? "Enabled" : "Locked"}
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => openAttemptResult(a.attemptId)}
                    style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 700 }}
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedAttempt && selectedResult && (
        <div style={{ maxWidth: 900, marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Attempt #{selectedAttempt} Summary</h3>
            <button
              type="button"
              onClick={() => {
                setSelectedAttempt(null);
                setSelectedResult(null);
              }}
              style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
            >
              Close
            </button>
          </div>
          <p style={{ marginBottom: 8 }}>
            Score: <b>{selectedResult.score}</b> / <b>{selectedResult.total}</b> (<b>{selectedResult.scorePercent}%</b>)
          </p>
          {subscription?.advancedAnalyticsEnabled ? (
            <div style={{ color: "#374151", fontSize: 13 }}>
              Question-level breakdown available in full quiz review.
            </div>
          ) : (
            <div style={{ color: "#6b7280", fontSize: 13 }}>
              Advanced analytics is locked on your current plan.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
