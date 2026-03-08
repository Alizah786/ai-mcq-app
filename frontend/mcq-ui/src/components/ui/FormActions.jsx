export default function FormActions({ children, align = "start", wrap = true, style = {}, ...props }) {
  const justifyContent =
    align === "end" ? "flex-end" : align === "between" ? "space-between" : "flex-start";

  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-3)",
        flexWrap: wrap ? "wrap" : "nowrap",
        alignItems: "center",
        justifyContent,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
