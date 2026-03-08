export default function SectionHeader({ eyebrow, title, description, actions = null, style = {} }) {
  return (
    <div className="ui-section-header" style={style}>
      <div>
        {eyebrow ? <div className="ui-section-header__eyebrow">{eyebrow}</div> : null}
        {title ? <h2 className="ui-section-header__title">{title}</h2> : null}
        {description ? <div className="ui-section-header__description">{description}</div> : null}
      </div>
      {actions ? <div className="ui-section-header__actions">{actions}</div> : null}
    </div>
  );
}
