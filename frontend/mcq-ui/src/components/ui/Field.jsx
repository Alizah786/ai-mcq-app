export default function Field({ label, hint, error, htmlFor, children, style = {} }) {
  return (
    <label className="ui-field" htmlFor={htmlFor} style={style}>
      {label ? <span className="ui-field__label">{label}</span> : null}
      {children}
      {hint && !error ? <span className="ui-field__hint">{hint}</span> : null}
      {error ? <span className="ui-field__error">{error}</span> : null}
    </label>
  );
}
