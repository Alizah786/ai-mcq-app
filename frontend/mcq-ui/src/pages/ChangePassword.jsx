import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api/http";
import { useAuth } from "../context/AuthContext";
import { useUIText } from "../context/UITextContext";

export default function ChangePassword() {
  const navigate = useNavigate();
  const { user, token, setStored } = useAuth();
  const { loadCategoryKeys, t, msg } = useUIText();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "changePassword.title",
      "changePassword.currentPassword.placeholder",
      "changePassword.newPassword.placeholder",
      "changePassword.confirmPassword.placeholder",
      "changePassword.submit",
      "changePassword.submitting",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "changePassword.required",
      "changePassword.passwordMismatch",
      "changePassword.success",
      "changePassword.failed",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  async function onSubmit(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(msg("changePassword.passwordMismatch", "Passwords do not match."));
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiPost("/api/password/change", { currentPassword, newPassword });
      const updatedUser = { ...(user || {}), mustChangePassword: false };
      setStored(token, updatedUser);
      setSuccess(res?.message || msg("changePassword.success", "Password updated successfully."));
      setTimeout(() => navigate("/dashboard", { replace: true }), 700);
    } catch (err) {
      setError(err.message || msg("changePassword.failed", "Failed to change password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{t("changePassword.title", "Change Password")}</h2>
      {user?.mustChangePassword && (
        <p style={{ color: "#b45309", fontSize: 14 }}>
          {msg("changePassword.required", "Password update required before continuing.")}
        </p>
      )}
      <form onSubmit={onSubmit}>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder={t("changePassword.currentPassword.placeholder", "Current password")}
          required
          style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t("changePassword.newPassword.placeholder", "New password")}
          required
          style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t("changePassword.confirmPassword.placeholder", "Confirm new password")}
          required
          style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
        />
        {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
        {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", cursor: submitting ? "wait" : "pointer" }}
        >
          {submitting ? t("changePassword.submitting", "Saving...") : t("changePassword.submit", "Update Password")}
        </button>
      </form>
    </div>
  );
}
