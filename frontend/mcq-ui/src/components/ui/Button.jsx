export default function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  style = {},
  ...props
}) {
  return (
    <button
      className={`ui-button ui-button--${variant} ui-button--${size}${className ? ` ${className}` : ""}`}
      style={style}
      {...props}
    >
      {children}
    </button>
  );
}
