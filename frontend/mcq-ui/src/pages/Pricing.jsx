import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/http";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function Card({ title, price, note, bullets, recommended = false, busy = false, onUpgrade }) {
  return (
    <div
      style={{
        background: "#1b2150",
        color: "#fff",
        border: recommended ? "2px solid #facc15" : "1px solid #2e386f",
        borderRadius: 18,
        padding: 24,
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ fontSize: 42, fontWeight: 800 }}>{price}</div>
      <div style={{ opacity: 0.9, marginBottom: 16 }}>{note}</div>
      <button
        type="button"
        disabled={busy}
        onClick={onUpgrade}
        style={{
          width: "100%",
          border: "none",
          borderRadius: 999,
          background: "#facc15",
          color: "#111827",
          fontWeight: 700,
          padding: "12px 16px",
          cursor: busy ? "wait" : "pointer",
          marginBottom: 14,
        }}
      >
        {busy ? "Redirecting..." : "Upgrade"}
      </button>
      {bullets.map((b) => (
        <div key={b} style={{ margin: "8px 0", opacity: 0.95 }}>
          ✓ {b}
        </div>
      ))}
    </div>
  );
}

export default function Pricing() {
  const navigate = useNavigate();
  const query = useQuery();
  const email = query.get("email") || "";
  const role = query.get("role") || "Student";
  const status = query.get("status") || "";
  const sessionId = query.get("session_id") || "";
  const [busyPlan, setBusyPlan] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    let alive = true;
    async function loadPlans() {
      try {
        const data = await apiGet("/api/billing/plans");
        if (!alive) return;
        setPlans(data.plans || []);
      } catch {
        if (!alive) return;
      }
    }
    loadPlans();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function confirmPayment() {
      if (!sessionId || status !== "success") return;
      try {
        setConfirming(true);
        setError("");
        const result = await apiPost("/api/billing/checkout/confirm", {
          sessionId,
          email: email || undefined,
          role: role || undefined,
        });
        if (!alive) return;
        setSuccess(result.message || "Payment confirmed.");
      } catch (e) {
        if (!alive) return;
        setError(e.message || "Failed to confirm payment.");
      } finally {
        if (alive) setConfirming(false);
      }
    }
    confirmPayment();
    return () => {
      alive = false;
    };
  }, [email, sessionId, status]);

  async function startCheckout(planCode) {
    try {
      setBusyPlan(planCode);
      setError("");
      setSuccess("");
      const hasToken = !!JSON.parse(localStorage.getItem("ai-mcq-auth") || "{}")?.token;
      const endpoint = hasToken ? "/api/billing/checkout-session" : "/api/billing/checkout-session/public";
      const payload = hasToken ? { planCode } : { planCode, email };
      if (!hasToken) payload.role = role;
      const r = await apiPost(endpoint, payload);
      if (r?.checkoutUrl) {
        window.location.href = r.checkoutUrl;
        return;
      }
      throw new Error("Checkout URL not returned.");
    } catch (e) {
      setError(e.message || "Failed to start checkout.");
    } finally {
      setBusyPlan("");
    }
  }

  function planConfigured(code) {
    return plans.find((p) => p.code === code)?.configured ?? true;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(1200px 500px at 0% -20%, #2a3cb2 0%, #0b1150 40%, #070b3a 100%)",
        color: "#fff",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 1150, margin: "0 auto" }}>
        <h1 style={{ textAlign: "center", marginTop: 0, fontSize: 52, lineHeight: 1.1 }}>
          Get better results with the number one learning platform
        </h1>
        <p style={{ textAlign: "center", opacity: 0.9 }}>
          {email ? `Account UserName/Email: ${email} (${role}) | ` : ""}Free plan limit reached (40 quizzes).
        </p>
        {status === "cancelled" && (
          <p style={{ textAlign: "center", color: "#fbbf24", fontWeight: 600 }}>Checkout was cancelled.</p>
        )}
        {confirming && (
          <p style={{ textAlign: "center", color: "#c7d2fe", fontWeight: 600 }}>Confirming payment...</p>
        )}
        {error && <p style={{ textAlign: "center", color: "#fecaca", fontWeight: 600 }}>{error}</p>}
        {success && <p style={{ textAlign: "center", color: "#86efac", fontWeight: 600 }}>{success}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 26 }}>
          <Card
            title="Quiz Plus"
            price="CA$3.75 / month"
            note="Billed at CA$44.99/year"
            bullets={["3 practice tests per month", "20 rounds of Learn questions", "Ad-free studying"]}
            busy={busyPlan === "plus"}
            onUpgrade={() => {
              if (!planConfigured("plus")) return setError("Plan not configured in backend yet.");
              startCheckout("plus");
            }}
          />
          <Card
            title="Quiz Plus Unlimited"
            price="CA$4.99 / month"
            note="Billed at CA$59.99/year"
            bullets={["Complete access to practice tests", "Millions of solutions", "Unlimited rounds"]}
            recommended
            busy={busyPlan === "unlimited"}
            onUpgrade={() => {
              if (!planConfigured("unlimited")) return setError("Plan not configured in backend yet.");
              startCheckout("unlimited");
            }}
          />
          <Card
            title="Quiz Family"
            price="CA$7.99 / month"
            note="Billed at CA$95.99/year"
            bullets={["Complete access", "Unlimited rounds", "Up to 5 accounts per plan"]}
            busy={busyPlan === "family"}
            onUpgrade={() => {
              if (!planConfigured("family")) return setError("Plan not configured in backend yet.");
              startCheckout("family");
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24, gap: 10 }}>
          <button
            type="button"
            onClick={() => navigate("/login")}
            style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #c7d2fe", background: "transparent", color: "#fff", cursor: "pointer" }}
          >
            Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}
