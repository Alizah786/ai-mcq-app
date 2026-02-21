import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api/http";

export default function Signup() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userType, setUserType] = useState("Student");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (password !== confirmPassword) {
      setError("Password and confirm password do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = { password, userType };
      if (userType === "Teacher") {
        payload.fullName = fullName.trim();
        payload.email = email.trim();
      } else {
        payload.studentCode = studentCode.trim();
        payload.userName = userName.trim();
      }
      await apiPost("/api/auth/signup", payload);
      setSuccess("Signup successful. Please login.");
      setTimeout(() => navigate("/login", { replace: true }), 800);
    } catch (err) {
      setError(err.message || "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f8fc" }}>
      <div style={{ width: 380, background: "#fff", padding: 24, borderRadius: 14, border: "1px solid #e5e7eb" }}>
        <h2 style={{ margin: 0, marginBottom: 6 }}>Free Sign Up</h2>
        <p style={{ marginTop: 0, color: "#6b7280" }}>Create your account (40 quiz free limit)</p>

        <form onSubmit={handleSubmit}>
          {userType === "Teacher" ? (
            <>
              <input
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <input
                placeholder="UserName / Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
            </>
          ) : (
            <>
              <input
                placeholder="Student code"
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value)}
                required
                style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <input
                placeholder="UserName"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                required
                style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
            </>
          )}
          <input
            placeholder="Password"
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
          />
          <input
            placeholder="Confirm password"
            type="password"
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
          </select>
          {error && <p style={{ color: "#dc2626", marginBottom: 10, fontSize: 14 }}>{error}</p>}
          {success && <p style={{ color: "#16a34a", marginBottom: 10, fontSize: 14 }}>{success}</p>}
          <button
            type="submit"
            disabled={submitting}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: "#2563eb", color: "white", cursor: submitting ? "wait" : "pointer" }}
          >
            {submitting ? "Creating..." : "Create Free Account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate("/login")}
          style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}
