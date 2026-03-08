import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiGet, apiPut } from "../api/http";
import { useAuth } from "../context/AuthContext";
import DateRangePicker from "../components/DateRangePicker";

function formatDateInput(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultRange() {
  const to = new Date();
  const toUtc = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const fromUtc = new Date(Date.UTC(toUtc.getUTCFullYear(), toUtc.getUTCMonth(), toUtc.getUTCDate() - 6));
  return { from: formatDateInput(fromUtc), to: formatDateInput(toUtc) };
}

function StatCard({ label, value, tone = "#142033" }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
      <div style={{ color: "#6b7280", fontSize: 12, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ color: tone, fontSize: 28, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [range, setRange] = useState(getDefaultRange);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [atRisk, setAtRisk] = useState([]);
  const [monthlyOverheadInput, setMonthlyOverheadInput] = useState("0");
  const [savingOverhead, setSavingOverhead] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const q = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
        const [summaryRes, pnlRes, riskRes] = await Promise.all([
          apiGet(`/api/admin/usage/summary?${q}`),
          apiGet(`/api/admin/pnl?${q}`),
          apiGet(`/api/admin/users/at-risk?${q}`),
        ]);
        if (!alive) return;
        setSummary(summaryRes || null);
        setPnl(pnlRes || null);
        setAtRisk(Array.isArray(riskRes?.users) ? riskRes.users : []);
        setMonthlyOverheadInput(String(Number(pnlRes?.monthlyOverheadUsd || 0).toFixed(2)));
      } catch (e) {
        if (!alive) return;
        setError(e.message || "Unable to load report");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  const topUsers = useMemo(() => (Array.isArray(summary?.topUsers) ? summary.topUsers.slice(0, 50) : []), [summary]);
  const totalsByEventType = useMemo(
    () => (Array.isArray(summary?.totalsByEventType) ? summary.totalsByEventType : []),
    [summary]
  );

  async function saveMonthlyOverhead() {
    try {
      setSavingOverhead(true);
      setError("");
      const normalized = Number(monthlyOverheadInput || 0);
      if (!Number.isFinite(normalized) || normalized < 0) {
        throw new Error("Monthly cloud and other costs must be zero or greater.");
      }
      await apiPut("/api/admin/pnl/settings", {
        monthlyOverheadUsd: normalized,
      });
      const q = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      const pnlRes = await apiGet(`/api/admin/pnl?${q}`);
      setPnl(pnlRes || null);
      setMonthlyOverheadInput(String(Number(pnlRes?.monthlyOverheadUsd || 0).toFixed(2)));
    } catch (e) {
      setError(e.message || "Unable to save monthly overhead.");
    } finally {
      setSavingOverhead(false);
    }
  }

  if (user?.role !== "AppAdmin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div style={{ maxWidth: 1360, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0 }}>Admin Analytics</h1>
          <div style={{ color: "#6b7280", marginTop: 6 }}>
            Selected date range: <b>{range.from}</b> to <b>{range.to}</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DateRangePicker from={range.from} to={range.to} onChange={setRange} disabled={loading} />
          <button
            type="button"
            onClick={() => navigate("/pricing")}
            style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 700 }}
          >
            Back
          </button>
        </div>
      </div>

      {error && <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 16 }}>{error}</div>}
      {loading && <div style={{ color: "#475569", marginBottom: 16 }}>Loading analytics...</div>}

      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#6b7280", fontSize: 12, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>
              Monthly Cloud And Other Costs
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={monthlyOverheadInput}
              onChange={(e) => setMonthlyOverheadInput(e.target.value)}
              disabled={loading || savingOverhead}
              style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", minWidth: 220 }}
            />
          </div>
          <button
            type="button"
            onClick={saveMonthlyOverhead}
            disabled={loading || savingOverhead}
            style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 700 }}
          >
            {savingOverhead ? "Saving..." : "Save Monthly Cost"}
          </button>
          <div style={{ color: "#64748b", fontSize: 14 }}>
            The selected date range uses a pro-rated share of this monthly amount.
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard label="Revenue" value={money(pnl?.revenueUsd)} tone="#166534" />
        <StatCard label="AI Cost" value={money(pnl?.aiCostUsd)} tone="#991b1b" />
        <StatCard label="Cloud + Other Costs" value={money(pnl?.monthlyOverheadUsd)} tone="#92400e" />
        <StatCard label="Net" value={money(pnl?.netUsd)} tone={Number(pnl?.netUsd || 0) >= 0 ? "#166534" : "#991b1b"} />
        <StatCard label="Active Paid Users" value={Number(pnl?.activePaidUsers || 0)} />
        <StatCard label="Potential Churn Loss" value={money(pnl?.potentialChurnLossUsd)} tone="#92400e" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr", gap: 20, alignItems: "start" }}>
        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Usage by Event Type</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {totalsByEventType.length ? totalsByEventType.map((row) => (
              <div key={row.eventType} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
                <span style={{ fontWeight: 700 }}>{row.eventType}</span>
                <span>{Number(row.totalQuantity || 0)}</span>
              </div>
            )) : <div style={{ color: "#64748b" }}>No usage events in this range.</div>}
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Top Users by AI Usage</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>User</th>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Type</th>
                  <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>AI Usage</th>
                  <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>% of Limit</th>
                </tr>
              </thead>
              <tbody>
                {topUsers.length ? topUsers.map((row) => (
                  <tr key={row.userNameRegistryId}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{row.userName}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{row.userType}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{Number(row.aiUsage || 0)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>
                      {row.usagePctOfLimit == null ? "-" : `${(Number(row.usagePctOfLimit || 0) * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} style={{ padding: 8, color: "#64748b" }}>No active users in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section style={{ marginTop: 20, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>At-Risk Paid Users</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>User</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Plan</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Churn</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Days Since Activity</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Revenue at Risk</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {atRisk.length ? atRisk.map((row) => (
                <tr key={row.userNameRegistryId}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{row.userName}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{row.planCode}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{(Number(row.churnProbability || 0) * 100).toFixed(0)}%</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{row.daysSinceLastActivity ?? "-"}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{money(row.proRatedRevenueUsd)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{row.reason}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} style={{ padding: 8, color: "#64748b" }}>No paid users at elevated churn risk in this range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
