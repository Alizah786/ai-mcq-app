import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/http";
import { useUIText } from "../context/UITextContext";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { loadCategoryKeys, t, msg } = useUIText();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const token = params.get("token") || "";
  const type = (params.get("type") || "STUDENT").toUpperCase();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "resetPassword.title",
      "resetPassword.accountType",
      "resetPassword.newPassword.placeholder",
      "resetPassword.confirmPassword.placeholder",
      "resetPassword.submit",
      "resetPassword.submitting",
      "resetPassword.backLogin",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "resetPassword.invalidToken",
      "resetPassword.passwordMismatch",
      "resetPassword.success",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!token) {
      setError(msg("resetPassword.invalidToken", "Invalid or expired token."));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(msg("resetPassword.passwordMismatch", "Passwords do not match."));
      return;
    }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const res = await apiPost("/api/password/reset", {
        userType: type,
        token,
        newPassword,
      });
      setMessage(res?.message || msg("resetPassword.success", "Password updated. Please login."));
      setTimeout(() => navigate("/login", { replace: true }), 900);
    } catch (err) {
      setError(err.message || msg("resetPassword.invalidToken", "Invalid or expired token."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f8fc" }}>
      <div style={{ width: 420, background: "#fff", padding: 24, borderRadius: 14, border: "1px solid #e5e7eb" }}>
        <h2 style={{ marginTop: 0 }}>{t("resetPassword.title", "Reset Password")}</h2>
        <p style={{ color: "#6b7280", marginTop: 0, fontSize: 14 }}>
          {t("resetPassword.accountType", "Account type")}: <b>{type}</b>
        </p>
        <form onSubmit={onSubmit}>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("resetPassword.newPassword.placeholder", "New password")}
            required
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("resetPassword.confirmPassword.placeholder", "Confirm password")}
            required
            style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          {message && <p style={{ color: "#16a34a", fontSize: 14 }}>{message}</p>}
          {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", cursor: submitting ? "wait" : "pointer" }}
          >
            {submitting ? t("resetPassword.submitting", "Resetting...") : t("resetPassword.submit", "Reset Password")}
          </button>
        </form>
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 14 }}>
          <Link to="/login">{t("resetPassword.backLogin", "Back to login")}</Link>
        </div>
      </div>
    </div>
  );
}
