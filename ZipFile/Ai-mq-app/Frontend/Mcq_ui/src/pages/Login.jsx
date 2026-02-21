import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiPost } from "../api/http";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const data = await apiPost("/api/auth/login", { email, password });
      login(data.token, data.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
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
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          {error && <p style={{ color: "#dc2626", marginBottom: 10, fontSize: 14 }}>{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: "#2563eb", color: "white", cursor: submitting ? "wait" : "pointer" }}
          >
            {submitting ? "Signing in…" : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
