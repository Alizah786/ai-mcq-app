export default function InlineAlert({ children, tone = "info", style = {}, ...props }) {
  return (
    <div className={`ui-inline-alert ui-inline-alert--${tone}`} style={style} {...props}>
      {children}
    </div>
  );
}
