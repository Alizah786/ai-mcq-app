export default function StatusPill({ children, tone = "neutral", style = {}, ...props }) {
  return (
    <span className={`ui-status-pill ui-status-pill--${tone}`} style={style} {...props}>
      {children}
    </span>
  );
}
