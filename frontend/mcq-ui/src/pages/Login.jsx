import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiGet, apiPost } from "../api/http";
import { useUIText } from "../context/UITextContext";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Field from "../components/ui/Field";
import InlineAlert from "../components/ui/InlineAlert";
import PageShell from "../components/ui/PageShell";
import SectionHeader from "../components/ui/SectionHeader";
import StatusPill from "../components/ui/StatusPill";
import BrandLogo from "../components/BrandLogo";

export default function Login() {
  const navigate = useNavigate();
  const { login, setStored } = useAuth();
  const { loadCategoryKeys, t, msg } = useUIText();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState("Student");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolvingRole, setResolvingRole] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [requiresAdminCode, setRequiresAdminCode] = useState(false);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "login.title",
      "login.brand",
      "login.identifier.teacher.placeholder",
      "login.identifier.student.placeholder",
      "login.password.placeholder",
      "login.adminCode.placeholder",
      "login.userType.student",
      "login.userType.teacher",
      "login.userType.principal",
      "login.submit",
      "login.submitting",
      "login.signup.prompt",
      "login.signup.link",
      "login.forgotPassword.link",
      "login.forgotUsername.link",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "login.adminCode.required",
      "login.failed",
      "login.detectingRole",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  async function resolveRole(nextIdentifier) {
    const value = String(nextIdentifier || "").trim();
    if (!value) return;
    setResolvingRole(true);
    try {
      const result = await apiGet(`/api/auth/resolve-role?identifier=${encodeURIComponent(value)}`);
      if (result?.role === "Teacher" || result?.role === "Student" || result?.role === "Principal") {
        setUserType(result.role);
        setRequiresAdminCode(false);
      } else if (result?.role === "AppAdmin") {
        setRequiresAdminCode(true);
      }
    } catch {
      // Ignore auto-detect failures.
    } finally {
      setResolvingRole(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    let effectiveUserType = userType;
    let adminCodeToSend = undefined;
    try {
      const normalizedIdentifier = String(identifier || "").trim();
      if (normalizedIdentifier) {
        try {
          const resolved = await apiGet(`/api/auth/resolve-role?identifier=${encodeURIComponent(normalizedIdentifier)}`);
          if (resolved?.role === "Teacher" || resolved?.role === "Student" || resolved?.role === "Principal" || resolved?.role === "AppAdmin") {
            effectiveUserType = resolved.role;
            if (resolved.role !== "AppAdmin") setUserType(resolved.role);
            setRequiresAdminCode(resolved.role === "AppAdmin");
          }
        } catch {
          // Keep selected role if resolve-role is unavailable.
        }
      }

      if (effectiveUserType === "AppAdmin") {
        if (!String(adminCode || "").trim()) {
          setError(msg("login.adminCode.required", "Admin security code is required."));
          setSubmitting(false);
          return;
        }
        adminCodeToSend = String(adminCode || "").trim();
      }

      const data = await apiPost("/api/auth/login", { identifier, password, userType: effectiveUserType, adminCode: adminCodeToSend });
      login(data.token, data.user);
      if (data?.user?.role === "AppAdmin") {
        navigate("/pricing", { replace: true });
        return;
      }
      try {
        const me = await apiGet("/api/auth/me");
        const mergedUser = { ...(data.user || {}), ...(me || {}) };
        setStored(data.token, mergedUser);
        if (mergedUser?.role === "AppAdmin") {
          navigate("/pricing", { replace: true });
          return;
        }
        if (mergedUser?.mustChangePassword) {
          navigate("/change-password", { replace: true });
          return;
        }
      } catch {
        if (data?.user?.mustChangePassword) {
          navigate("/change-password", { replace: true });
          return;
        }
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err?.status === 402 || err?.payload?.paymentRequired) {
        const role = err?.payload?.role || effectiveUserType;
        navigate(`/pricing?email=${encodeURIComponent(identifier)}&role=${encodeURIComponent(role)}`, { replace: true });
        return;
      }
      setError(err.message || msg("login.failed", "Login failed"));
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
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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
            minHeight: 560,
            background:
              "linear-gradient(160deg, rgba(234,243,255,0.98), rgba(255,255,255,0.94))",
          }}
        >
          <div>
            <StatusPill tone="accent" style={{ marginBottom: "var(--space-4)" }}>
              Adaptive Assessment Workspace
            </StatusPill>
            <div style={{ marginBottom: "var(--space-5)" }}>
              <BrandLogo compact />
            </div>
            <SectionHeader
              eyebrow={t("login.brand", "AI MCQ Classroom")}
              title={t("login.title", "Sign in")}
              description="Run classroom quizzes, review assigned work, and manage learning progress from one workspace."
              style={{ marginBottom: "var(--space-7)" }}
            />

            <div
              style={{
                display: "grid",
                gap: "var(--space-4)",
              }}
            >
              <Card tone="default" padding="md" style={{ background: "rgba(255,255,255,0.82)" }}>
                <div style={{ fontWeight: 800, marginBottom: "var(--space-2)", color: "var(--text-strong)" }}>
                  Students
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Sign in with your username. Assigned quizzes remain available even if premium study tools are locked.
                </div>
              </Card>
              <Card tone="default" padding="md" style={{ background: "rgba(255,255,255,0.82)" }}>
                <div style={{ fontWeight: 800, marginBottom: "var(--space-2)", color: "var(--text-strong)" }}>
                  Teachers and principals
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Use your username or email. Your account role is verified automatically when you enter your identifier.
                </div>
              </Card>
              <Card tone="default" padding="md" style={{ background: "rgba(255,255,255,0.82)" }}>
                <div style={{ fontWeight: 800, marginBottom: "var(--space-2)", color: "var(--text-strong)" }}>
                  What happens next
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  If your password must be updated, you will be redirected immediately after sign-in. Billing-related access issues send you straight to plan selection.
                </div>
              </Card>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "var(--space-3)",
              flexWrap: "wrap",
              color: "var(--text-secondary)",
              fontSize: "var(--text-sm)",
            }}
          >
            <StatusPill tone="neutral">Quiz Delivery</StatusPill>
            <StatusPill tone="neutral">Classroom Analytics</StatusPill>
            <StatusPill tone="neutral">Assigned Practice</StatusPill>
          </div>
        </Card>

        <Card
          padding="lg"
          style={{
            alignSelf: "center",
            maxWidth: 480,
            width: "100%",
            justifySelf: "center",
          }}
        >
          <SectionHeader
            eyebrow="Account Access"
            title={t("login.title", "Sign in")}
            description="Enter your account details below. Role detection will update after you leave the identifier field."
            style={{ marginBottom: "var(--space-5)" }}
          />

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--space-4)" }}>
            <Field
              label="Username or email"
              hint={
                userType === "Teacher" || userType === "Principal"
                  ? "Teachers and principals can use username or email."
                  : "Students usually sign in with username."
              }
            >
              <input
                placeholder={
                  userType === "Teacher" || userType === "Principal"
                    ? t("login.identifier.teacher.placeholder", "UserName / Email")
                    : t("login.identifier.student.placeholder", "UserName")
                }
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onBlur={(e) => resolveRole(e.target.value)}
                required
                style={{ width: "100%", padding: "12px 14px" }}
              />
            </Field>

            <Field label="Password">
              <input
                placeholder={t("login.password.placeholder", "Password")}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: "100%", padding: "12px 14px" }}
              />
            </Field>

            {requiresAdminCode && (
              <Field
                label="Admin security code"
                hint="Required only for application administrator access."
              >
                <input
                  placeholder={t("login.adminCode.placeholder", "Admin security code")}
                  type="password"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  required
                  style={{ width: "100%", padding: "12px 14px" }}
                />
              </Field>
            )}

            <Field
              label="Expected access type"
              hint="This helps when role detection is unavailable. The server still verifies the final role."
            >
              <select
                value={userType}
                onChange={(e) => setUserType(e.target.value)}
                style={{ width: "100%", padding: "12px 14px" }}
              >
                <option value="Student">{t("login.userType.student", "Student")}</option>
                <option value="Teacher">{t("login.userType.teacher", "Teacher")}</option>
                <option value="Principal">{t("login.userType.principal", "Principal")}</option>
              </select>
            </Field>

            {resolvingRole ? (
              <InlineAlert tone="info">
                {msg("login.detectingRole", "Detecting account role...")}
              </InlineAlert>
            ) : null}

            {error ? (
              <InlineAlert tone="danger">
                {error}
              </InlineAlert>
            ) : null}

            <Button
              type="submit"
              disabled={submitting}
              variant="primary"
              size="lg"
              style={{ width: "100%", justifyContent: "center" }}
            >
              {submitting ? t("login.submitting", "Signing in...") : t("login.submit", "Login")}
            </Button>
          </form>

          <div
            style={{
              marginTop: "var(--space-5)",
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
              display: "grid",
              gap: "var(--space-3)",
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
            }}
          >
            <div>
              {t("login.signup.prompt", "New user?")}{" "}
              <Link to="/signup">{t("login.signup.link", "Create free account")}</Link>
            </div>
            <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
              <Link to="/forgot-password">{t("login.forgotPassword.link", "Forgot password?")}</Link>
              <Link to="/recover-username">{t("login.forgotUsername.link", "Forgot user name?")}</Link>
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
