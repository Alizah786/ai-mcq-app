export default function BrandLogo({ compact = false }) {
  const badgeSize = compact ? 48 : 66;
  const titleSize = compact ? 18 : 24;

  return (
    <div style={{ display: "flex", gap: compact ? 10 : 12, alignItems: "center" }}>
      <div
        style={{
          width: badgeSize,
          height: badgeSize,
          borderRadius: compact ? 14 : 18,
          background: "linear-gradient(145deg,#fdecc8,#f6dea7)",
          display: "grid",
          placeItems: "center",
          fontSize: compact ? 18 : 22,
          fontWeight: 800,
          color: "#ef8d3a",
          letterSpacing: 0.5,
          flexShrink: 0,
        }}
      >
        MCQ
      </div>
      <div style={{ color: "#26334d", fontWeight: 800, fontSize: titleSize, lineHeight: 1.05 }}>
        AI MCQ
        <br />
        Classroom
      </div>
    </div>
  );
}
