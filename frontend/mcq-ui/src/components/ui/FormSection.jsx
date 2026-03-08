import Card from "./Card";

export default function FormSection({ title, description, children, style = {}, contentStyle = {}, ...props }) {
  return (
    <Card style={{ ...style }} {...props}>
      {title ? <h3 style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>{title}</h3> : null}
      {description ? (
        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
          {description}
        </div>
      ) : null}
      <div style={contentStyle}>{children}</div>
    </Card>
  );
}
