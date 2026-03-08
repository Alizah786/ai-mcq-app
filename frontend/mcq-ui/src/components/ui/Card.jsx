export default function Card({ children, tone = "default", padding = "md", style = {}, ...props }) {
  const toneStyles = {
    default: {
      background: "var(--surface-panel)",
      border: "1px solid var(--border-subtle)",
    },
    subtle: {
      background: "var(--surface-quiet)",
      border: "1px solid var(--border-subtle)",
    },
    accent: {
      background: "var(--surface-accent)",
      border: "1px solid #cfe0ff",
    },
  };

  const paddingBySize = {
    sm: "var(--space-4)",
    md: "var(--space-5)",
    lg: "var(--space-6)",
  };

  return (
    <div
      className="ui-card"
      style={{
        ...toneStyles[tone],
        padding: paddingBySize[padding] || paddingBySize.md,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
