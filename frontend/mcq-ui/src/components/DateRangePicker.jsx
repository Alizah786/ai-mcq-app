export default function DateRangePicker({ from, to, onChange, disabled = false }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "end",
        flexWrap: "wrap",
      }}
    >
      <label style={{ display: "grid", gap: 6, minWidth: 180 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>From</span>
        <input
          type="date"
          value={from}
          disabled={disabled}
          onChange={(e) => onChange({ from: e.target.value, to })}
          style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", background: "#fff" }}
        />
      </label>
      <label style={{ display: "grid", gap: 6, minWidth: 180 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>To</span>
        <input
          type="date"
          value={to}
          disabled={disabled}
          onChange={(e) => onChange({ from, to: e.target.value })}
          style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", background: "#fff" }}
        />
      </label>
    </div>
  );
}

