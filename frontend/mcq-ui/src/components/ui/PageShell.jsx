export default function PageShell({ children, width = "lg", padded = true, style = {}, ...props }) {
  const maxWidthBySize = {
    sm: 720,
    md: 960,
    lg: 1200,
    xl: 1440,
    full: "100%",
  };

  return (
    <div
      className="ui-page-shell"
      style={{
        maxWidth: maxWidthBySize[width] || maxWidthBySize.lg,
        padding: padded ? "var(--space-7) var(--space-5) var(--space-8)" : undefined,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
