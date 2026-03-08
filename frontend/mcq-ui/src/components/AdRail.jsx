export default function AdRail() {
  return (
    <aside
      style={{
        width: 360,
        minWidth: 360,
        padding: "20px 10px",
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
            padding: 0,
            overflow: "hidden",
            height: 520,
          }}
        >
          <img
            src="/aimquiz-promo.png"
            alt="AIMQuiz promotional ad"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              maxWidth: "none",
              objectFit: "cover",
              objectPosition: "center top",
            }}
          />
        </div>
      </div>
    </aside>
  );
}
