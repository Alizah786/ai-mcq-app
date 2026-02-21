import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiGet, apiPost } from "../api/http";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState("Student");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolvingRole, setResolvingRole] = useState(false);

  async function resolveRole(nextIdentifier) {
    const value = String(nextIdentifier || "").trim();
    if (!value) return;
    setResolvingRole(true);
    try {
      const result = await apiGet(`/api/auth/resolve-role?identifier=${encodeURIComponent(value)}`);
      if (result?.role === "Teacher" || result?.role === "Student" || result?.role === "Principal") {
        setUserType(result.role);
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
    try {
      const data = await apiPost("/api/auth/login", { identifier, password, userType });
      login(data.token, data.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err?.status === 402 || err?.payload?.paymentRequired) {
        const role = err?.payload?.role || userType;
        navigate(`/pricing?email=${encodeURIComponent(identifier)}&role=${encodeURIComponent(role)}`, { replace: true });
        return;
      }
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f8fc" }}>
      <div style={{ width: 360, background: "#fff", padding: 24, borderRadius: 14, border: "1px solid #e5e7eb" }}>
        <h2 style={{ margin: 0, marginBottom: 6 }}>Sign in</h2>
        <p style={{ marginTop: 0, color: "#6b7280" }}>AI MCQ Classroom</p>

        <form onSubmit={handleSubmit}>
          <input
            placeholder={userType === "Teacher" || userType === "Principal" ? "UserName / Email" : "UserName"}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onBlur={(e) => resolveRole(e.target.value)}
            required
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: "100%", padding: 10, marginBottom: 14, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          <select
            value={userType}
            onChange={(e) => setUserType(e.target.value)}
            style={{ width: "100%", padding: 10, marginBottom: 14, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          >
            <option value="Student">Student</option>
            <option value="Teacher">Teacher</option>
            <option value="Principal">Principal</option>
          </select>
          {resolvingRole && <p style={{ color: "#6b7280", marginBottom: 10, fontSize: 13 }}>Detecting account role...</p>}
          {error && <p style={{ color: "#dc2626", marginBottom: 10, fontSize: 14 }}>{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: "#2563eb", color: "white", cursor: submitting ? "wait" : "pointer" }}
          >
            {submitting ? "Signing in…" : "Login"}
          </button>
        </form>
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 14 }}>
          New user? <Link to="/signup">Create free account</Link>
        </div>
      </div>
    </div>
  );
}
