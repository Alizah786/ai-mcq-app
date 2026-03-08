import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import StatusPill from "../components/ui/StatusPill";

export default function QuizActionPanel({
  showResults,
  isAssignment,
  isExporting,
  pdfBusy,
  pdfLockedForFreePlan,
  hintLockedForFreePlan,
  canSubmitQuiz,
  submittingAttempt,
  attemptsRemaining,
  showHints,
  showPostExplanations,
  isManager,
  subscription,
  isAssignedStudent,
  result,
  onToggleHints,
  onExportPdf,
  onSubmitQuiz,
  onClearAnswers,
  onToggleExplanations,
  onStartNextAttempt,
  renderAttemptMarks,
  t,
  msg,
}) {
  if (isExporting) return null;

  if (!showResults) {
    if (isAssignment) {
      return (
        <Card
          style={{
            marginTop: 12,
            position: "sticky",
            bottom: 8,
            zIndex: 40,
            background: "rgba(255,255,255,0.94)",
            backdropFilter: "blur(10px)",
            padding: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button
              type="button"
              onClick={onExportPdf}
              disabled={pdfBusy}
              variant="secondary"
            >
              {pdfBusy ? "Generating PDF..." : "Download Assignment PDF"}
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <Card
        style={{
          position: "sticky",
          bottom: 8,
          zIndex: 40,
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(10px)",
          padding: 10,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="button"
            onClick={onToggleHints}
            variant="secondary"
            style={{
              background: hintLockedForFreePlan ? "#f3f4f6" : "#fff",
              color: hintLockedForFreePlan ? "#6b7280" : "#111827",
            }}
            title={hintLockedForFreePlan ? msg("quiz.paidFeatureOnly.error", "This feature is available in paid version.") : ""}
          >
            {showHints ? t("quiz.hideHint.button", "Hide Hint") : t("quiz.showHint.button", "Show Hint (3 steps)")}
          </Button>
          <Button
            type="button"
            onClick={onExportPdf}
            disabled={pdfBusy}
            variant="secondary"
            style={{
              background: pdfLockedForFreePlan ? "#f3f4f6" : "#fff",
              color: pdfLockedForFreePlan ? "#6b7280" : "#111827",
            }}
            title={pdfLockedForFreePlan ? msg("quiz.paidFeatureOnly.error", "This feature is available in paid version.") : ""}
          >
            {pdfBusy ? "Generating PDF..." : t("quiz.downloadPdf.button", "Download Quiz PDF")}
          </Button>
          <Button
            onClick={onSubmitQuiz}
            disabled={!canSubmitQuiz || submittingAttempt}
            variant="primary"
            style={{ background: canSubmitQuiz && !submittingAttempt ? undefined : "#9ca3af" }}
          >
            {submittingAttempt ? t("quiz.submitting.button", "Submitting...") : t("quiz.submit.button", "Submit Quiz")}
          </Button>
          {attemptsRemaining > 0 && (
            <Button
              type="button"
              onClick={onClearAnswers}
              variant="ghost"
            >
              {t("quiz.clear.button", "Clear")}
            </Button>
          )}
        </div>
        {renderAttemptMarks()}
      </Card>
    );
  }

  return (
    <Card
      style={{
        marginTop: 12,
        padding: 16,
      }}
    >
      <h3 style={{ marginTop: 0 }}>{t("quiz.result.title", "Result")}</h3>
      {!isManager && subscription && !isAssignedStudent && (
        <Card
          tone="subtle"
          padding="sm"
          style={{
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>Analytics Access</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", alignItems: "center", overflowX: "auto" }}>
            <StatusPill tone="accent">
              Plan: {subscription.planName || "Student"}
            </StatusPill>
            <StatusPill tone="success">
              Basic Analytics: Enabled
            </StatusPill>
            <StatusPill tone={subscription.advancedAnalyticsEnabled ? "success" : "warning"}>
              Advanced Analytics: {subscription.advancedAnalyticsEnabled ? "Enabled" : "Locked"}
            </StatusPill>
          </div>
        </Card>
      )}
      <div style={{ fontSize: 18 }}>
        Score: <b>{result.score}</b> / <b>{result.total}</b> (<b>{result.scorePercent}%</b>)
      </div>
      <div style={{ color: "var(--text-secondary)", marginTop: 6 }}>
        Green = correct answer | Red = your wrong selection
      </div>
      <Button
        type="button"
        onClick={onToggleExplanations}
        variant="secondary"
        style={{
          marginTop: 12,
          marginRight: 10,
        }}
      >
        {showPostExplanations ? t("quiz.hideExplanations.button", "Hide Explanations") : t("quiz.showExplanations.button", "Show Explanations")}
      </Button>
      <Button
        type="button"
        onClick={onExportPdf}
        disabled={pdfBusy}
        variant="secondary"
        style={{
          marginTop: 12,
          background: pdfLockedForFreePlan ? "#f3f4f6" : "#fff",
          color: pdfLockedForFreePlan ? "#6b7280" : "#111827",
        }}
        title={pdfLockedForFreePlan ? msg("quiz.paidFeatureOnly.error", "This feature is available in paid version.") : ""}
      >
        {pdfBusy ? "Generating PDF..." : t("quiz.downloadSolvedPdf.button", "Download Solved Quiz PDF")}
      </Button>
      {attemptsRemaining > 0 && (
        <Button
          type="button"
          onClick={onStartNextAttempt}
          variant="primary"
          style={{
            marginTop: 12,
            marginLeft: 10,
            background: "#16a34a",
            boxShadow: "0 10px 20px rgba(22,163,74,0.22)",
          }}
        >
          {t("quiz.startNextAttempt.button", "Start Next Attempt")}
        </Button>
      )}
      {renderAttemptMarks()}
    </Card>
  );
}
