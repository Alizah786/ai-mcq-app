import { useEffect, useState } from "react";
import { apiPost, apiPut } from "../api/http";
import { useAuth } from "../context/AuthContext";
import { useUIText } from "../context/UITextContext";
import { useLocale } from "../context/LocaleContext";
import { useTranslation } from "react-i18next";

export default function Profile() {
  const { user, token, setStored } = useAuth();
  const { t: ti18n } = useTranslation();
  const { localePreference, setLocalePreference } = useLocale();
  const { loadCategoryKeys, t, msg } = useUIText();
  const [recoveryEmail, setRecoveryEmail] = useState(user?.recoveryEmail || "");
  const [instructorNameLabel, setInstructorNameLabel] = useState(user?.instructorNameLabel || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const isTeacher = user?.role === "Teacher" || user?.role === "Manager";

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "profile.title",
      "profile.recoveryEmail.label",
      "profile.recoveryEmail.placeholder",
      "profile.instructorNameLabel.label",
      "profile.instructorNameLabel.placeholder",
      "profile.submit",
      "profile.submitting",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "profile.recoveryEmail.help",
      "profile.success",
      "profile.failed",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  async function saveRecoveryEmail(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiPost("/api/password/set-recovery-email", { recoveryEmail });
      let nextInstructorNameLabel = instructorNameLabel;
      if (isTeacher) {
        const profileRes = await apiPut("/api/auth/profile", { instructorNameLabel });
        nextInstructorNameLabel = profileRes?.instructorNameLabel || "";
      }
      const updatedUser = {
        ...(user || {}),
        recoveryEmail: res.recoveryEmail || recoveryEmail,
        instructorNameLabel: nextInstructorNameLabel,
      };
      setStored(token, updatedUser);
      setSuccess(msg("profile.success", "Recovery email updated."));
    } catch (err) {
      setError(err.message || msg("profile.failed", "Failed to update recovery email."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{t("profile.title", "Profile Settings")}</h2>
      <p style={{ color: "#6b7280", marginTop: 0, fontSize: 14 }}>
        {msg("profile.recoveryEmail.help", "Recovery Email is used only for password recovery (not required for login).")}
      </p>
      <form onSubmit={saveRecoveryEmail}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>{ti18n("profile.locale.label", "Language/Region")}</label>
        <select
          value={localePreference || "auto"}
          onChange={async (e) => {
            setError("");
            setSuccess("");
            try {
              await setLocalePreference(String(e.target.value || "auto"), true);
              setSuccess(ti18n("common.saved", "Saved."));
            } catch (err) {
              setError(err?.message || ti18n("errors.generic", "Something went wrong. Please try again."));
            }
          }}
          style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
        >
          <option value="auto">{ti18n("profile.locale.auto", "Auto")}</option>
          <option value="en-US">{ti18n("profile.locale.us", "United States (en-US)")}</option>
          <option value="en-CA">{ti18n("profile.locale.ca", "Canada (en-CA)")}</option>
          <option value="en-GB">{ti18n("profile.locale.gb", "United Kingdom (en-GB)")}</option>
          <option value="en-AU">{ti18n("profile.locale.au", "Australia (en-AU)")}</option>
        </select>
        {isTeacher && (
          <>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>{t("profile.instructorNameLabel.label", "Instructor Name Label")}</label>
            <input
              type="text"
              value={instructorNameLabel}
              onChange={(e) => setInstructorNameLabel(e.target.value.slice(0, 120))}
              placeholder={t("profile.instructorNameLabel.placeholder", "e.g. Prof. Khan")}
              style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
          </>
        )}
        <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>{t("profile.recoveryEmail.label", "Recovery Email")}</label>
        <input
          type="email"
          value={recoveryEmail}
          onChange={(e) => setRecoveryEmail(e.target.value)}
          placeholder={t("profile.recoveryEmail.placeholder", "name@example.com")}
          required
          style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
        />
        {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
        {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
        <button
          type="submit"
          disabled={saving}
          style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", cursor: saving ? "wait" : "pointer" }}
        >
          {saving ? t("profile.submitting", "Saving...") : t("profile.submit", "Save Profile")}
        </button>
      </form>
    </div>
  );
}
