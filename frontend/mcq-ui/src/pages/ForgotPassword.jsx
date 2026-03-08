import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiPost } from "../api/http";
import { useUIText } from "../context/UITextContext";

export default function ForgotPassword() {
  const { loadCategoryKeys, t, msg } = useUIText();
  const [userType, setUserType] = useState("STUDENT");
  const [userName, setUserName] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "forgotPassword.title",
      "forgotPassword.subtitle",
      "forgotPassword.userType.student",
      "forgotPassword.userType.teacher",
      "forgotPassword.userName.placeholder",
      "forgotPassword.recoveryEmail.placeholder",
      "forgotPassword.teacherId.placeholder",
      "forgotPassword.studentId.placeholder",
      "forgotPassword.submit",
      "forgotPassword.submitting",
      "forgotPassword.backLogin",
      "forgotPassword.forgotUsername",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "forgotPassword.sent",
      "forgotPassword.noRecoveryEmail",
      "forgotPassword.failed",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        userType,
        userName: userName.trim(),
        recoveryEmail: recoveryEmail.trim(),
      };
      if (String(userId || "").trim()) payload.userId = Number(userId);
      const res = await apiPost("/api/password/forgot", payload);
      setMessage(
        `${res?.message || msg("forgotPassword.sent", "If the account exists, we sent password reset instructions.")} ${msg("forgotPassword.noRecoveryEmail", "If recovery email is not set, please contact admin/teacher to reset.")}`
      );
    } catch (err) {
      setError(err.message || msg("forgotPassword.failed", "Unable to process request."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f8fc" }}>
      <div style={{ width: 430, background: "#fff", padding: 24, borderRadius: 14, border: "1px solid #e5e7eb" }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>{t("forgotPassword.title", "Forgot Password")}</h2>
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: 14 }}>
          {t("forgotPassword.subtitle", "If the account exists, we will send reset instructions.")}
        </p>
        <form onSubmit={onSubmit}>
          <select
            value={userType}
            onChange={(e) => setUserType(e.target.value)}
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
          >
            <option value="STUDENT">{t("forgotPassword.userType.student", "Student")}</option>
            <option value="TEACHER">{t("forgotPassword.userType.teacher", "Teacher")}</option>
          </select>
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder={t("forgotPassword.userName.placeholder", "User Name")}
            required
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          <input
            type="email"
            value={recoveryEmail}
            onChange={(e) => setRecoveryEmail(e.target.value)}
            placeholder={t("forgotPassword.recoveryEmail.placeholder", "Recovery email")}
            required
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={
              userType === "TEACHER"
                ? t("forgotPassword.teacherId.placeholder", "Teacher ID (optional)")
                : t("forgotPassword.studentId.placeholder", "Student ID (optional)")
            }
            style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          {message && <p style={{ color: "#16a34a", fontSize: 14 }}>{message}</p>}
          {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", cursor: submitting ? "wait" : "pointer" }}
          >
            {submitting ? t("forgotPassword.submitting", "Sending...") : t("forgotPassword.submit", "Send reset link")}
          </button>
        </form>
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 14 }}>
          <Link to="/login">{t("forgotPassword.backLogin", "Back to login")}</Link>
        </div>
        <div style={{ marginTop: 8, textAlign: "center", fontSize: 14 }}>
          <Link to="/recover-username">{t("forgotPassword.forgotUsername", "Forgot user name?")}</Link>
        </div>
      </div>
    </div>
  );
}
