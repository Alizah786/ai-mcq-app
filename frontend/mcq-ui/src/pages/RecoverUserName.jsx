import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiPost } from "../api/http";
import { useUIText } from "../context/UITextContext";

export default function RecoverUserName() {
  const { loadCategoryKeys, t, msg } = useUIText();
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recoveredUserNames, setRecoveredUserNames] = useState([]);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "recoverUsername.title",
      "recoverUsername.subtitle",
      "recoverUsername.recoveryEmail.placeholder",
      "recoverUsername.matches.title",
      "recoverUsername.submit",
      "recoverUsername.submitting",
      "recoverUsername.backForgotPassword",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "recoverUsername.sent",
      "recoverUsername.failed",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    setRecoveredUserNames([]);
    try {
      const res = await apiPost("/api/password/recover-username", {
        recoveryEmail: recoveryEmail.trim(),
      });
      setMessage(res?.message || msg("recoverUsername.sent", "If the account exists, we sent username recovery instructions."));
      setRecoveredUserNames(Array.isArray(res?.recoveredUserNames) ? res.recoveredUserNames : []);
    } catch (err) {
      setError(err.message || msg("recoverUsername.failed", "Unable to process request."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f8fc" }}>
      <div style={{ width: 430, background: "#fff", padding: 24, borderRadius: 14, border: "1px solid #e5e7eb" }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>{t("recoverUsername.title", "Recover User Name")}</h2>
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: 14 }}>
          {t("recoverUsername.subtitle", "Enter your recovery email to find your user name.")}
        </p>
        <form onSubmit={onSubmit}>
          <input
            type="email"
            value={recoveryEmail}
            onChange={(e) => setRecoveryEmail(e.target.value)}
            placeholder={t("recoverUsername.recoveryEmail.placeholder", "Recovery email")}
            required
            style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          {message && <p style={{ color: "#16a34a", fontSize: 14 }}>{message}</p>}
          {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
          {recoveredUserNames.length > 0 && (
            <div style={{ marginBottom: 12, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("recoverUsername.matches.title", "Matched User Name(s)")}</div>
              {recoveredUserNames.map((row, idx) => (
                <div key={`${row.userType}-${row.userName}-${idx}`} style={{ fontSize: 14, marginBottom: 4 }}>
                  {row.userName} ({row.userType})
                </div>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", cursor: submitting ? "wait" : "pointer" }}
          >
            {submitting ? t("recoverUsername.submitting", "Checking...") : t("recoverUsername.submit", "Recover user name")}
          </button>
        </form>
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 14 }}>
          <Link to="/forgot-password">{t("recoverUsername.backForgotPassword", "Back to forgot password")}</Link>
        </div>
      </div>
    </div>
  );
}
