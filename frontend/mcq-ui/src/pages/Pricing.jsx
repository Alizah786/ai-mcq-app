import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../api/http";
import { useAuth } from "../context/AuthContext";
import { useUIText } from "../context/UITextContext";
import { useLocale } from "../context/LocaleContext";
import { formatCurrency, getCurrencyForLocale } from "../i18n/format";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import InlineAlert from "../components/ui/InlineAlert";
import PageShell from "../components/ui/PageShell";
import SectionHeader from "../components/ui/SectionHeader";
import StatusPill from "../components/ui/StatusPill";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function PlanCard({
  title,
  priceValue,
  priceSuffix,
  bullets,
  buttonText,
  badge,
  busy,
  busyText,
  disabled,
  onClick,
  accent = "studentFree",
}) {
  const palette = {
    studentFree: {
      shell: "#f6f9ff",
      header: "#eef4ff",
      headerText: "#3557a5",
      button: "linear-gradient(135deg, #7db5ff 0%, #5e8ff2 100%)",
      badge: "linear-gradient(135deg, #7db5ff 0%, #5e8ff2 100%)",
    },
    studentBasic: {
      shell: "#f6f9ff",
      header: "linear-gradient(135deg, #b6d6ff 0%, #7eb1ff 100%)",
      headerText: "#ffffff",
      button: "linear-gradient(135deg, #5d9dff 0%, #3e79f3 100%)",
      badge: "linear-gradient(135deg, #7db5ff 0%, #5e8ff2 100%)",
    },
    studentPro: {
      shell: "#faf7ff",
      header: "linear-gradient(135deg, #dccfff 0%, #c0affc 100%)",
      headerText: "#45337a",
      button: "linear-gradient(135deg, #8f7cf8 0%, #7668ef 100%)",
      badge: "linear-gradient(135deg, #9d8cff 0%, #7a6af3 100%)",
    },
    teacherFree: {
      shell: "#fff9f6",
      header: "#fff1ea",
      headerText: "#d37b49",
      button: "linear-gradient(135deg, #ffb26f 0%, #ef8a4d 100%)",
      badge: "linear-gradient(135deg, #f7c14f 0%, #ef9d3f 100%)",
    },
    teacherBasic: {
      shell: "#fff9f6",
      header: "linear-gradient(135deg, #ffe1d0 0%, #ffc29b 100%)",
      headerText: "#d37b49",
      button: "linear-gradient(135deg, #ffb26f 0%, #ef8a4d 100%)",
      badge: "linear-gradient(135deg, #f7c14f 0%, #ef9d3f 100%)",
    },
    teacherPro: {
      shell: "#fff9f6",
      header: "linear-gradient(135deg, #ffe1d0 0%, #ffc29b 100%)",
      headerText: "#d37b49",
      button: "linear-gradient(135deg, #ffb26f 0%, #ef8a4d 100%)",
      badge: "linear-gradient(135deg, #f7c14f 0%, #ef9d3f 100%)",
    },
  };
  const theme = palette[accent] || palette.studentFree;
  return (
    <Card
      padding="sm"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 22,
        background: "#fff",
        padding: 0,
      }}
    >
      <div style={{ minHeight: 22, textAlign: "center", paddingTop: 10 }}>
        {badge ? (
          <div
            style={{
              display: "inline-block",
              padding: "8px 18px",
              borderRadius: 14,
              background: theme.badge,
              color: "#fff",
              fontWeight: 900,
              fontSize: 12,
              letterSpacing: "0.08em",
              boxShadow: "0 8px 18px rgba(59,130,246,0.25)",
            }}
          >
            {badge}
          </div>
        ) : null}
      </div>
      <div style={{ background: theme.header, padding: "18px 28px 20px" }}>
        <h3 style={{ margin: 0, fontSize: 29, fontWeight: 700, color: theme.headerText }}>{title}</h3>
      </div>
      <div style={{ padding: "24px 28px 28px", background: theme.shell }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 18, color: "#1f2937" }}>
          <span style={{ fontSize: 34, fontWeight: 800 }}>{priceValue}</span>
          <span style={{ fontSize: 22, color: "#4b5563" }}>{priceSuffix}</span>
        </div>
        <div style={{ height: 1, background: "#eceff5", marginBottom: 22 }} />
        <div style={{ minHeight: 270 }}>
          {bullets.map((b, index) => (
            <div key={`${title}-${index}-${b}`} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 17, color: "#374151", fontSize: 18 }}>
              <span style={{ color: "#7bc7b8", fontWeight: 900, lineHeight: 1 }}>✓</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
        <Button
          type="button"
          onClick={onClick}
          disabled={disabled || busy}
          variant="primary"
          size="lg"
          style={{
            width: "100%",
            marginTop: 8,
            borderRadius: 14,
            background: disabled ? "#b8c0cc" : theme.button,
            color: "#fff",
            fontSize: 18,
            boxShadow: disabled ? "none" : "0 10px 20px rgba(59,130,246,0.18)",
          }}
        >
          {busy ? busyText : buttonText}
        </Button>
      </div>
    </Card>
  );
}

function formatPlanPriceParts(price, locale) {
  const n = Number(price || 0);
  const currency = getCurrencyForLocale(locale);
  if (!Number.isFinite(n) || n <= 0) return { value: formatCurrency(0, currency, locale), suffix: "/month" };
  return { value: formatCurrency(n, currency, locale), suffix: "/month" };
}

function toPlanDraft(plan) {
  const features = Array.from({ length: 7 }, (_, index) => String(plan?.features?.[index] || ""));
  return {
    planName: plan?.planName || "",
    price: Number(plan?.price || 0),
    durationDays: Number(plan?.durationDays || 30),
    aiQuizLimit: Number(plan?.aiQuizLimit || 0),
    manualQuizLimit: Number(plan?.manualQuizLimit || 0),
    documentUploadLimit: Number(plan?.documentUploadLimit || 0),
    perQuizDocumentLimit: Number(plan?.perQuizDocumentLimit || 1),
    maxMcqsPerQuiz: Number(plan?.maxMcqsPerQuiz || 10),
    flashcardOtherGenerateLimit: Number(plan?.flashcardOtherGenerateLimit || 0),
    planFeatures: features,
    isActive: !!plan?.isActive,
    lockHintForFreePlan: !!plan?.lockHintForFreePlan,
    lockPdfForFreePlan: !!plan?.lockPdfForFreePlan,
  };
}

function resolvePlanBullets(plan, fallbackBullets) {
  const saved = Array.isArray(plan?.features)
    ? plan.features.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return saved.length ? saved : fallbackBullets;
}

function getAdminFeatureGridPlanLabel(plan, draft) {
  const planName = String(draft?.planName || plan?.planName || "").trim();
  const planCode = String(plan?.code || "").toUpperCase();
  if (planCode === "FREE_TRIAL" && planName.toLowerCase() === "free trial") {
    return "Teacher Free Trial";
  }
  return planName;
}

function getPlanMarketingTitle(plan, audience) {
  const code = String(plan?.code || "").toUpperCase();
  if (code === "FREE_TRIAL" || code === "FREE_STUDENT") return "Free";
  if (code === "BASIC_TEACHER" || code === "STUDENT_BASIC") return "Basic";
  if (code === "PRO_TEACHER" || code === "STUDENT_PRO") return "Pro";
  if (audience === "Student" && String(plan?.planName || "").toLowerCase().includes("student")) {
    return String(plan.planName).replace(/^student\s+/i, "");
  }
  if (audience === "Teacher" && String(plan?.planName || "").toLowerCase().includes("teacher")) {
    return String(plan.planName).replace(/\s+teacher\s+plan$/i, "");
  }
  return String(plan?.planName || "");
}

function getPlanAccent(plan, audience) {
  const code = String(plan?.code || "").toUpperCase();
  if (audience === "Student") {
    if (code === "STUDENT_BASIC") return "studentBasic";
    if (code === "STUDENT_PRO") return "studentPro";
    return "studentFree";
  }
  if (code === "BASIC_TEACHER") return "teacherBasic";
  if (code === "PRO_TEACHER") return "teacherPro";
  return "teacherFree";
}

export default function Pricing() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = useQuery();
  const { user } = useAuth();
  const { effectiveLocale } = useLocale();
  const { loadCategoryKeys, t } = useUIText();
  const isAppAdmin = user?.role === "AppAdmin";
  const userRole = user?.role === "Student" ? "Student" : "Teacher";
  const canAdminPlans = isAppAdmin;
  const messageParam = query.get("message") || "";
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [myPlan, setMyPlan] = useState(null);
  const [busyPlanId, setBusyPlanId] = useState(null);
  const [error, setError] = useState(isAppAdmin ? "" : messageParam);
  const [success, setSuccess] = useState("");
  const [planDrafts, setPlanDrafts] = useState({});
  const [savingPlans, setSavingPlans] = useState(false);
  const [savingFeatures, setSavingFeatures] = useState(false);
  const requestedAudience = String(query.get("audience") || "").trim().toLowerCase();
  const [viewRole, setViewRole] = useState(
    requestedAudience === "teachers" || requestedAudience === "teacher"
      ? "Teacher"
      : requestedAudience === "students" || requestedAudience === "student"
        ? "Student"
        : userRole
  );

  useEffect(() => {
    const nextRole =
      requestedAudience === "teachers" || requestedAudience === "teacher"
        ? "Teacher"
        : requestedAudience === "students" || requestedAudience === "student"
          ? "Student"
          : userRole;
    setViewRole((prev) => (prev === nextRole ? prev : nextRole));
  }, [requestedAudience, userRole]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const desiredAudience = viewRole === "Teacher" ? "teachers" : "students";
    if (params.get("audience") === desiredAudience) return;
    params.set("audience", desiredAudience);
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate, viewRole]);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "pricing.page.title",
      "pricing.page.subtitle",
      "pricing.back.button",
      "pricing.admin.title",
      "pricing.admin.subtitle",
      "pricing.audience.students",
      "pricing.audience.teachers",
      "pricing.currentPlan.label",
      "pricing.aiUsed.label",
      "pricing.manualUsed.label",
      "pricing.viewOnly.button",
      "pricing.processing.button",
      "pricing.currentPlan.button",
      "pricing.upgrade.button",
      "pricing.downgrade.button",
      "pricing.mostPopular.badge",
      "pricing.plan.studentFree",
      "pricing.plan.freeTrial",
      "pricing.plan.studentBasic",
      "pricing.plan.basicTeacher",
      "pricing.plan.studentPro",
      "pricing.plan.proTeacher",
      "pricing.admin.table.planName",
      "pricing.admin.table.price",
      "pricing.admin.table.durationDays",
      "pricing.admin.table.aiLimit",
      "pricing.admin.table.manualLimit",
      "pricing.admin.table.documentLimit",
      "pricing.admin.table.perQuizDocLimit",
      "pricing.admin.table.maxMcq",
      "pricing.admin.table.flashcardOtherLimit",
      "pricing.admin.table.statusLocks",
      "pricing.admin.active",
      "pricing.admin.disableHint",
      "pricing.admin.disablePdf",
      "pricing.admin.save.button",
      "pricing.admin.saving.button",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "pricing.load.error",
      "pricing.plan.targetCodeMissing",
      "pricing.plan.changeRequested",
      "pricing.plan.changeProcessed",
      "pricing.plan.upgradeFailed",
      "pricing.plan.updated",
      "pricing.plan.updateFailed",
      "pricing.viewOnly.teacher",
      "pricing.viewOnly.student",
      "pricing.student.subtitle",
      "pricing.teacher.subtitle",
      "pricing.student.free.aiPractice",
      "pricing.student.free.assignedQuiz",
      "pricing.student.free.analytics",
      "pricing.student.basic.aiPractice",
      "pricing.student.basic.analytics",
      "pricing.student.pro.aiPractice",
      "pricing.student.pro.analytics",
      "pricing.teacher.basic.aiQuestions",
      "pricing.teacher.basic.manualQuestions",
      "pricing.teacher.pro.aiQuestions",
      "pricing.teacher.pro.manualQuestions",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const plansPromise = isAppAdmin
          ? apiGet("/api/billing/plans?includeAll=1")
          : apiGet(`/api/billing/plans?role=${encodeURIComponent(viewRole)}`);
        const subPromise = isAppAdmin ? Promise.resolve({ subscription: null }) : apiGet("/api/billing/subscription-status");
        const myPlanPromise = isAppAdmin ? Promise.resolve({ plan: null }) : apiGet("/api/billing/my-plan");
        const [plansRes, subRes, myPlanRes] = await Promise.all([plansPromise, subPromise, myPlanPromise]);
        if (!alive) return;
        const fetchedPlans = Array.isArray(plansRes.plans) ? plansRes.plans : [];
        setPlans(fetchedPlans);
        setPlanDrafts(
          fetchedPlans.reduce((acc, p) => {
            acc[p.planId] = toPlanDraft(p);
            return acc;
          }, {})
        );
        setSubscription(subRes.subscription || null);
        setMyPlan(myPlanRes.plan || null);
      } catch (e) {
        if (!alive) return;
        setError(e.message || t("pricing.load.error", "Failed to load plans."));
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [viewRole, isAppAdmin]);

  async function upgradeNow(planId) {
    try {
      setBusyPlanId(planId);
      setError("");
      setSuccess("");
      const targetPlan = plans.find((p) => p.planId === planId);
      if (!targetPlan?.code) throw new Error(t("pricing.plan.targetCodeMissing", "Target plan code not found."));
      const res = await apiPost("/api/billing/change-plan", { planCode: targetPlan.code });
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      if (res.status === "scheduled" || res.status === "pending") {
        setSuccess(res.message || t("pricing.plan.changeRequested", "Plan change requested."));
      } else {
        setSuccess(t("pricing.plan.changeProcessed", "Plan change processed."));
      }
      const latest = await apiGet("/api/billing/my-plan");
      setMyPlan(latest.plan || null);
    } catch (e) {
      setError(e.message || t("pricing.plan.upgradeFailed", "Failed to upgrade plan."));
    } finally {
      setBusyPlanId(null);
    }
  }

  function updatePlanDraft(planId, key, value) {
    setPlanDrafts((prev) => ({
      ...prev,
      [planId]: {
        ...(prev[planId] || {}),
        [key]: value,
      },
    }));
  }

  async function savePlanConfigs() {
    try {
      setSavingPlans(true);
      setError("");
      setSuccess("");
      await apiPut("/api/billing/admin/plans", {
        plans: plans.map((plan) => {
          const draft = planDrafts[plan.planId] || {};
          return {
            planId: plan.planId,
            planName: String(draft.planName || "").trim(),
            price: Number(draft.price || 0),
            durationDays: Number(draft.durationDays || 30),
            aiQuizLimit: Number(draft.aiQuizLimit || 0),
            manualQuizLimit: Number(draft.manualQuizLimit || 0),
            documentUploadLimit: Math.max(0, Math.min(1000, Number(draft.documentUploadLimit || 0))),
            perQuizDocumentLimit: Math.max(1, Math.min(5, Number(draft.perQuizDocumentLimit || 1))),
            maxMcqsPerQuiz: Number(draft.maxMcqsPerQuiz || 10),
            flashcardOtherGenerateLimit: Math.max(0, Math.min(1000, Number(draft.flashcardOtherGenerateLimit || 0))),
            isActive: !!draft.isActive,
            lockHintForFreePlan: !!draft.lockHintForFreePlan,
            lockPdfForFreePlan: !!draft.lockPdfForFreePlan,
          };
        }),
      });
      const refreshed = await apiGet(
        isAppAdmin ? "/api/billing/plans?includeAll=1" : `/api/billing/plans?role=${encodeURIComponent(viewRole)}`
      );
      const refreshedPlans = Array.isArray(refreshed.plans) ? refreshed.plans : [];
      setPlans(refreshedPlans);
      setPlanDrafts(
        refreshedPlans.reduce((acc, p) => {
          acc[p.planId] = toPlanDraft(p);
          return acc;
        }, {})
      );
      setSuccess(t("pricing.plan.updated", "Plan settings updated."));
    } catch (e) {
      setError(e.message || t("pricing.plan.updateFailed", "Failed to update plan."));
    } finally {
      setSavingPlans(false);
    }
  }

  async function savePlanFeatures() {
    try {
      setSavingFeatures(true);
      setError("");
      setSuccess("");
      await apiPut("/api/billing/admin/plan-features", {
        plans: plans.map((plan) => ({
          planId: plan.planId,
          planFeatures: Array.isArray(planDrafts[plan.planId]?.planFeatures)
            ? planDrafts[plan.planId].planFeatures.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 7)
            : [],
        })),
      });
      const refreshed = await apiGet("/api/billing/plans?includeAll=1");
      const refreshedPlans = Array.isArray(refreshed.plans) ? refreshed.plans : [];
      setPlans(refreshedPlans);
      setPlanDrafts(
        refreshedPlans.reduce((acc, p) => {
          acc[p.planId] = toPlanDraft(p);
          return acc;
        }, {})
      );
      setSuccess("Plan features updated.");
    } catch (e) {
      setError(e.message || "Failed to update plan features.");
    } finally {
      setSavingFeatures(false);
    }
  }

  const rolePlans = plans
    .filter((p) => viewRole === "Student"
      ? String(p.appliesToRole || "").toLowerCase() !== "teacher"
      : String(p.appliesToRole || "").toLowerCase() !== "student")
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

  function findPlanByCode(code) {
    return rolePlans.find((p) => String(p.code || "").toUpperCase() === code) || null;
  }

  const freePlan = viewRole === "Student"
    ? (findPlanByCode("FREE_STUDENT") || rolePlans.find((p) => Number(p.price || 0) <= 0) || null)
    : (findPlanByCode("FREE_TRIAL") || rolePlans.find((p) => Number(p.price || 0) <= 0) || null);
  const basicPlan = viewRole === "Student"
    ? (findPlanByCode("STUDENT_BASIC") || rolePlans.find((p) => Number(p.price || 0) > 0) || null)
    : (findPlanByCode("BASIC_TEACHER") || rolePlans.find((p) => Number(p.price || 0) > 0) || null);
  const proPlan = viewRole === "Student"
    ? (findPlanByCode("STUDENT_PRO") || rolePlans.filter((p) => Number(p.price || 0) > 0)[1] || null)
    : (findPlanByCode("PRO_TEACHER") || rolePlans.filter((p) => Number(p.price || 0) > 0)[1] || null);
  const currentPlanCode = String(myPlan?.planCode || "").toUpperCase();
  const isViewOnlyAudience = !isAppAdmin && viewRole !== userRole;

  function planRank(code) {
    if (!code) return 0;
    const c = String(code).toUpperCase();
    if (c === "FREE_TRIAL" || c === "FREE_STUDENT") return 0;
    if (c === "BASIC_TEACHER" || c === "STUDENT_BASIC") return 1;
    if (c === "PRO_TEACHER" || c === "STUDENT_PRO") return 2;
    return 0;
  }
  function buttonLabel(targetCode) {
    if (!targetCode) return t("pricing.upgrade.button", "Upgrade");
    const targetRank = planRank(targetCode);
    const currentRank = planRank(currentPlanCode);
    if (targetRank === currentRank) return t("pricing.currentPlan.button", "Current Plan");
    if (targetRank > currentRank) return t("pricing.upgrade.button", "Upgrade");
    return t("pricing.downgrade.button", "Downgrade");
  }
  function isCurrent(targetCode) {
    return String(targetCode || "").toUpperCase() === currentPlanCode;
  }

  return (
    <PageShell width={isAppAdmin ? "xl" : "lg"}>
      <SectionHeader
        eyebrow={isAppAdmin ? "Application Billing" : "Plan Selection"}
        title={t("pricing.page.title", "Upgrade Your Plan")}
        description={
          isAppAdmin
            ? t("pricing.page.subtitle", "Application plan configuration")
            : (viewRole === "Student"
              ? t("pricing.student.subtitle", "Student monetization plans")
              : t("pricing.teacher.subtitle", "Teacher monetization plans"))
        }
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate("/dashboard")}
            >
              {t("pricing.back.button", "Back to Dashboard")}
            </Button>
            {isAppAdmin && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/admin/analytics")}
              >
                Analytics
              </Button>
            )}
          </div>
        }
      />

      {!isAppAdmin && subscription ? (
        <Card tone="accent" padding="md" style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <StatusPill tone="accent">Current: {subscription.planName || "Plan"}</StatusPill>
            <StatusPill tone="neutral">AI used: {Number(subscription.aiUsageCount || 0)}</StatusPill>
            <StatusPill tone="neutral">Manual used: {Number(subscription.manualUsageCount || 0)}</StatusPill>
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
            Compare plans below and switch when you are ready. Access changes are applied after checkout or immediately when no payment step is needed.
          </div>
        </Card>
      ) : null}

      {!isAppAdmin && (
        <Card
          tone="subtle"
          padding="lg"
          style={{
            marginBottom: 18,
            borderRadius: 28,
            background: viewRole === "Student" ? "#eef4ff" : "#fff1ea",
            border: `1px solid ${viewRole === "Student" ? "#dbe8ff" : "#ffe1d0"}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
            <div style={{ display: "inline-flex", padding: 6, borderRadius: 16, background: "rgba(255,255,255,0.65)", border: "1px solid rgba(229,231,235,0.9)" }}>
              {["Student", "Teacher"].map((audience) => (
                <button
                  key={audience}
                  type="button"
                  onClick={() => setViewRole(audience)}
                  style={{
                    border: "none",
                    borderRadius: 12,
                    padding: "12px 28px",
                    background: viewRole === audience ? "#ffffff" : "transparent",
                    color: viewRole === audience ? (viewRole === "Student" ? "#3557a5" : "#c97a45") : "#7b8597",
                    fontWeight: 900,
                    fontSize: 18,
                    letterSpacing: "0.08em",
                    boxShadow: viewRole === audience ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
                  }}
                >
                  {audience === "Student"
                    ? t("pricing.audience.students", "Students").toUpperCase()
                    : t("pricing.audience.teachers", "Teachers").toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              background: "rgba(255,255,255,0.45)",
              border: "1px solid rgba(255,255,255,0.7)",
              borderRadius: 28,
              padding: 18,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              {[
                {
                  plan: freePlan,
                  fallbackName: viewRole === "Student" ? "Student Free Trial" : "Free Trial",
                  fallbackBullets:
                    viewRole === "Student"
                      ? [
                          t("pricing.student.free.aiPractice", `AI Practice: ${freePlan?.aiQuizLimit ?? 25} questions/month`),
                          t("pricing.student.free.assignedQuiz", "Assigned quizzes always available"),
                          t("pricing.student.free.analytics", "Advanced analytics during trial"),
                        ]
                      : [
                          t("pricing.teacher.basic.aiQuestions", `AI Questions: ${freePlan?.aiQuizLimit ?? 30}`),
                          t("pricing.teacher.basic.manualQuestions", `Manual MCQ's: ${freePlan?.manualQuizLimit ?? 30}`),
                        ],
                  badge: "",
                },
                {
                  plan: basicPlan,
                  fallbackName: viewRole === "Student" ? t("pricing.plan.studentBasic", "Student Basic") : t("pricing.plan.basicTeacher", "Basic Teacher Plan"),
                  fallbackBullets:
                    viewRole === "Student"
                      ? [
                          t("pricing.student.basic.aiPractice", `AI Practice: ${basicPlan?.aiQuizLimit ?? 50} questions/month`),
                          t("pricing.student.basic.analytics", "Basic analytics"),
                        ]
                      : [
                          t("pricing.teacher.basic.aiQuestions", `AI Questions: ${basicPlan?.aiQuizLimit ?? 250}`),
                          t("pricing.teacher.basic.manualQuestions", `Manual MCQ's: ${basicPlan?.manualQuizLimit ?? 250}`),
                        ],
                  badge: viewRole === "Student" ? t("pricing.mostPopular.badge", "MOST POPULAR") : "",
                },
                {
                  plan: proPlan,
                  fallbackName: viewRole === "Student" ? t("pricing.plan.studentPro", "Student Pro") : t("pricing.plan.proTeacher", "Pro Teacher Plan"),
                  fallbackBullets:
                    viewRole === "Student"
                      ? [
                          t("pricing.student.pro.aiPractice", `AI Practice: ${proPlan?.aiQuizLimit ?? 200} questions/month`),
                          t("pricing.student.pro.analytics", "Advanced analytics + saved history"),
                        ]
                      : [
                          t("pricing.teacher.pro.aiQuestions", `AI Questions: ${proPlan?.aiQuizLimit ?? 500}`),
                          t("pricing.teacher.pro.manualQuestions", `Manual MCQ's: ${proPlan?.manualQuizLimit ?? 500}`),
                        ],
                  badge: viewRole === "Teacher" ? t("pricing.mostPopular.badge", "MOST POPULAR") : "",
                },
              ].map(({ plan, fallbackName, fallbackBullets, badge }) => {
                const priceParts = formatPlanPriceParts(plan?.price, effectiveLocale);
                return (
                  <PlanCard
                    key={plan?.planId || fallbackName}
                    title={getPlanMarketingTitle(plan || { planName: fallbackName }, viewRole)}
                    priceValue={priceParts.value}
                    priceSuffix={priceParts.suffix}
                    bullets={resolvePlanBullets(plan, fallbackBullets)}
                    buttonText={isViewOnlyAudience ? t("pricing.viewOnly.button", "View Only") : buttonLabel(plan?.code)}
                    badge={badge}
                    busyText={t("pricing.processing.button", "Processing...")}
                    busy={busyPlanId === plan?.planId}
                    disabled={
                      isViewOnlyAudience ||
                      !plan?.isActive ||
                      isCurrent(plan?.code) ||
                      !plan?.planId
                    }
                    onClick={() => plan?.planId && upgradeNow(plan.planId)}
                    accent={getPlanAccent(plan, viewRole)}
                  />
                );
              })}
            </div>
          </div>
        </Card>
        )}
        {isViewOnlyAudience && (
          <InlineAlert tone="warning" style={{ marginBottom: 16 }}>
            {viewRole === "Teacher"
              ? t("pricing.viewOnly.teacher", "Viewing teacher plans only. Switch back to student plans to change your subscription or sign up as teacher for teacher plan.")
              : t("pricing.viewOnly.student", "Viewing student plans only. Switch back to teacher plans to change your subscription or sign up as student for student plan.")}
          </InlineAlert>
        )}
        {error ? <InlineAlert tone="danger" style={{ marginBottom: 16 }}>{error}</InlineAlert> : null}
        {success ? <InlineAlert tone="success" style={{ marginBottom: 16 }}>{success}</InlineAlert> : null}

        {canAdminPlans && (
          <Card style={{ marginTop: 24 }}>
            <h3 style={{ marginTop: 0 }}>{t("pricing.admin.title", "Admin Plan Configuration")}</h3>
            <p style={{ color: "#6b7280", marginTop: 0 }}>{t("pricing.admin.subtitle", "Update plan price, limits, duration, and active status.")}</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1280, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "170px" }} />
                  <col style={{ width: "82px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "95px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "125px" }} />
                  <col style={{ width: "135px" }} />
                  <col style={{ width: "210px" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.planName", "Plan Name")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.price", "Price")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.durationDays", "Duration Days")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.aiLimit", "Number of AI question limit")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.manualLimit", "Manual Limit")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.documentLimit", "Document Upload Limit (Max 1000)")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.perQuizDocLimit", "Per Quiz Doc Limit (Max 5)")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.maxMcq", "Max MCQ in Single Quiz")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.flashcardOtherLimit", "FlashCard-Other Generate Max")}</th>
                    <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8 }}>{t("pricing.admin.table.statusLocks", "Status / Free Plan Locks")}</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => {
                    const d = planDrafts[p.planId] || {};
                    const isFreePlan = Number(d.price || 0) <= 0 || /free\s*trial/i.test(String(d.planName || ""));
                    return (
                      <tr key={p.planId}>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            value={d.planName ?? ""}
                            onChange={(e) => updatePlanDraft(p.planId, "planName", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={d.price ?? 0}
                            onChange={(e) => updatePlanDraft(p.planId, "price", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={1}
                            value={d.durationDays ?? 30}
                            onChange={(e) => updatePlanDraft(p.planId, "durationDays", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={0}
                            value={d.aiQuizLimit ?? 0}
                            onChange={(e) => updatePlanDraft(p.planId, "aiQuizLimit", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={0}
                            value={d.manualQuizLimit ?? 0}
                            onChange={(e) => updatePlanDraft(p.planId, "manualQuizLimit", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            value={d.documentUploadLimit ?? 0}
                            onChange={(e) => updatePlanDraft(p.planId, "documentUploadLimit", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={1}
                            max={5}
                            value={d.perQuizDocumentLimit ?? 1}
                            onChange={(e) => updatePlanDraft(p.planId, "perQuizDocumentLimit", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={d.maxMcqsPerQuiz ?? 10}
                            onChange={(e) => updatePlanDraft(p.planId, "maxMcqsPerQuiz", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            value={d.flashcardOtherGenerateLimit ?? 0}
                            onChange={(e) => updatePlanDraft(p.planId, "flashcardOtherGenerateLimit", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                          />
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, verticalAlign: "top" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", marginBottom: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!d.isActive}
                              onChange={(e) => updatePlanDraft(p.planId, "isActive", e.target.checked)}
                            />
                            {t("pricing.admin.active", "Active")}
                          </label>
                          {isFreePlan && (
                            <div style={{ display: "grid", gap: 6 }}>
                              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151" }}>
                                <input
                                  type="checkbox"
                                  checked={!!d.lockHintForFreePlan}
                                  onChange={(e) => updatePlanDraft(p.planId, "lockHintForFreePlan", e.target.checked)}
                                />
                                {t("pricing.admin.disableHint", 'Disable "Show Hint (3 steps)"')}
                              </label>
                              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151" }}>
                                <input
                                  type="checkbox"
                                  checked={!!d.lockPdfForFreePlan}
                                  onChange={(e) => updatePlanDraft(p.planId, "lockPdfForFreePlan", e.target.checked)}
                                />
                                {t("pricing.admin.disablePdf", 'Disable "Download Quiz PDF"')}
                              </label>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  type="button"
                  disabled={savingPlans}
                  onClick={savePlanConfigs}
                  style={{
                    borderRadius: 8,
                    padding: "10px 16px",
                    background: "#2563eb",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: savingPlans ? "not-allowed" : "pointer",
                  minWidth: 120,
                }}
              >
                {savingPlans ? t("pricing.admin.saving.button", "Saving...") : t("pricing.admin.save.button", "Save")}
              </button>
            </div>

            <div style={{ marginTop: 20 }}>
              <h4 style={{ marginTop: 0, marginBottom: 10 }}>Plan Features</h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: Math.max(980, 180 + (plans.length * 180)) }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8, width: 160 }}>Feature Row</th>
                      {plans.map((p) => (
                        <th key={`feature-head-${p.planId}`} style={{ textAlign: "left", border: "1px solid #e5e7eb", padding: 8, minWidth: 180 }}>
                          {getAdminFeatureGridPlanLabel(p, planDrafts[p.planId])}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 7 }, (_, featureIndex) => (
                      <tr key={`feature-row-${featureIndex + 1}`}>
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, fontWeight: 700, color: "#374151" }}>
                          {`Feature ${featureIndex + 1}`}
                        </td>
                        {plans.map((p) => {
                          const draft = planDrafts[p.planId] || {};
                          return (
                            <td key={`${p.planId}-feature-${featureIndex + 1}`} style={{ border: "1px solid #e5e7eb", padding: 8 }}>
                              <input
                                value={draft.planFeatures?.[featureIndex] ?? ""}
                                placeholder={`Feature ${featureIndex + 1}`}
                                onChange={(e) => {
                                  const nextFeatures = Array.isArray(draft.planFeatures)
                                    ? [...draft.planFeatures]
                                    : Array.from({ length: 7 }, () => "");
                                  nextFeatures[featureIndex] = e.target.value;
                                  updatePlanDraft(p.planId, "planFeatures", nextFeatures);
                                }}
                                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  type="button"
                  disabled={savingFeatures}
                  onClick={savePlanFeatures}
                  style={{
                    borderRadius: 8,
                    padding: "10px 16px",
                    background: "#2563eb",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: savingFeatures ? "not-allowed" : "pointer",
                    minWidth: 120,
                  }}
                >
                  {savingFeatures ? "Saving..." : "Save Features"}
                </button>
              </div>
            </div>
          </Card>
        )}
    </PageShell>
  );
}
