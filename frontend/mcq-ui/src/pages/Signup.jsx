import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/http";
import { useUIText } from "../context/UITextContext";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Field from "../components/ui/Field";
import InlineAlert from "../components/ui/InlineAlert";
import PageShell from "../components/ui/PageShell";
import SectionHeader from "../components/ui/SectionHeader";
import StatusPill from "../components/ui/StatusPill";

export default function Signup() {
  const navigate = useNavigate();
  const { loadCategoryKeys, t, msg } = useUIText();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userType, setUserType] = useState("Student");
  const [generalDisclaimer, setGeneralDisclaimer] = useState(null);
  const [generalDisclaimerAccepted, setGeneralDisclaimerAccepted] = useState(false);
  const [signupPlanSummary, setSignupPlanSummary] = useState("Create your account");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "signup.title",
      "signup.subtitle",
      "signup.fullName.placeholder",
      "signup.identifier.teacher.placeholder",
      "signup.studentCode.placeholder",
      "signup.identifier.student.placeholder",
      "signup.password.placeholder",
      "signup.confirmPassword.placeholder",
      "signup.userType.student",
      "signup.userType.teacher",
      "signup.submit",
      "signup.submitting",
      "signup.back.button",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "signup.passwordMismatch",
      "signup.success",
      "signup.failed",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    let cancelled = false;
    async function loadSignupDisclaimer() {
      try {
        const data = await apiGet("/api/auth/signup-disclaimer");
        if (cancelled) return;
        setGeneralDisclaimer(data?.general || null);
      } catch {
        if (cancelled) return;
        setGeneralDisclaimer(null);
      }
    }
    loadSignupDisclaimer();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSignupPlanSummary() {
      try {
        const role = userType === "Teacher" ? "Teacher" : "Student";
        const data = await apiGet(`/api/billing/plans?role=${encodeURIComponent(role)}`);
        if (cancelled) return;
        const plans = Array.isArray(data?.plans) ? data.plans : [];
        const freePlan = plans.find((plan) => {
          const code = String(plan?.code || "").toUpperCase();
          return role === "Teacher" ? code === "FREE_TRIAL" : code === "FREE_STUDENT";
        }) || null;

        if (!freePlan) {
          setSignupPlanSummary("Create your account");
          return;
        }

        const aiLimit = Number(freePlan.aiQuizLimit || 0);
        const manualLimit = Number(freePlan.manualQuizLimit || 0);
        if (role === "Teacher") {
          setSignupPlanSummary(`Create your account (Free trial: ${aiLimit} AI questions, ${manualLimit} manual quizzes)`);
        } else {
          setSignupPlanSummary(`Create your account (Free trial: ${aiLimit} AI practice questions)`);
        }
      } catch {
        if (cancelled) return;
        setSignupPlanSummary("Create your account");
      }
    }
    loadSignupPlanSummary();
    return () => {
      cancelled = true;
    };
  }, [userType]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (password !== confirmPassword) {
      setError(msg("signup.passwordMismatch", "Password and confirm password do not match."));
      return;
    }
    if (!generalDisclaimerAccepted) {
      setError("You must read and accept the signup terms to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        password,
        userType,
        disclaimerAcknowledged: true,
        disclaimerId: Number(generalDisclaimer?.DisclaimerId || 0) || undefined,
      };
      if (userType === "Teacher") {
        payload.fullName = fullName.trim();
        payload.email = email.trim();
      } else {
        payload.studentCode = studentCode.trim();
        payload.userName = userName.trim();
      }
      await apiPost("/api/auth/signup", payload);
      setSuccess(msg("signup.success", "Signup successful. Please login."));
      setTimeout(() => navigate("/login", { replace: true }), 800);
    } catch (err) {
      const detail = err?.payload?.detail;
      setError(detail ? `${err.message}: ${detail}` : (err.message || msg("signup.failed", "Signup failed")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      width="xl"
      style={{
        minHeight: "100vh",
        display: "grid",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "var(--space-6)",
          alignItems: "stretch",
        }}
      >
        <Card
          tone="accent"
          padding="lg"
          style={{
            display: "grid",
            alignContent: "space-between",
            minHeight: 620,
            background:
              "linear-gradient(160deg, rgba(234,243,255,0.98), rgba(255,255,255,0.94))",
          }}
        >
          <div>
            <StatusPill tone="accent" style={{ marginBottom: "var(--space-4)" }}>
              Guided Onboarding
            </StatusPill>
            <SectionHeader
              eyebrow={t("signup.title", "Free Sign Up")}
              title="Create your classroom account"
              description={signupPlanSummary}
              style={{ marginBottom: "var(--space-7)" }}
            />

            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              <Card tone="default" padding="md" style={{ background: "rgba(255,255,255,0.82)" }}>
                <div style={{ fontWeight: 800, marginBottom: "var(--space-2)", color: "var(--text-strong)" }}>
                  Student accounts
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Join using your assigned student code and choose a username you can remember.
                </div>
              </Card>
              <Card tone="default" padding="md" style={{ background: "rgba(255,255,255,0.82)" }}>
                <div style={{ fontWeight: 800, marginBottom: "var(--space-2)", color: "var(--text-strong)" }}>
                  Teacher accounts
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Sign up with your full name and email, then return to the dashboard to set up classes and quizzes.
                </div>
              </Card>
              <Card tone="default" padding="md" style={{ background: "rgba(255,255,255,0.82)" }}>
                <div style={{ fontWeight: 800, marginBottom: "var(--space-2)", color: "var(--text-strong)" }}>
                  Before you continue
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Review the general terms below. You must accept them before your account can be created.
                </div>
              </Card>
            </div>
          </div>

          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <StatusPill tone="neutral">Free Trial</StatusPill>
            <StatusPill tone="neutral">Assigned Quizzes</StatusPill>
            <StatusPill tone="neutral">AI Practice</StatusPill>
          </div>
        </Card>

        <Card
          padding="lg"
          style={{
            maxWidth: 640,
            width: "100%",
            justifySelf: "center",
          }}
        >
          <SectionHeader
            eyebrow="Account Setup"
            title={t("signup.title", "Free Sign Up")}
            description="Choose your account type, enter your details, and accept the general terms to continue."
            style={{ marginBottom: "var(--space-5)" }}
          />

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--space-4)" }}>
            <Field
              label="Account type"
              hint="Switching the account type updates the fields required to create your profile."
            >
              <select
                value={userType}
                onChange={(e) => setUserType(e.target.value)}
                style={{ width: "100%", padding: "12px 14px" }}
              >
                <option value="Student">{t("signup.userType.student", "Student")}</option>
                <option value="Teacher">{t("signup.userType.teacher", "Teacher")}</option>
              </select>
            </Field>

            {userType === "Teacher" ? (
              <>
                <Field label="Full name">
                  <input
                    placeholder={t("signup.fullName.placeholder", "Full name")}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    style={{ width: "100%", padding: "12px 14px" }}
                  />
                </Field>
                <Field label="Email or username" hint="Use the identifier you expect to sign in with.">
                  <input
                    placeholder={t("signup.identifier.teacher.placeholder", "UserName / Email")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{ width: "100%", padding: "12px 14px" }}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Student code">
                  <input
                    placeholder={t("signup.studentCode.placeholder", "Student code")}
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    required
                    style={{ width: "100%", padding: "12px 14px" }}
                  />
                </Field>
                <Field label="Username">
                  <input
                    placeholder={t("signup.identifier.student.placeholder", "UserName")}
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    required
                    style={{ width: "100%", padding: "12px 14px" }}
                  />
                </Field>
              </>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "var(--space-4)",
              }}
            >
              <Field label="Password" hint="Use at least 6 characters.">
                <input
                  placeholder={t("signup.password.placeholder", "Password")}
                  type="password"
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ width: "100%", padding: "12px 14px" }}
                />
              </Field>
              <Field label="Confirm password">
                <input
                  placeholder={t("signup.confirmPassword.placeholder", "Confirm password")}
                  type="password"
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  style={{ width: "100%", padding: "12px 14px" }}
                />
              </Field>
            </div>

            <Card tone="subtle" padding="md">
              <div style={{ fontWeight: 800, marginBottom: "var(--space-3)", color: "var(--text-strong)" }}>
                {generalDisclaimer?.Title || "General Terms and Disclaimer"}
              </div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  lineHeight: 1.6,
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  marginBottom: "var(--space-4)",
                  maxHeight: 220,
                  overflowY: "auto",
                  paddingRight: "var(--space-2)",
                }}
              >
                {generalDisclaimer?.DisclaimerText || "Loading signup terms..."}
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>
                <input
                  type="checkbox"
                  checked={generalDisclaimerAccepted}
                  onChange={(e) => setGeneralDisclaimerAccepted(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>I have read and accept the general terms and disclaimer.</span>
              </label>
            </Card>

            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            {success ? <InlineAlert tone="success">{success}</InlineAlert> : null}

            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                size="lg"
                style={{ width: "100%" }}
              >
                {submitting ? t("signup.submitting", "Creating...") : t("signup.submit", "Create Free Account")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => navigate("/login")}
                style={{ width: "100%" }}
              >
                {t("signup.back.button", "Back to Login")}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </PageShell>
  );
}
