import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet } from "../api/http";
import { useUIText } from "../context/UITextContext";

export default function BillingSuccess() {
  const navigate = useNavigate();
  const { loadCategoryKeys, t, msg } = useUIText();
  const { search } = useLocation();
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const sessionId = query.get("session_id") || "";
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "billingSuccess.title",
      "billingSuccess.session",
      "billingSuccess.activePlan",
      "billingSuccess.backPricing",
      "billingSuccess.backDashboard",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "billingSuccess.processing",
      "billingSuccess.activated",
      "billingSuccess.stillProcessing",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    setStatus(msg("billingSuccess.processing", "Processing payment..."));
  }, [msg]);

  useEffect(() => {
    let alive = true;
    let ticks = 0;
    const maxTicks = 10;
    async function poll() {
      try {
        const res = await apiGet("/api/billing/my-plan");
        if (!alive) return;
        if (res?.plan?.isPaid) {
          setPlan(res.plan);
          setStatus(msg("billingSuccess.activated", "Payment received / plan activated."));
          return;
        }
        ticks += 1;
        if (ticks < maxTicks) {
          setTimeout(poll, 2000);
        } else {
          setStatus(msg("billingSuccess.stillProcessing", "Still processing. Please refresh in a moment."));
        }
      } catch {
        ticks += 1;
        if (ticks < maxTicks) setTimeout(poll, 2000);
      }
    }
    poll();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#f6f8fc", padding: 24 }}>
      <div style={{ maxWidth: 760, margin: "0 auto", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>{t("billingSuccess.title", "Billing Success")}</h2>
        <p style={{ color: "#374151" }}>{status}</p>
        {sessionId ? <p style={{ color: "#6b7280", fontSize: 13 }}>{t("billingSuccess.session", "Session")}: {sessionId}</p> : null}
        {plan ? (
          <div style={{ marginTop: 8, color: "#111827" }}>
            {t("billingSuccess.activePlan", "Active Plan")}: <b>{plan.planCode}</b>
          </div>
        ) : null}
        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => navigate("/pricing", { replace: true })}
            style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}
          >
            {t("billingSuccess.backPricing", "Back to Pricing")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/dashboard", { replace: true })}
            style={{ border: "none", background: "#2563eb", color: "#fff", borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}
          >
            {t("billingSuccess.backDashboard", "Go to Dashboard")}
          </button>
        </div>
      </div>
    </div>
  );
}
