import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

export default function QuizQuestionAssistPanel({
  showResults,
  showThisExplanation,
  showThisHint,
  explanationText,
  hintLockedForFreePlan,
  isCardTextOpen,
  onToggle,
  t,
  msg,
}) {
  return (
    <Card tone="subtle" padding="sm" style={{ minHeight: 220 }}>
      <Button
        type="button"
        onClick={onToggle}
        variant="secondary"
        size="sm"
        style={{
          margin: "0 0 8px 0",
          background: isCardTextOpen ? "#e5e7eb" : "#fff",
          fontSize: 17,
        }}
        title={!showResults && hintLockedForFreePlan ? msg("quiz.paidFeatureOnly.error", "This feature is available in paid version.") : ""}
      >
        {showResults ? t("quiz.explanation.title", "Explanation") : "Hint"}
      </Button>
      {showResults ? (
        showThisExplanation ? (
          explanationText ? (
            <div style={{ color: "var(--text-primary)", whiteSpace: "pre-line", lineHeight: 1.6, fontSize: 14 }}>{explanationText}</div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{msg("quiz.noExplanation.label", "No explanation.")}</div>
          )
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Click "Explanation" title above or "Show Explanations" below to view full explanation.</div>
        )
      ) : showThisHint ? (
        explanationText ? (
          <div style={{ color: "var(--text-primary)", whiteSpace: "pre-line", lineHeight: 1.6, fontSize: 14 }}>{explanationText}</div>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{msg("quiz.noExplanation.label", "No explanation.")}</div>
        )
      ) : (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Click "Hint" title above or "Show Hint (3 steps)" below to view a short hint before test.</div>
      )}
    </Card>
  );
}
