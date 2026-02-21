export default function AdRail() {
  return (
    <aside
      style={{
        width: 300,
        minWidth: 300,
        padding: "20px 16px",
        borderLeft: "1px solid #e5e7eb",
        background: "#f8fafc",
        boxSizing: "border-box",
      }}
    >
      <div style={{ position: "sticky", top: 84 }}>
        <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700, letterSpacing: 0.5, marginBottom: 10 }}>
          SPONSORED
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            minHeight: 180,
          }}
        >
          <div style={{ color: "#0f172a", fontWeight: 700, marginBottom: 8 }}>Ad Slot 1</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>300 x 250 placeholder</div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            minHeight: 180,
          }}
        >
          <div style={{ color: "#0f172a", fontWeight: 700, marginBottom: 8 }}>Ad Slot 2</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>300 x 250 placeholder</div>
        </div>
      </div>
    </aside>
  );
}

