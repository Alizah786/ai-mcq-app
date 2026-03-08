import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useSidebarRefresh } from "../context/SidebarRefreshContext";
import { useAuth } from "../context/AuthContext";
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from "../api/http";
import { useTranslation } from "react-i18next";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Field from "../components/ui/Field";
import FormActions from "../components/ui/FormActions";
import FormSection from "../components/ui/FormSection";
import InlineAlert from "../components/ui/InlineAlert";
import PageShell from "../components/ui/PageShell";
import SectionHeader from "../components/ui/SectionHeader";
import StatusPill from "../components/ui/StatusPill";

function validateAiTopic(topicRaw) {
  const topic = String(topicRaw || "").trim();
  if (topic.length < 3) return "Topic must be at least 3 characters.";
  if (topic.length > 120) return "Topic must be 120 characters or less.";
  if (/[\r\n]/.test(topic)) return "Topic must be a single line.";
  if (/[,;|]/.test(topic)) return "Use one focused topic only (no comma-separated list).";
  if (/\s-\s*ai quiz$/i.test(topic) || /\bai quiz\b/i.test(topic)) {
    return "Do not include 'AI Quiz' in topic. Enter only the subject.";
  }
  const words = topic.split(/\s+/).filter(Boolean);
  if (words.length > 12) return "Topic is too broad. Keep it under 12 words.";
  return null;
}

function isAllowedSpreadsheetFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
}

function ActionIcon({ type }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (type === "edit") {
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (type === "quiz") {
    return (
      <svg {...common}>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </svg>
    );
  }
  if (type === "notes") {
    return (
      <svg {...common}>
        <path d="M8 3h8l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M16 3v5h5" />
        <path d="M10 13h6" />
        <path d="M10 17h6" />
      </svg>
    );
  }
  if (type === "history") {
    return (
      <svg {...common}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (type === "ai") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8" />
        <path d="M8 12h8" />
      </svg>
    );
  }
  return null;
}

function QuestionMixMatrix({ maxTotal, items, footer }) {
  const headerCell = {
    border: "1px solid #cbd5e1",
    padding: "8px 10px",
    textAlign: "center",
    color: "#475569",
    fontSize: 14,
    fontWeight: 800,
    background: "#f8fafc",
  };
  const rowLabelCell = {
    border: "1px solid #cbd5e1",
    padding: "8px 10px",
    textAlign: "left",
    color: "#111827",
    fontSize: 14,
    fontWeight: 800,
    background: "#f8fafc",
    whiteSpace: "nowrap",
  };
  const bodyCell = {
    border: "1px solid #cbd5e1",
    padding: 8,
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ ...headerCell, textAlign: "left" }}>Type</th>
            {items.map((item) => (
              <th key={item.key} style={headerCell}>
                {item.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={rowLabelCell}>Count</td>
            {items.map((item) => (
              <td key={`${item.key}-count`} style={bodyCell}>
                <input
                  type="number"
                  min={0}
                  max={maxTotal}
                  value={item.count}
                  onChange={(e) => item.onCountChange(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 15, fontWeight: 600 }}
                />
              </td>
            ))}
          </tr>
          <tr>
            <td style={rowLabelCell}>Difficulty</td>
            {items.map((item) => (
              <td key={`${item.key}-difficulty`} style={bodyCell}>
                <select
                  value={item.difficulty}
                  onChange={(e) => item.onDifficultyChange(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box", fontSize: 15, fontWeight: 600 }}
                >
                  <option>Easy</option>
                  <option>Medium</option>
                  <option>Hard</option>
                </select>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
        {footer || `Maximum total questions: ${maxTotal}`}
      </div>
    </div>
  );
}

function DisclaimerPanel({ title, text, checked, onChange }) {
  return (
    <div style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 12, background: "#fbfdff" }}>
      <div style={{ fontWeight: 700, marginBottom: 8, color: "#374151" }}>Disclaimer</div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#4b5563", lineHeight: 1.45 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          <span style={{ fontWeight: 700, color: "#374151" }}>{title || "Quiz Disclaimer"}</span>
          {checked ? (
            <span style={{ display: "block", color: "#16a34a", marginTop: 2 }}>Acknowledged</span>
          ) : (
            <span style={{ display: "block", marginTop: 2 }}>{text || "Loading disclaimer..."}</span>
          )}
        </span>
      </label>
    </div>
  );
}

function DashboardIcon({ type = "default", color = "#1d4ed8" }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  if (type === "classes") {
    return (
      <svg {...common}>
        <path d="M4.5 6.5h10a2 2 0 0 1 2 2v9h-10a2 2 0 0 0-2 2z" />
        <path d="M6.5 6.5a2 2 0 0 0-2 2v9" />
        <path d="M16.5 8.5h3a1 1 0 0 1 1 1v9h-4" />
      </svg>
    );
  }
  if (type === "students") {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="3.2" />
        <path d="M3.8 18.5a5.2 5.2 0 0 1 10.4 0" />
        <circle cx="17.2" cy="10" r="2.4" />
        <path d="M15.2 18.5a4.2 4.2 0 0 1 5-3.7" />
      </svg>
    );
  }
  if (type === "quizzes") {
    return (
      <svg {...common}>
        <rect x="6" y="4.5" width="12" height="15" rx="2" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h3" />
        <path d="M9 2.5v4" />
        <path d="M15 2.5v4" />
      </svg>
    );
  }
  if (type === "reports") {
    return (
      <svg {...common}>
        <path d="M5 18.5h14" />
        <path d="M7.5 16V11" />
        <path d="M12 16V7.5" />
        <path d="M16.5 16V9.5" />
      </svg>
    );
  }
  if (type === "activity") {
    return (
      <svg {...common}>
        <path d="M4.5 12h4l2.2-4 3.1 8 2.2-4h3.5" />
      </svg>
    );
  }
  if (type === "average") {
    return (
      <svg {...common}>
        <path d="M12 4.5l2.2 4.5 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="4.5" />
    </svg>
  );
}

function DashboardBadge({ label, icon = "default", tint = "#eef4ff", color = "#1d4ed8" }) {
  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: 16,
        background: tint,
        color,
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        fontSize: 18,
        boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.7)",
      }}
    >
      {icon ? <DashboardIcon type={icon} color={color} /> : label}
    </div>
  );
}

function DashboardListItem({ badgeLabel, badgeIcon = "default", badgeTint, badgeColor, title, subtitle, onClick, actionLabel = "Open" }) {
  const content = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <DashboardBadge label={badgeLabel} icon={badgeIcon} tint={badgeTint} color={badgeColor} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{title}</div>
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{subtitle}</div>
        </div>
      </div>
      <span style={{ color: "var(--accent-700)", fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>{actionLabel}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          width: "100%",
          textAlign: "left",
          border: "1px solid #e4eaf4",
          borderRadius: 18,
          background: "#fff",
          padding: "14px 16px",
          cursor: "pointer",
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid #edf2f7",
        paddingBottom: 12,
      }}
    >
      {content}
    </div>
  );
}

export default function Dashboard() {
  const { t: ti18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { triggerRefresh } = useSidebarRefresh();
  const { isManager, selectedStudentId, user } = useAuth();
  const createClass = searchParams.get("createClass") === "1";
  const createStudent = searchParams.get("createStudent") === "1";
  const importStudents = searchParams.get("importStudents") === "1";
  const classInfoId = searchParams.get("classInfo");
  const createQuizClassId = searchParams.get("createQuiz");
  const manageQuizId = searchParams.get("manageQuiz");
  const assignQuizId = searchParams.get("assignQuiz");
  const generateAiClassId = searchParams.get("generateAi");
  const importExcelClassId = searchParams.get("importExcel");
  const aiHistoryClassId = searchParams.get("aiHistory");
  const activeQuizBuilderClassId = generateAiClassId || createQuizClassId || importExcelClassId;

  const [className, setClassName] = useState("");
  const [subject, setSubject] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [term, setTerm] = useState("");
  const [showClassNameOnExport, setShowClassNameOnExport] = useState(true);
  const [showSubjectOnExport, setShowSubjectOnExport] = useState(false);
  const [showGradeLevelOnExport, setShowGradeLevelOnExport] = useState(false);
  const [showCourseCodeOnExport, setShowCourseCodeOnExport] = useState(true);
  const [showTermOnExport, setShowTermOnExport] = useState(true);
  const [quizTitle, setQuizTitle] = useState("");
  const [quizDescription, setQuizDescription] = useState("");
  const [manualMcqCount, setManualMcqCount] = useState(5);
  const [manualMcqDifficulty, setManualMcqDifficulty] = useState("Medium");
  const [manualShortCount, setManualShortCount] = useState(0);
  const [manualShortDifficulty, setManualShortDifficulty] = useState("Medium");
  const [manualTrueFalseCount, setManualTrueFalseCount] = useState(0);
  const [manualTrueFalseDifficulty, setManualTrueFalseDifficulty] = useState("Medium");
  const [manualMixMatchCount, setManualMixMatchCount] = useState(0);
  const [manualMixMatchDifficulty, setManualMixMatchDifficulty] = useState("Medium");
  const [manualLongCount, setManualLongCount] = useState(0);
  const [manualLongDifficulty, setManualLongDifficulty] = useState("Medium");
  const [manualAttemptLimit, setManualAttemptLimit] = useState(1);
  const [manualTimeLimitMinutes, setManualTimeLimitMinutes] = useState(30);
  const [manualRevealAnswersAfterSubmit, setManualRevealAnswersAfterSubmit] = useState(false);
  const [createQuizDisclaimerAccepted, setCreateQuizDisclaimerAccepted] = useState(false);
  const [courseOutlineFile, setCourseOutlineFile] = useState(null);
  const [courseOutlineDocumentId, setCourseOutlineDocumentId] = useState(null);
  const [courseOutlineDocumentName, setCourseOutlineDocumentName] = useState("");
  const [courseOutlineDocuments, setCourseOutlineDocuments] = useState([]);
  const [aiReferenceSource, setAiReferenceSource] = useState("document");
  const [aiPastedReferenceText, setAiPastedReferenceText] = useState("");
  const [courseOutlineStatus, setCourseOutlineStatus] = useState("");
  const [courseOutlineWarnings, setCourseOutlineWarnings] = useState([]);
  const [courseOutlineError, setCourseOutlineError] = useState("");
  const [courseOutlineBusy, setCourseOutlineBusy] = useState(false);
  const [showCourseOutlineModal, setShowCourseOutlineModal] = useState(false);
  const [studentUserName, setStudentUserName] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [studentPasswordConfirm, setStudentPasswordConfirm] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiAssessmentType, setAiAssessmentType] = useState("QUIZ");
  const [aiCount, setAiCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState("Medium");
  const [aiShortCount, setAiShortCount] = useState(0);
  const [aiShortDifficulty, setAiShortDifficulty] = useState("Medium");
  const [aiTrueFalseCount, setAiTrueFalseCount] = useState(0);
  const [aiTrueFalseDifficulty, setAiTrueFalseDifficulty] = useState("Medium");
  const [aiMixMatchCount, setAiMixMatchCount] = useState(0);
  const [aiMixMatchDifficulty, setAiMixMatchDifficulty] = useState("Medium");
  const [aiLongCount, setAiLongCount] = useState(0);
  const [aiLongDifficulty, setAiLongDifficulty] = useState("Medium");
  const [aiAssignmentDeadline, setAiAssignmentDeadline] = useState("");
  const [aiAssignmentTotalMarks, setAiAssignmentTotalMarks] = useState("");
  const [aiAssignmentWeightPercent, setAiAssignmentWeightPercent] = useState("");
  const [aiAttemptLimit, setAiAttemptLimit] = useState(1);
  const [aiTimeLimitMinutes, setAiTimeLimitMinutes] = useState(30);
  const [aiRevealAnswersAfterSubmit, setAiRevealAnswersAfterSubmit] = useState(false);
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useState(false);
  const [aiJobId, setAiJobId] = useState(null);
  const [aiStatus, setAiStatus] = useState("");
  const [showAiFailureFallback, setShowAiFailureFallback] = useState(false);
  const [aiCapability, setAiCapability] = useState({ canGenerate: true, reason: "", provider: "" });
  const [manualDisclaimer, setManualDisclaimer] = useState(null);
  const [aiDisclaimer, setAiDisclaimer] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [importAttemptLimit, setImportAttemptLimit] = useState(1);
  const [importTimeLimitMinutes, setImportTimeLimitMinutes] = useState(30);
  const [importRevealAnswersAfterSubmit, setImportRevealAnswersAfterSubmit] = useState(false);
  const [importExcelDisclaimerAccepted, setImportExcelDisclaimerAccepted] = useState(false);
  const [studentsExcelFile, setStudentsExcelFile] = useState(null);
  const [studentsImportFailedRows, setStudentsImportFailedRows] = useState([]);
  const [aiHistoryItems, setAiHistoryItems] = useState([]);
  const [loadingAiHistory, setLoadingAiHistory] = useState(false);
  const [creatingFromHistoryId, setCreatingFromHistoryId] = useState(null);
  const [selectedAiHistoryIds, setSelectedAiHistoryIds] = useState([]);
  const [historyAttemptLimit, setHistoryAttemptLimit] = useState(1);
  const [historyTimeLimitMinutes, setHistoryTimeLimitMinutes] = useState(30);
  const [historyRevealAnswersAfterSubmit, setHistoryRevealAnswersAfterSubmit] = useState(false);
  const [selectedClassInfo, setSelectedClassInfo] = useState(null);
  const [quickActionClassId, setQuickActionClassId] = useState("");
  const [selectedClassQuizId, setSelectedClassQuizId] = useState(null);
  const [classQuizMenuId, setClassQuizMenuId] = useState(null);
  const [classStudents, setClassStudents] = useState([]);
  const [isEditingClassInfo, setIsEditingClassInfo] = useState(false);
  const [editClassName, setEditClassName] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editGradeLevel, setEditGradeLevel] = useState("");
  const [editCourseCode, setEditCourseCode] = useState("");
  const [editTerm, setEditTerm] = useState("");
  const [assignQuizTitle, setAssignQuizTitle] = useState("");
  const [assignClassOptions, setAssignClassOptions] = useState([]);
  const [assignClassName, setAssignClassName] = useState("");
  const [assignStudents, setAssignStudents] = useState([]);
  const [assignSelected, setAssignSelected] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reportClasses, setReportClasses] = useState([]);
  const [reportStudents, setReportStudents] = useState([]);
  const [reportClassId, setReportClassId] = useState("");
  const [reportStudentId, setReportStudentId] = useState("");
  const [reportQuizId, setReportQuizId] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportResult, setReportResult] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [dashboardInfoTab, setDashboardInfoTab] = useState("classInfo");

  const isAssignedStudent =
    user?.role === "Student" &&
    Number(user?.managerId || 0) > 0 &&
    !user?.isDirectStudent;
  const isOverviewMode =
    !createClass &&
    !createStudent &&
    !importStudents &&
    !classInfoId &&
    !createQuizClassId &&
    !manageQuizId &&
    !assignQuizId &&
    !generateAiClassId &&
    !importExcelClassId &&
    !aiHistoryClassId;
  const showDashboardHeader =
    !isManager ||
    (!isOverviewMode &&
      !classInfoId &&
      !createQuizClassId &&
      !generateAiClassId &&
      !importExcelClassId);

  if (isAssignedStudent) {
    return <Navigate to="/assigned-quizzes" replace />;
  }

  useEffect(() => {
    setError("");
    setSuccess("");
  }, [createClass, createStudent, importStudents, classInfoId, createQuizClassId, manageQuizId, assignQuizId, generateAiClassId, importExcelClassId, aiHistoryClassId]);

  useEffect(() => {
    if (!aiHistoryClassId) {
      setSelectedAiHistoryIds([]);
    }
  }, [aiHistoryClassId]);

  useEffect(() => {
    if (classInfoId) {
      setDashboardInfoTab("classInfo");
    }
  }, [classInfoId]);

  useEffect(() => {
    if (!generateAiClassId) {
      setCourseOutlineFile(null);
      setCourseOutlineDocumentId(null);
      setCourseOutlineDocumentName("");
      setCourseOutlineDocuments([]);
      setAiReferenceSource("document");
      setAiPastedReferenceText("");
      setCourseOutlineStatus("");
      setCourseOutlineWarnings([]);
      setCourseOutlineError("");
      setCourseOutlineBusy(false);
      setShowCourseOutlineModal(false);
    }
  }, [generateAiClassId]);

  useEffect(() => {
    if (!classInfoId) {
      setSelectedClassInfo(null);
      setQuickActionClassId("");
      setSelectedClassQuizId(null);
      setClassQuizMenuId(null);
      setClassStudents([]);
      setIsEditingClassInfo(false);
      return;
    }
    let cancelled = false;
    async function loadClassInfo() {
      try {
        const query = isManager && selectedStudentId ? `?studentId=${selectedStudentId}` : "";
        const res = await apiGet(`/api/classes${query}`);
        if (cancelled) return;
        const classes = Array.isArray(res.classes) ? res.classes : [];
        const classIdNum = Number(classInfoId);
        const found = classes.find((c) => Number(c.classId) === classIdNum) || null;
        setSelectedClassInfo(found);
        setQuickActionClassId(found?.classId ? String(found.classId) : "");
        setSelectedClassQuizId((prev) => {
          const quizzes = Array.isArray(found?.quizzes) ? found.quizzes : [];
          if (quizzes.some((q) => Number(q.quizId) === Number(prev))) return prev;
          return quizzes.length ? Number(quizzes[0].quizId) : null;
        });
        setClassQuizMenuId(null);
        setIsEditingClassInfo(false);
        setEditClassName(String(found?.className || ""));
        setEditSubject(String(found?.subject || ""));
        setEditGradeLevel(String(found?.gradeLevel || ""));
        setEditCourseCode(String(found?.courseCode || ""));
        setEditTerm(String(found?.term || ""));
        if (found) {
          const members = await apiGet(`/api/classes/${classIdNum}/students`);
          setClassStudents(Array.isArray(members.students) ? members.students : []);
        } else {
          setClassStudents([]);
        }
        if (!found) setError("Class not found for current selection.");
      } catch (err) {
        if (cancelled) return;
        setSelectedClassInfo(null);
        setQuickActionClassId("");
        setSelectedClassQuizId(null);
        setClassQuizMenuId(null);
        setClassStudents([]);
        setIsEditingClassInfo(false);
        setError(err.message || "Failed to load class information");
      }
    }
    loadClassInfo();
    return () => {
      cancelled = true;
    };
  }, [classInfoId, isManager, selectedStudentId]);

  useEffect(() => {
    if (!assignQuizId || !isManager) return;
    let cancelled = false;
    async function loadAssignmentData() {
      try {
        const query = assignClassName ? `?className=${encodeURIComponent(assignClassName)}` : "";
        const data = await apiGet(`/api/quizzes/${assignQuizId}/assignments/students${query}`);
        if (cancelled) return;
        const students = Array.isArray(data.students) ? data.students : [];
        const classOptions = Array.isArray(data.classOptions) ? data.classOptions : [];
        setAssignQuizTitle(data.quizTitle || "");
        setAssignClassOptions(classOptions);
        if (!assignClassName && data.quizClassName && classOptions.includes(data.quizClassName)) {
          setAssignClassName(data.quizClassName);
          return;
        }
        if (assignClassName && !classOptions.includes(assignClassName)) {
          setAssignClassName("");
          return;
        }
        setAssignStudents(students);
        setAssignSelected(students.filter((s) => s.assigned).map((s) => Number(s.studentId)));
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load assignment students");
        setAssignClassOptions([]);
        setAssignStudents([]);
        setAssignSelected([]);
      }
    }
    loadAssignmentData();
    return () => {
      cancelled = true;
    };
  }, [assignQuizId, isManager, assignClassName]);

  useEffect(() => {
    if (!aiJobId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const job = await apiGet(`/api/ai/jobs/${aiJobId}`);
        if (cancelled) return;
        setAiStatus(job.status || "");

        if (job.status === "Completed") {
          setSuccess("AI content generated successfully.");
          setShowAiFailureFallback(false);
          setAiJobId(null);
          setAiStatus("");
          triggerRefresh();
          if (job.resultQuizId) {
            navigate(`/quiz/${job.resultQuizId}/edit`);
            return;
          }
        }

        if (job.status === "Failed") {
          setSuccess("");
          setError(job.errorMessage || "AI generation failed");
          setShowAiFailureFallback(true);
          setAiJobId(null);
          setAiStatus("");
        }
      } catch (err) {
        if (cancelled) return;
        setSuccess("");
        setError(err.message || "Failed to poll AI generation status");
        setShowAiFailureFallback(false);
        setAiJobId(null);
        setAiStatus("");
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [aiJobId, setSearchParams, triggerRefresh]);

  useEffect(() => {
    if (!courseOutlineDocumentId) return;
    const terminal = new Set(["Extracted", "Rejected", "Blocked", "DeletedByUser"]);
    if (terminal.has(String(courseOutlineStatus || ""))) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const doc = await apiGet(`/api/document/${courseOutlineDocumentId}/status`);
        if (cancelled) return;
        const status = doc?.document?.status || "";
        setCourseOutlineStatus(status);
        setCourseOutlineWarnings(Array.isArray(doc?.document?.warningCodes) ? doc.document.warningCodes : []);
        const errCode = String(doc?.document?.errorCode || "").trim();
        if (errCode && (status === "Rejected" || status === "Blocked")) {
          setCourseOutlineError(`Document processing ended with ${errCode}.`);
        }
      } catch (e) {
        if (cancelled) return;
        setCourseOutlineError(e.message || "Failed to poll document status.");
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [courseOutlineDocumentId, courseOutlineStatus]);

  useEffect(() => {
    if (!generateAiClassId) return;
    let cancelled = false;
    async function loadExistingCourseOutline() {
      try {
        const res = await apiGet(`/api/classes/${encodeURIComponent(generateAiClassId)}/course-outline`);
        if (cancelled) return;
        const doc = res?.document || null;
        setCourseOutlineDocumentId(Number(doc?.documentId || 0) || null);
        setCourseOutlineDocumentName(String(doc?.originalFileName || ""));
        setCourseOutlineStatus(String(doc?.status || ""));
        setCourseOutlineWarnings(Array.isArray(doc?.warningCodes) ? doc.warningCodes : []);
        setCourseOutlineError("");
      } catch (err) {
        if (cancelled) return;
        setCourseOutlineDocumentId(null);
        setCourseOutlineDocumentName("");
        setCourseOutlineStatus("");
        setCourseOutlineWarnings([]);
        setCourseOutlineError(err.message || "Failed to load existing course outline.");
      }
    }
    loadExistingCourseOutline();
    return () => {
      cancelled = true;
    };
  }, [generateAiClassId]);

  useEffect(() => {
    if (!generateAiClassId) return;
    let cancelled = false;
    async function loadCourseOutlineDocuments() {
      try {
        const res = await apiGet(`/api/study-materials/documents?classId=${encodeURIComponent(generateAiClassId)}`);
        if (cancelled) return;
        setCourseOutlineDocuments(Array.isArray(res?.documents) ? res.documents : []);
      } catch {
        if (cancelled) return;
        setCourseOutlineDocuments([]);
      }
    }
    loadCourseOutlineDocuments();
    return () => {
      cancelled = true;
    };
  }, [generateAiClassId, courseOutlineDocumentId]);

  useEffect(() => {
    if (!generateAiClassId) return;
    let cancelled = false;
    async function loadCapability() {
      try {
        const cap = await apiGet("/api/ai/capability");
        if (cancelled) return;
        setAiCapability({
          canGenerate: !!cap.canGenerate,
          reason: cap.reason || "",
          provider: cap.provider || "",
        });
      } catch (err) {
        if (cancelled) return;
        setAiCapability({
          canGenerate: false,
          reason: err.message || "AI capability check failed",
          provider: "",
        });
      }
    }
    loadCapability();
    return () => {
      cancelled = true;
    };
  }, [generateAiClassId]);

  useEffect(() => {
    if (!createQuizClassId && !generateAiClassId && !importExcelClassId) return;
    let cancelled = false;
    async function loadDisclaimers() {
      try {
        const data = await apiGet("/api/disclaimers/active");
        if (cancelled) return;
        setManualDisclaimer(data?.manual || null);
        setAiDisclaimer(data?.ai || null);
      } catch (err) {
        if (cancelled) return;
        setManualDisclaimer(null);
        setAiDisclaimer(null);
        setError(err.message || "Failed to load disclaimers");
      }
    }
    loadDisclaimers();
    return () => {
      cancelled = true;
    };
  }, [createQuizClassId, generateAiClassId, importExcelClassId]);

  useEffect(() => {
    if (!aiHistoryClassId) {
      setAiHistoryItems([]);
      setLoadingAiHistory(false);
      return;
    }
    let cancelled = false;
    async function loadAiHistory() {
      setLoadingAiHistory(true);
      try {
        const data = await apiGet(`/api/ai/dictionary?classId=${encodeURIComponent(aiHistoryClassId)}&limit=50`);
        if (cancelled) return;
        setAiHistoryItems(Array.isArray(data?.items) ? data.items : []);
      } catch (err) {
        if (cancelled) return;
        setAiHistoryItems([]);
        setError(err.message || "Failed to load AI history.");
      } finally {
        if (!cancelled) setLoadingAiHistory(false);
      }
    }
    loadAiHistory();
    return () => {
      cancelled = true;
    };
  }, [aiHistoryClassId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSubscription() {
      try {
        const res = await apiGet("/api/billing/subscription-status");
        if (cancelled) return;
        setSubscription(res.subscription || null);
      } catch {
        if (cancelled) return;
        setSubscription(null);
      }
    }
    loadSubscription();
    return () => {
      cancelled = true;
    };
  }, [user?.userId]);

  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    async function loadReportFilters() {
      try {
        const [classesRes, studentsRes] = await Promise.all([
          apiGet("/api/classes"),
          apiGet("/api/teacher/students"),
        ]);
        if (cancelled) return;
        setReportClasses(Array.isArray(classesRes.classes) ? classesRes.classes : []);
        setReportStudents(Array.isArray(studentsRes.students) ? studentsRes.students : []);
      } catch (err) {
        if (cancelled) return;
        setReportError(err.message || "Failed to load report filters");
      }
    }
    loadReportFilters();
    return () => {
      cancelled = true;
    };
  }, [isManager]);

  const reportClassOptionsRaw = reportClasses
    .map((c) => ({ classId: Number(c.classId), className: c.className, studentId: Number(c.studentId) }))
    .filter((c) => Number.isFinite(c.classId) && c.classId > 0);

  const reportClassOptions = reportClassId
    ? reportClassOptionsRaw
    : reportStudentId
      ? reportClassOptionsRaw.filter((c) => Number(c.studentId) === Number(reportStudentId))
      : reportClassOptionsRaw;

  const reportStudentOptions = (() => {
    const scoped = reportClassId
      ? reportClassOptionsRaw.filter((c) => Number(c.classId) === Number(reportClassId))
      : reportClassOptionsRaw;
    const ids = new Set(scoped.map((x) => Number(x.studentId)).filter((n) => Number.isFinite(n) && n > 0));
    return reportStudents.filter((s) => ids.has(Number(s.studentId)));
  })();

  const reportQuizOptions = (() => {
    const out = [];
    for (const c of reportClasses) {
      const cid = Number(c.classId);
      const sid = Number(c.studentId);
      const quizzes = Array.isArray(c.quizzes) ? c.quizzes : [];
      for (const q of quizzes) {
        const qid = Number(q.quizId);
        if (!Number.isFinite(cid) || !Number.isFinite(qid)) continue;
        out.push({
          quizId: qid,
          title: q.title || `Quiz ${qid}`,
          classId: cid,
          studentId: sid,
        });
      }
    }
    return out.filter((q) => {
      if (reportClassId && Number(q.classId) !== Number(reportClassId)) return false;
      if (reportStudentId && Number(q.studentId) !== Number(reportStudentId)) return false;
      return true;
    });
  })();

  const managerClassSummaries = useMemo(() => {
    const seen = new Set();
    return reportClasses.reduce((acc, item) => {
      const classId = Number(item.classId);
      if (!Number.isFinite(classId) || seen.has(classId)) return acc;
      seen.add(classId);
      acc.push({
        classId,
        className: item.className || `Class ${classId}`,
        studentCount: Array.isArray(item.students) ? item.students.length : null,
        quizCount: Array.isArray(item.quizzes) ? item.quizzes.length : 0,
      });
      return acc;
    }, []);
  }, [reportClasses]);

  const managerStudentSummaries = useMemo(
    () => reportStudents.slice(0, 4).map((student) => ({
      studentId: Number(student.studentId),
      studentCode: student.studentCode || "Student",
      userName: student.userName || "",
    })),
    [reportStudents]
  );

  const managerRecentActivity = useMemo(() => {
    const attempts = Array.isArray(reportResult?.attempts) ? [...reportResult.attempts] : [];
    return attempts
      .sort((a, b) => new Date(b.submittedAtUtc || 0).getTime() - new Date(a.submittedAtUtc || 0).getTime())
      .slice(0, 4);
  }, [reportResult]);

  const managerMetrics = useMemo(() => {
    const uniqueClassCount = managerClassSummaries.length;
    const uniqueStudentCount = new Set(
      reportStudents.map((student) => Number(student.studentId)).filter((id) => Number.isFinite(id) && id > 0)
    ).size;
    const uniqueQuizCount = new Set(
      reportQuizOptions.map((quiz) => Number(quiz.quizId)).filter((id) => Number.isFinite(id) && id > 0)
    ).size;
    return {
      classes: uniqueClassCount,
      students: uniqueStudentCount,
      quizzes: uniqueQuizCount,
      avgScore: Number(reportResult?.summary?.avgScorePercent || 0),
    };
  }, [managerClassSummaries, reportQuizOptions, reportStudents, reportResult]);

  const selectedClassQuiz = useMemo(() => {
    const quizzes = Array.isArray(selectedClassInfo?.quizzes) ? selectedClassInfo.quizzes : [];
    return quizzes.find((quiz) => Number(quiz.quizId) === Number(selectedClassQuizId)) || null;
  }, [selectedClassInfo, selectedClassQuizId]);

  useEffect(() => {
    if (reportClassId && !reportClassOptions.some((c) => Number(c.classId) === Number(reportClassId))) {
      setReportClassId("");
    }
  }, [reportClassId, reportClassOptions]);

  useEffect(() => {
    if (reportStudentId && !reportStudentOptions.some((s) => Number(s.studentId) === Number(reportStudentId))) {
      setReportStudentId("");
    }
  }, [reportStudentId, reportStudentOptions]);

  useEffect(() => {
    if (reportQuizId && !reportQuizOptions.some((q) => Number(q.quizId) === Number(reportQuizId))) {
      setReportQuizId("");
    }
  }, [reportQuizId, reportQuizOptions]);

  async function runReport() {
    setReportLoading(true);
    setReportError("");
    try {
      const params = new URLSearchParams();
      if (reportClassId) params.set("classId", String(reportClassId));
      if (reportStudentId) params.set("studentId", String(reportStudentId));
      if (reportQuizId) params.set("quizId", String(reportQuizId));
      const query = params.toString();
      const result = await apiGet(`/api/reports/quiz-performance${query ? `?${query}` : ""}`);
      setReportResult(result);
    } catch (err) {
      setReportError(err.message || "Failed to run report");
      setReportResult(null);
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    if (!isManager) return;
    if (createClass || createStudent || importStudents || createQuizClassId || manageQuizId || assignQuizId || generateAiClassId || importExcelClassId || aiHistoryClassId) {
      return;
    }
    if (dashboardInfoTab !== "report") return;
    if (reportLoading || reportResult || reportError) return;
    runReport();
  }, [
    isManager,
    createClass,
    createStudent,
    importStudents,
    createQuizClassId,
    manageQuizId,
    assignQuizId,
    generateAiClassId,
    importExcelClassId,
    aiHistoryClassId,
    dashboardInfoTab,
    reportLoading,
    reportResult,
    reportError,
  ]);

  async function handleRunReport(e) {
    e.preventDefault();
    await runReport();
  }

  async function handlePublishQuiz() {
    if (!manageQuizId) return;
    setError("");
    setSubmitting(true);
    try {
      await apiPost(`/api/quizzes/${manageQuizId}/publish`, {});
      setSuccess("Quiz published.");
      triggerRefresh();
    } catch (err) {
      setError(err.message || "Failed to publish quiz");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveClassInfo() {
    if (!selectedClassInfo?.classId) return;
    const nextClassName = String(editClassName || "").trim();
    if (!nextClassName) {
      setError("Class name is required.");
      return;
    }
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      await apiPut(`/api/classes/${selectedClassInfo.classId}`, {
        className: nextClassName,
        subject: String(editSubject || "").trim() || null,
        gradeLevel: String(editGradeLevel || "").trim() || null,
        courseCode: String(editCourseCode || "").trim() || null,
        term: String(editTerm || "").trim() || null,
      });
      setSuccess("Class information updated.");
      setIsEditingClassInfo(false);
      triggerRefresh();
      setSearchParams({ classInfo: String(selectedClassInfo.classId) });
    } catch (err) {
      setError(err.message || "Failed to update class information");
    } finally {
      setSubmitting(false);
    }
  }

  function updateSelectedClassQuizzes(updater) {
    setSelectedClassInfo((prev) => {
      if (!prev) return prev;
      const currentQuizzes = Array.isArray(prev.quizzes) ? prev.quizzes : [];
      const nextQuizzes = updater(currentQuizzes);
      return {
        ...prev,
        quizzes: nextQuizzes,
      };
    });
  }

  async function handleCreateNewDraftFromQuiz(quizId) {
    if (!quizId) return;
    setError("");
    setSuccess("");
    try {
      const res = await apiPost(`/api/quizzes/${quizId}/new-draft`, {});
      setSuccess("New draft created.");
      triggerRefresh();
      setClassQuizMenuId(null);
      if (res?.quizId) navigate(`/quiz/${res.quizId}/edit`);
    } catch (err) {
      setError(err.message || "Failed to create new draft.");
    }
  }

  async function handleUpdateQuizTimeLimit(quiz) {
    if (!quiz?.quizId) return;
    const current = Number(quiz.timeLimitMinutes || 0);
    const raw = window.prompt("Set time limit in minutes (0 to disable timer).", String(current));
    if (raw == null) return;
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 0 || next > 300) {
      setError("Enter a valid time limit between 0 and 300 minutes.");
      return;
    }
    setError("");
    setSuccess("");
    try {
      const res = await apiPut(`/api/quizzes/${quiz.quizId}/time-limit`, {
        timeLimitMinutes: Math.round(next),
      });
      updateSelectedClassQuizzes((items) =>
        items.map((item) =>
          Number(item.quizId) === Number(quiz.quizId)
            ? { ...item, timeLimitMinutes: Number(res?.timeLimitMinutes || Math.round(next)) }
            : item
        )
      );
      setSuccess("Quiz time updated.");
      setClassQuizMenuId(null);
    } catch (err) {
      setError(err.message || "Failed to update quiz time.");
    }
  }

  async function handleDeleteQuizFromClass(quiz) {
    if (!quiz?.quizId) return;
    const confirmed = window.confirm(`Delete "${quiz.title}"? This cannot be undone.`);
    if (!confirmed) return;
    setError("");
    setSuccess("");
    try {
      await apiDelete(`/api/quizzes/${quiz.quizId}`);
      const remainingQuizzes = (selectedClassInfo?.quizzes || []).filter((item) => Number(item.quizId) !== Number(quiz.quizId));
      updateSelectedClassQuizzes(() => remainingQuizzes);
      setSelectedClassQuizId((prev) => {
        if (Number(prev) !== Number(quiz.quizId)) return prev;
        return remainingQuizzes.length ? Number(remainingQuizzes[0].quizId) : null;
      });
      setClassQuizMenuId(null);
      triggerRefresh();
      setSuccess("Quiz deleted.");
    } catch (err) {
      setError(err.message || "Failed to delete quiz.");
    }
  }

  async function handleCreateClass(e) {
    e.preventDefault();
    if (isManager && !selectedStudentId) {
      setError("Select a student in sidebar first.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const created = await apiPost("/api/classes", {
        className: className.trim(),
        subject: subject.trim() || undefined,
        gradeLevel: gradeLevel.trim() || undefined,
        courseCode: courseCode.trim() || undefined,
        term: term.trim() || undefined,
        showClassNameOnExport,
        showSubjectOnExport,
        showGradeLevelOnExport,
        showCourseCodeOnExport,
        showTermOnExport,
        studentId: isManager ? Number(selectedStudentId) : undefined,
      });
      setSuccess(created?.joinCode ? `Class created. Join code: ${created.joinCode}` : "Class created.");
      setClassName("");
      setSubject("");
      setGradeLevel("");
      setCourseCode("");
      setTerm("");
      setShowClassNameOnExport(true);
      setShowSubjectOnExport(false);
      setShowGradeLevelOnExport(false);
      setShowCourseCodeOnExport(true);
      setShowTermOnExport(true);
      triggerRefresh();
      if (created?.classId) {
        setSearchParams({ classInfo: String(created.classId) });
      } else {
        setSearchParams({});
      }
    } catch (err) {
      setError(err.message || "Failed to create class");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateQuiz(e) {
    e.preventDefault();
    if (!createQuizClassId) return;
    setError("");
    setSubmitting(true);
    try {
      if (!createQuizDisclaimerAccepted) {
        setError("Please read and acknowledge the disclaimer before creating the quiz.");
        setSubmitting(false);
        return;
      }
      if (!manualDisclaimer?.DisclaimerId) {
        setError("Active manual disclaimer not found.");
        setSubmitting(false);
        return;
      }
      const created = await apiPost(`/api/classes/${createQuizClassId}/quizzes`, {
        title: quizTitle.trim(),
        description: quizDescription.trim() || undefined,
        mcqCount: Number(manualMcqCount || 0),
        mcqDifficulty: manualMcqDifficulty,
        shortCount: Number(manualShortCount || 0),
        shortDifficulty: manualShortDifficulty,
        trueFalseCount: Number(manualTrueFalseCount || 0),
        trueFalseDifficulty: manualTrueFalseDifficulty,
        mixMatchCount: Number(manualMixMatchCount || 0),
        mixMatchDifficulty: manualMixMatchDifficulty,
        longCount: Number(manualLongCount || 0),
        longDifficulty: manualLongDifficulty,
        attemptLimit: Number(manualAttemptLimit || 1),
        timeLimitMinutes: Number(manualTimeLimitMinutes || 0),
        revealAnswersAfterSubmit: manualRevealAnswersAfterSubmit,
        disclaimerAcknowledged: true,
        disclaimerId: Number(manualDisclaimer.DisclaimerId),
      });
      setSuccess(`Quiz created (draft). ${Number(created?.questionCount || 0)} question(s) pre-created.`);
      setQuizTitle("");
      setQuizDescription("");
      setManualMcqCount(5);
      setManualMcqDifficulty("Medium");
      setManualShortCount(0);
      setManualShortDifficulty("Medium");
      setManualTrueFalseCount(0);
      setManualTrueFalseDifficulty("Medium");
      setManualMixMatchCount(0);
      setManualMixMatchDifficulty("Medium");
      setManualLongCount(0);
      setManualLongDifficulty("Medium");
      setManualAttemptLimit(1);
      setManualTimeLimitMinutes(30);
      setManualRevealAnswersAfterSubmit(false);
      setCreateQuizDisclaimerAccepted(false);
      triggerRefresh();
      if (created?.quizId) {
        navigate(`/quiz/${created.quizId}/edit`);
        return;
      }
      setSearchParams({});
    } catch (err) {
      setError(err.message || "Failed to create quiz");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadCourseOutline() {
    if (!courseOutlineFile) {
      setCourseOutlineError("Choose a file first.");
      return;
    }
    if (!generateAiClassId) {
      setCourseOutlineError("Select class first.");
      return;
    }

    setCourseOutlineBusy(true);
    setCourseOutlineError("");
    try {
      const form = new FormData();
      form.append("file", courseOutlineFile);
      form.append("classId", String(Number(generateAiClassId)));
      form.append("courseCode", String(aiTopic || `CLASS-${generateAiClassId}`).trim().slice(0, 80));
      const res = await apiUpload("/api/document/upload-course-outline", form);
      setCourseOutlineDocumentId(Number(res?.documentId || 0) || null);
      setCourseOutlineDocumentName(String(courseOutlineFile?.name || ""));
      setCourseOutlineStatus(String(res?.status || "Uploaded"));
      setCourseOutlineWarnings([]);
    } catch (e) {
      setCourseOutlineError(e.message || "Failed to upload document.");
    } finally {
      setCourseOutlineBusy(false);
    }
  }

  async function handleRemoveCourseOutline() {
    if (!courseOutlineDocumentId) return;
    setCourseOutlineBusy(true);
    setCourseOutlineError("");
    try {
      await apiDelete(`/api/document/${courseOutlineDocumentId}`);
      setCourseOutlineStatus("DeletedByUser");
      setCourseOutlineWarnings([]);
      setCourseOutlineDocumentId(null);
      setCourseOutlineDocumentName("");
      setCourseOutlineFile(null);
    } catch (e) {
      setCourseOutlineError(e.message || "Failed to remove document.");
    } finally {
      setCourseOutlineBusy(false);
    }
  }

  async function handleGenerateAiQuiz(e) {
    e.preventDefault();
    if (!generateAiClassId) return;
    if (isManager && !selectedStudentId) {
      setError("Select a student in sidebar first.");
      return;
    }
    if (!aiCapability.canGenerate) {
      setError(aiCapability.reason || "AI provider is not available");
      return;
    }
    if (!isManager && subscription?.isStudentPostTrialLocked) {
      setError("You have reached free AI practice limit. Upgrade to continue.");
      return;
    }
    if (!aiDisclaimerAccepted) {
      setError("Please read and acknowledge the AI quiz disclaimer before generating.");
      return;
    }
    if (!aiDisclaimer?.DisclaimerId) {
      setError("Active AI disclaimer not found.");
      return;
    }
    if (courseOutlineDocumentId && String(courseOutlineStatus || "").trim() !== "Extracted") {
      setError("Course outline is still processing. Wait until status is Extracted.");
      return;
    }
    const trimmedReferenceText = String(aiPastedReferenceText || "").trim();
    if (aiReferenceSource === "text" && trimmedReferenceText.length > 0 && trimmedReferenceText.length < 120) {
      setError("Pasted reference text must be at least 120 characters.");
      return;
    }
    const topicValidationError = validateAiTopic(aiTopic);
    if (topicValidationError) {
      setError(topicValidationError);
      return;
    }

    setError("");
    setSuccess("");
    setShowAiFailureFallback(false);
    setSubmitting(true);
    try {
      const created = await apiPost("/api/ai/jobs", {
        classId: Number(generateAiClassId),
        assessmentType: aiAssessmentType,
        topic: aiTopic.trim(),
        mcqCount: aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiCount || 0),
        mcqDifficulty: aiDifficulty,
        shortCount: aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiShortCount || 0),
        shortDifficulty: aiShortDifficulty,
        trueFalseCount: aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiTrueFalseCount || 0),
        trueFalseDifficulty: aiTrueFalseDifficulty,
        mixMatchCount: aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiMixMatchCount || 0),
        mixMatchDifficulty: aiMixMatchDifficulty,
        longCount: Number(aiLongCount || 0),
        longDifficulty: aiLongDifficulty,
        attemptLimit: Number(aiAttemptLimit || 1),
        timeLimitMinutes: Number(aiTimeLimitMinutes || 0),
        revealAnswersAfterSubmit: aiRevealAnswersAfterSubmit,
        deadlineDate: aiAssessmentType === "ASSIGNMENT" ? String(aiAssignmentDeadline || "").trim() : undefined,
        totalMarks:
          aiAssessmentType === "ASSIGNMENT" && String(aiAssignmentTotalMarks || "").trim() !== ""
            ? Number(aiAssignmentTotalMarks)
            : undefined,
        weightPercent:
          aiAssessmentType === "ASSIGNMENT" && String(aiAssignmentWeightPercent || "").trim() !== ""
            ? Number(aiAssignmentWeightPercent)
            : undefined,
        documentId: aiReferenceSource === "document" ? (courseOutlineDocumentId || undefined) : undefined,
        referenceText: aiReferenceSource === "text" && trimmedReferenceText ? trimmedReferenceText : undefined,
        disclaimerAcknowledged: true,
        disclaimerId: Number(aiDisclaimer.DisclaimerId),
        studentId: isManager ? Number(selectedStudentId) : undefined,
      });
      setAiJobId(created.jobId);
      setAiStatus(created.status || "Queued");
      setSuccess("AI generation started in background.");
    } catch (err) {
      setError(err.message || "Failed to start AI generation");
      setShowAiFailureFallback(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportExcel(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (isManager && !selectedStudentId) {
      setError("Select a student in sidebar first.");
      return;
    }
    if (!excelFile) {
      setError("Please choose a spreadsheet file (.xlsx, .xls, or .csv).");
      return;
    }
    if (!isAllowedSpreadsheetFile(excelFile)) {
      setError("Invalid file type. Only .xlsx, .xls, or .csv files are allowed.");
      return;
    }
    if (!importExcelDisclaimerAccepted) {
      setError("Please read and acknowledge the manual quiz disclaimer before importing.");
      return;
    }
    if (!manualDisclaimer?.DisclaimerId) {
      setError("Active manual disclaimer not found.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", excelFile);
      form.append("attemptLimit", String(Number(importAttemptLimit || 1)));
      form.append("timeLimitMinutes", String(Number(importTimeLimitMinutes || 0)));
      form.append("revealAnswersAfterSubmit", importRevealAnswersAfterSubmit ? "true" : "false");
      form.append("disclaimerAcknowledged", "true");
      form.append("disclaimerId", String(manualDisclaimer.DisclaimerId));
      if (isManager && selectedStudentId) {
        form.append("studentId", String(selectedStudentId));
      }
      const result = await apiUpload("/api/import/excel", form);
      setSuccess(
        `Import complete: ${result.importedQuestions} question(s), ${result.quizzesTouched} quiz(es), ${result.classesTouched} class(es).`
      );
      setExcelFile(null);
      setImportAttemptLimit(1);
      setImportTimeLimitMinutes(30);
      setImportRevealAnswersAfterSubmit(false);
      setImportExcelDisclaimerAccepted(false);
      triggerRefresh();
    } catch (err) {
      setError(err.message || "Excel import failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateFromAiHistory(item) {
    if (!item?.aiQuizDictionaryId || !aiHistoryClassId) return;
    setError("");
    setSuccess("");
    setCreatingFromHistoryId(item.aiQuizDictionaryId);
    try {
      const created = await apiPost(`/api/ai/dictionary/${item.aiQuizDictionaryId}/create-quiz`, {
        classId: Number(aiHistoryClassId),
        attemptLimit: Number(historyAttemptLimit || 1),
        timeLimitMinutes: Number(historyTimeLimitMinutes || 0),
        revealAnswersAfterSubmit: historyRevealAnswersAfterSubmit,
      });
      setSuccess(`Quiz created from history: ${created?.title || "Draft quiz"}`);
      triggerRefresh();
      if (created?.quizId) {
        navigate(`/quiz/${created.quizId}/edit`);
        return;
      }
    } catch (err) {
      setError(err.message || "Failed to create quiz from AI history.");
    } finally {
      setCreatingFromHistoryId(null);
    }
  }

  async function handleCreateMixedFromAiHistory() {
    if (!aiHistoryClassId) return;
    if (selectedAiHistoryIds.length < 2) {
      setError("Select at least two AI history items to create a mixed draft.");
      return;
    }
    setError("");
    setSuccess("");
    setCreatingFromHistoryId("mixed");
    try {
      const created = await apiPost("/api/ai/dictionary-mixed/create-quiz", {
        classId: Number(aiHistoryClassId),
        dictionaryIds: selectedAiHistoryIds.map((id) => Number(id)),
        attemptLimit: Number(historyAttemptLimit || 1),
        timeLimitMinutes: Number(historyTimeLimitMinutes || 0),
        revealAnswersAfterSubmit: historyRevealAnswersAfterSubmit,
      });
      setSuccess(
        created?.duplicateQuestionCount
          ? `Mixed quiz created from AI history: ${created?.title || "Draft quiz"} (${created.questionCount} unique questions, ${created.duplicateQuestionCount} duplicates removed)`
          : `Mixed quiz created from AI history: ${created?.title || "Draft quiz"}`
      );
      setSelectedAiHistoryIds([]);
      triggerRefresh();
      if (created?.quizId) {
        navigate(`/quiz/${created.quizId}/edit`);
      }
    } catch (err) {
      setError(err.message || "Failed to create mixed quiz from AI history.");
    } finally {
      setCreatingFromHistoryId(null);
    }
  }

  async function handleCreateStudent(e) {
    e.preventDefault();
    if (!isManager) return;
    if (studentPassword !== studentPasswordConfirm) {
      setError("Password and confirm password do not match.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const created = await apiPost("/api/teacher/students", {
        userName: studentUserName.trim(),
        studentCode: studentCode.trim(),
        password: studentPassword,
      });
      setSuccess(`Student created: ${created.studentCode}`);
      setStudentUserName("");
      setStudentCode("");
      setStudentPassword("");
      setStudentPasswordConfirm("");
      triggerRefresh();
      setSearchParams({});
    } catch (err) {
      setError(err.message || "Failed to create student");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleAssignStudent(studentId) {
    setAssignSelected((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  }

  function toggleAssignSelectAll(checked) {
    if (checked) {
      setAssignSelected(assignStudents.map((s) => Number(s.studentId)));
      return;
    }
    setAssignSelected([]);
  }

  async function handleSaveAssignments(e) {
    e.preventDefault();
    if (!assignQuizId || !isManager) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await apiPut(`/api/quizzes/${assignQuizId}/assignments`, {
        studentIds: assignSelected,
      });
      setSuccess(
        `Assignments saved: ${result.assignedCount || 0} student(s). Auto-created classes: ${result.createdClasses || 0}.`
      );
      triggerRefresh();
    } catch (err) {
      setError(err.message || "Failed to save assignments");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportStudentsExcel(e) {
    e.preventDefault();
    if (!isManager) return;
    setError("");
    setSuccess("");
    setStudentsImportFailedRows([]);
    if (!studentsExcelFile) {
      setError("Please choose a students spreadsheet file (.xlsx, .xls, or .csv).");
      return;
    }
    if (!isAllowedSpreadsheetFile(studentsExcelFile)) {
      setError("Invalid file type. Only .xlsx, .xls, or .csv files are allowed.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", studentsExcelFile);
      const result = await apiUpload("/api/import/students", form);
      setStudentsImportFailedRows(Array.isArray(result.failedRows) ? result.failedRows : []);
      setSuccess(
        `Students import complete: ${result.importedStudents} imported, ${result.createdClasses || 0} class(es) created, ${result.duplicateUserNames || 0} duplicate user name(s), ${result.skippedRows} skipped row(s).`
      );
      setStudentsExcelFile(null);
      triggerRefresh();
    } catch (err) {
      const failedRows = Array.isArray(err?.payload?.failedRows) ? err.payload.failedRows : [];
      if (failedRows.length) setStudentsImportFailedRows(failedRows);
      setError(err.message || "Students import failed");
    } finally {
      setSubmitting(false);
    }
  }

  function escapeCsvCell(value) {
    let s = String(value ?? "");
    // Prevent CSV formula injection when opened in spreadsheet apps.
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, "\"\"")}"`;
    }
    return s;
  }

  function downloadStudentsTemplate() {
    const rows = [
      ["StudentCode", "UserName", "Password", "ClassName", "QuizLimit"],
      ["STD-001", "student1", "TempPass123", "Database Fundamentals", "40"],
      ["STD-002", "student2", "TempPass123", "Grade 12 Economics", "40"],
    ];
    const csv = rows.map((r) => r.map(escapeCsvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students_import_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadStudentsFailedRowsReport() {
    if (!studentsImportFailedRows.length) return;
    const header = ["RowNumber", "UserName", "StudentCode", "Reason"];
    const rows = studentsImportFailedRows.map((r) =>
      [r.rowNumber, r.userName, r.studentCode, r.reason].map(escapeCsvCell).join(",")
    );
    const csv = [header.map(escapeCsvCell).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students_import_failed_rows.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function cancel() {
    setSearchParams({});
    setError("");
  }

  function renderClassActionBackLinks(classId) {
    const normalizedClassId = Number(classId || 0);
    return (
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
        <button
          type="button"
          onClick={cancel}
          style={{ padding: 0, border: "none", background: "transparent", color: "#1d4ed8", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          {"< Back to Dashboard"}
        </button>
        {normalizedClassId > 0 ? (
          <button
            type="button"
            onClick={() => {
              setSearchParams({ classInfo: String(normalizedClassId) });
              setError("");
            }}
            style={{ padding: 0, border: "none", background: "transparent", color: "#1d4ed8", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            {"< Back to Class Details"}
          </button>
        ) : null}
      </div>
    );
  }

  const canCreateClass = !submitting && !!className.trim() && (!isManager || !!selectedStudentId);
  const canImportStudents = !submitting && !!studentsExcelFile;
  const canCreateStudent =
    !submitting &&
    !!studentCode.trim() &&
    !!studentUserName.trim() &&
    String(studentPassword || "").length >= 6 &&
    studentPassword === studentPasswordConfirm;
  const canSaveAssignments = !submitting;
  const maxMcqsPerQuiz = Math.max(1, Number(subscription?.maxMcqsPerQuiz || 20));
  const manualTotalQuestions =
    Number(manualMcqCount || 0) +
    Number(manualShortCount || 0) +
    Number(manualTrueFalseCount || 0) +
    Number(manualMixMatchCount || 0) +
    Number(manualLongCount || 0);
  const canCreateQuiz =
    !submitting &&
    !!quizTitle.trim() &&
    !!createQuizDisclaimerAccepted &&
    !!manualDisclaimer?.DisclaimerId &&
    manualTotalQuestions >= 1 &&
    manualTotalQuestions <= 25;
  const aiTotalQuestions =
    (aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiCount || 0)) +
    (aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiShortCount || 0)) +
    (aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiTrueFalseCount || 0)) +
    (aiAssessmentType === "ASSIGNMENT" ? 0 : Number(aiMixMatchCount || 0)) +
    Number(aiLongCount || 0);
  const canGenerateAi =
    !submitting &&
    !aiJobId &&
    !!aiCapability.canGenerate &&
    !(!isManager && subscription?.isStudentPostTrialLocked) &&
    !!aiDisclaimerAccepted &&
    !!aiDisclaimer?.DisclaimerId &&
    !!String(aiTopic || "").trim() &&
    aiTotalQuestions >= 1 &&
    aiTotalQuestions <= maxMcqsPerQuiz;
  const canImportQuizExcel = !submitting && !!excelFile && (!isManager || !!selectedStudentId);
  const canImportQuizExcelReady = canImportQuizExcel && !!importExcelDisclaimerAccepted && !!manualDisclaimer?.DisclaimerId;
  const aiProgressActive = submitting || !!aiJobId;
  const aiProgressStatus = submitting && !aiJobId ? "Starting" : (aiStatus || "Queued");
  const aiProgressPercent = (() => {
    const s = String(aiProgressStatus || "").toLowerCase();
    if (s.includes("starting")) return 18;
    if (s.includes("queued")) return 36;
    if (s.includes("processing") || s.includes("running")) return 72;
    if (s.includes("completed")) return 100;
    if (s.includes("failed")) return 100;
    return aiProgressActive ? 24 : 0;
  })();

  function getActionButtonStyle(enabled) {
    return {
      padding: "8px 16px",
      borderRadius: 8,
      border: "none",
      background: enabled ? "#16a34a" : "#9ca3af",
      color: "#fff",
      cursor: enabled ? "pointer" : "not-allowed",
      opacity: enabled ? 1 : 0.92,
    };
  }

  function getCreateClassDisabledReason() {
    if (submitting) return "Please wait for the current action to finish.";
    if (!className.trim()) return "Class name is required.";
    if (isManager && !selectedStudentId) return "Select a student in sidebar first.";
    return "";
  }

  function getImportStudentsDisabledReason() {
    if (submitting) return "Please wait for the current action to finish.";
    if (!studentsExcelFile) return "Please choose a students spreadsheet file (.xlsx, .xls, or .csv).";
    return "";
  }

  function getCreateStudentDisabledReason() {
    if (submitting) return "Please wait for the current action to finish.";
    if (!studentCode.trim()) return "Student code is required.";
    if (!studentUserName.trim()) return "UserName is required.";
    if (String(studentPassword || "").length < 6) return "Temporary password must be at least 6 characters.";
    if (studentPassword !== studentPasswordConfirm) return "Password and confirm password do not match.";
    return "";
  }

  function getSaveAssignmentsDisabledReason() {
    if (submitting) return "Please wait for the current action to finish.";
    return "";
  }

  function getCreateQuizDisabledReason() {
    if (submitting) return "Please wait for the current action to finish.";
    if (!quizTitle.trim()) return "Quiz title is required.";
    if (!createQuizDisclaimerAccepted) return "Please read and acknowledge the disclaimer before creating the quiz.";
    if (!manualDisclaimer?.DisclaimerId) return "Active manual disclaimer not found.";
    if (manualTotalQuestions < 1) return "Add at least 1 question.";
    if (manualTotalQuestions > 25) return "Total questions cannot exceed 25.";
    return "";
  }

  function getGenerateAiDisabledReason() {
    if (submitting) return "Please wait for the current action to finish.";
    if (aiJobId) return "An AI generation job is already running.";
    if (!aiCapability.canGenerate) return aiCapability.reason || "AI provider is not available.";
    if (!isManager && subscription?.isStudentPostTrialLocked) return "You have reached free AI practice limit. Upgrade to continue.";
    if (!aiDisclaimerAccepted) return "Please read and acknowledge the AI quiz disclaimer before generating.";
    if (!aiDisclaimer?.DisclaimerId) return "Active AI disclaimer not found.";
    if (!String(aiTopic || "").trim()) return "Please enter one focused topic.";
    if (aiAssessmentType === "ASSIGNMENT" && Number(aiLongCount || 0) < 1) return "Add at least 1 long assignment question.";
    if (aiAssessmentType === "ASSIGNMENT" && !String(aiAssignmentDeadline || "").trim()) return "Select assignment deadline date and time.";
    if (aiTotalQuestions < 1) return "Add at least 1 question.";
    if (aiTotalQuestions > maxMcqsPerQuiz) return `Maximum number of questions for your plan is ${maxMcqsPerQuiz}.`;
    return "";
  }

  function getImportQuizDisabledReason() {
    if (submitting) return "Please wait for the current action to finish.";
    if (isManager && !selectedStudentId) return "Select a student in sidebar first.";
    if (!excelFile) return "Please choose a spreadsheet file (.xlsx, .xls, or .csv).";
    if (!isAllowedSpreadsheetFile(excelFile)) return "Invalid file type. Only .xlsx, .xls, or .csv files are allowed.";
    if (!importExcelDisclaimerAccepted) return "Please read and acknowledge the manual quiz disclaimer before importing.";
    if (!manualDisclaimer?.DisclaimerId) return "Active manual disclaimer not found.";
    return "";
  }

  return (
    <PageShell width="xl" padded={false}>
      <div>
        {showDashboardHeader && (
          <SectionHeader
            eyebrow={isManager ? "Teaching Workspace" : "Student Workspace"}
            title="Dashboard"
            description={
              isManager
                ? "Manage classes, create quizzes, import content, and review classroom performance from one control center."
                : "Track your plan, continue assigned work, and access study tools that are available for your account."
            }
            actions={
              !isManager ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button type="button" variant="secondary" onClick={() => navigate("/assigned-quizzes")}>
                    Assigned Quizzes
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => navigate("/results")}>
                    My Results
                  </Button>
                </div>
              ) : null
            }
            style={{ marginBottom: "var(--space-5)" }}
          />
        )}

        {!isManager && subscription && (
          <Card tone="accent" padding="md" style={{ maxWidth: 860, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <StatusPill tone="accent">Plan: {subscription.planName || "Student"}</StatusPill>
              <StatusPill tone="success">Basic Analytics: Enabled</StatusPill>
              <StatusPill tone={subscription.advancedAnalyticsEnabled ? "success" : "warning"}>
                Advanced Analytics: {subscription.advancedAnalyticsEnabled ? "Enabled" : "Locked"}
              </StatusPill>
            </div>
            {!subscription.advancedAnalyticsEnabled && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Upgrade to Student Pro to unlock advanced analytics and saved history.
                </span>
                <Button type="button" variant="primary" onClick={() => navigate("/pricing")}>
                  Upgrade
                </Button>
              </div>
            )}
          </Card>
        )}

        {!isManager && subscription?.isStudentPostTrialLocked && (
          <InlineAlert tone="warning" style={{ maxWidth: 860, marginBottom: 24 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Free trial ended</div>
            <div style={{ marginBottom: 10 }}>
              You can still attempt teacher-assigned quizzes. AI Practice and advanced analytics are locked until you upgrade.
            </div>
            <Button
              type="button"
              variant="primary"
              onClick={() => navigate("/pricing")}
            >
              Upgrade
            </Button>
          </InlineAlert>
        )}

        {isManager && isOverviewMode && (
          <Card
            tone="subtle"
            padding="lg"
            style={{
              marginBottom: 24,
              borderRadius: 28,
              background: "linear-gradient(180deg, #fbfbff 0%, #f4f7ff 100%)",
              border: "1px solid #dbe4f3",
              boxShadow: "0 28px 60px rgba(15, 23, 42, 0.08)",
            }}
          >
            <SectionHeader
              eyebrow="Teacher Workspace"
              title="Dashboard"
              description="A cleaner overview of classes, students, quiz volume, and recent classroom movement."
              actions={
                <Button type="button" variant="secondary" onClick={() => navigate("/pricing")}>
                  {subscription?.planName || "Teacher Plan"}
                </Button>
              }
              style={{ marginBottom: "var(--space-5)" }}
            />

            <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 18 }}>Quick Actions</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "var(--space-4)",
                marginBottom: 28,
              }}
            >
              <Card padding="md" style={{ minHeight: 150 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSearchParams({ createClass: "1" })}
                  style={{ width: "100%", minHeight: 118, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: 0, border: "none", background: "transparent", boxShadow: "none", textAlign: "left" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <DashboardBadge label="CL" icon="classes" tint="#eef4ff" color="#2563eb" />
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 20 }}>
                      Create Class
                      <span style={{ padding: "2px 10px", borderRadius: 999, background: "#dbeafe", color: "#1d4ed8", fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
                        {managerMetrics.classes}
                      </span>
                    </span>
                  </span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                    Start a new class workspace before adding students or publishing quizzes.
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#1d4ed8" }}>
                    Open
                  </span>
                </Button>
              </Card>
              <Card padding="md" style={{ minHeight: 150 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSearchParams({ createStudent: "1" })}
                  style={{ width: "100%", minHeight: 118, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: 0, border: "none", background: "transparent", boxShadow: "none", textAlign: "left" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <DashboardBadge label="ST" icon="students" tint="#eefaf6" color="#0f766e" />
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 20 }}>
                      Add Student
                      <span style={{ padding: "2px 10px", borderRadius: 999, background: "#d1fae5", color: "#047857", fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
                        {managerMetrics.students}
                      </span>
                    </span>
                  </span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                    Create one student account now or switch to the bulk import workflow.
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#047857" }}>
                    Open
                  </span>
                </Button>
              </Card>
              <Card padding="md" style={{ minHeight: 150 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const resolvedClassId = quickActionClassId || (selectedClassInfo?.classId ? String(selectedClassInfo.classId) : "");
                    if (resolvedClassId) {
                      setSearchParams({ createQuiz: String(resolvedClassId) });
                    } else {
                      setError("Select a class to create a quiz.");
                    }
                  }}
                  style={{ width: "100%", minHeight: 118, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: 0, border: "none", background: "transparent", boxShadow: "none", textAlign: "left" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <DashboardBadge label="QZ" icon="quizzes" tint="#fff5e8" color="#c2410c" />
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 20 }}>
                      Create Quiz
                      <span style={{ padding: "2px 10px", borderRadius: 999, background: "#ffedd5", color: "#c2410c", fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
                        {managerMetrics.quizzes}
                      </span>
                    </span>
                  </span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                    Build a quiz for the selected class using manual, AI, or import workflows.
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#c2410c" }}>
                      Open
                    </span>
                    <select
                      value={quickActionClassId}
                      onChange={(e) => {
                        e.stopPropagation();
                        setQuickActionClassId(e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Select class for quiz"
                      style={{
                        minWidth: 170,
                        maxWidth: 220,
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid #fdba74",
                        background: "#fff7ed",
                        color: "#9a3412",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      <option value="">Select a class first</option>
                      {managerClassSummaries.map((classItem) => (
                        <option key={classItem.classId} value={classItem.classId}>
                          {classItem.className}
                        </option>
                      ))}
                    </select>
                  </span>
                </Button>
              </Card>
              <Card padding="md" style={{ minHeight: 150 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDashboardInfoTab("report")}
                  style={{ width: "100%", minHeight: 118, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: 0, border: "none", background: "transparent", boxShadow: "none", textAlign: "left" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <DashboardBadge label="RP" icon="reports" tint="#f2faf0" color="#4d7c0f" />
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 20 }}>
                      View Reports
                      <span style={{ padding: "2px 10px", borderRadius: 999, background: "#ecfccb", color: "#4d7c0f", fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
                        {managerRecentActivity.length}
                      </span>
                    </span>
                  </span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                    Jump into the teacher report panel with current quiz-performance data.
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#4d7c0f" }}>
                    Open
                  </span>
                </Button>
              </Card>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "var(--space-4)",
              }}
            >
              <Card padding="md" style={{ minHeight: 320 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>Recent Classes</div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDashboardInfoTab("classInfo")}>
                    View All
                  </Button>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {!managerClassSummaries.length && (
                    <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>No classes yet.</div>
                  )}
                  {managerClassSummaries.slice(0, 4).map((classItem) => (
                    <DashboardListItem
                      key={classItem.classId}
                      badgeLabel="CL"
                      badgeIcon="classes"
                      badgeTint="#eef4ff"
                      badgeColor="#2563eb"
                      title={classItem.className}
                      subtitle={`${classItem.studentCount ?? "-"} Students  ${classItem.quizCount} Quizzes`}
                      onClick={() => setSearchParams({ classInfo: String(classItem.classId) })}
                      actionLabel="Open"
                    />
                  ))}
                </div>
              </Card>

              <Card padding="md" style={{ minHeight: 320 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>Recent Students</div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSearchParams({ createStudent: "1" })}>
                    Add New
                  </Button>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {!managerStudentSummaries.length && (
                    <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>No student records loaded yet.</div>
                  )}
                  {managerStudentSummaries.map((student) => (
                    <DashboardListItem
                      key={student.studentId || student.studentCode}
                      badgeLabel="ST"
                      badgeIcon="students"
                      badgeTint="#eefaf6"
                      badgeColor="#0f766e"
                      title={student.userName || student.studentCode}
                      subtitle={student.studentCode}
                      actionLabel="Student"
                    />
                  ))}
                </div>
              </Card>

              <Card padding="md" style={{ minHeight: 320 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>Recent Activity</div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDashboardInfoTab("report")}>
                    View All
                  </Button>
                </div>
                <div style={{ display: "grid", gap: 12 }}>
                  {!managerRecentActivity.length && (
                    <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                      Activity will appear here after students submit quizzes.
                    </div>
                  )}
                  {managerRecentActivity.map((activity) => (
                    <DashboardListItem
                      key={activity.attemptId}
                      badgeLabel="AC"
                      badgeIcon="activity"
                      badgeTint="#fff5e8"
                      badgeColor="#c2410c"
                      title={`${activity.studentCode} scored ${activity.scorePercent}%`}
                      subtitle={`${activity.quizTitle} | ${activity.className} | ${activity.submittedAtUtc ? new Date(activity.submittedAtUtc).toLocaleString() : "Pending"}`}
                      actionLabel="Recent"
                    />
                  ))}
                </div>
              </Card>
            </div>
          </Card>
        )}

      {isManager && !createClass && !createStudent && !importStudents && !createQuizClassId && !manageQuizId && !assignQuizId && !generateAiClassId && !importExcelClassId && !aiHistoryClassId && (
        <Card tone="subtle" style={{ maxWidth: 1180, marginBottom: 24, padding: 20, borderRadius: 22, border: "1px solid #dde6f3" }}>
          <SectionHeader
            eyebrow="Workspace Details"
            title="Class Details"
            description={
              <>
                <button
                  type="button"
                  onClick={cancel}
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: "#1d4ed8",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    marginBottom: 10,
                  }}
                >
                  {"< Back to Dashboard"}
                </button>
                <div>Review class details, edit class metadata, and launch class-specific tools.</div>
              </>
            }
            actions={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDashboardInfoTab("classInfo")}
              >
                Class Information
                <sup style={{ marginLeft: 6, fontSize: 11, fontWeight: 800 }}>
                  {managerClassSummaries.length}
                </sup>
              </Button>
            }
            style={{ marginBottom: 10 }}
          />
          {dashboardInfoTab === "report" && (
            <>
              <form onSubmit={handleRunReport} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr auto", gap: 10, alignItems: "end" }}>
                <Field label="Class">
                  <select value={reportClassId} onChange={(e) => setReportClassId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}>
                    <option value="">All Classes</option>
                    {reportClassOptions.map((c) => (
                      <option key={c.classId} value={c.classId}>{c.className}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Student">
                  <select value={reportStudentId} onChange={(e) => setReportStudentId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}>
                    <option value="">All Students</option>
                    {reportStudentOptions.map((s) => (
                      <option key={s.studentId} value={s.studentId}>{s.studentCode} ({s.userName})</option>
                    ))}
                  </select>
                </Field>
                <Field label="Quiz">
                  <select value={reportQuizId} onChange={(e) => setReportQuizId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}>
                    <option value="">All Quizzes</option>
                    {reportQuizOptions.map((q) => (
                      <option key={`${q.quizId}-${q.classId}-${q.studentId}`} value={q.quizId}>{q.title}</option>
                    ))}
                  </select>
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  onClick={(e) => {
                    if (!reportLoading) return;
                    e.preventDefault();
                    setReportError("Report is already loading. Please wait.");
                  }}
                  style={{ height: 44 }}
                >
                  {reportLoading ? "Loading..." : "Submit"}
                </Button>
              </form>
              {reportError && <InlineAlert tone="danger" style={{ marginTop: 12 }}>{reportError}</InlineAlert>}

              {reportResult && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
                    {[
                      ["Attempts", reportResult.summary?.attemptsCount || 0],
                      ["Students", reportResult.summary?.studentsCount || 0],
                      ["Avg %", reportResult.summary?.avgScorePercent || 0],
                      ["Best %", reportResult.summary?.bestScorePercent || 0],
                      ["Worst %", reportResult.summary?.worstScorePercent || 0],
                    ].map(([label, value]) => (
                      <Card key={label} padding="sm" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginBottom: 4 }}>{label}</div>
                        <div style={{ fontWeight: 800, fontSize: 22 }}>{value}</div>
                      </Card>
                    ))}
                  </div>

                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "90px 180px 200px 220px 120px 170px", background: "#f8fafc", padding: "8px 10px", fontWeight: 700, fontSize: 13 }}>
                      <div>Attempt</div>
                      <div>Student</div>
                      <div>Class</div>
                      <div>Quiz</div>
                      <div>Score %</div>
                      <div>Submitted</div>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: "auto" }}>
                      {(reportResult.attempts || []).length === 0 && <div style={{ padding: 10, color: "#6b7280" }}>No report rows for selected filters.</div>}
                      {(reportResult.attempts || []).map((a) => (
                        <div key={a.attemptId} style={{ display: "grid", gridTemplateColumns: "90px 180px 200px 220px 120px 170px", padding: "8px 10px", borderTop: "1px solid #f1f5f9", fontSize: 13 }}>
                          <div>{a.attemptId}</div>
                          <div>{a.studentCode}</div>
                          <div>{a.className}</div>
                          <div>{a.quizTitle}</div>
                          <div>{a.scorePercent}%</div>
                          <div>{a.submittedAtUtc ? new Date(a.submittedAtUtc).toLocaleString() : "-"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {dashboardInfoTab === "classInfo" && (
            <>
              {!!reportClassOptionsRaw.length && (
                <FormActions style={{ marginBottom: 10, gap: 8 }}>
                  {reportClassOptionsRaw.map((classOption) => {
                    const isActive = Number(selectedClassInfo?.classId) === Number(classOption.classId);
                    return (
                      <Button
                        key={classOption.classId}
                        type="button"
                        onClick={() => setSearchParams({ classInfo: String(classOption.classId) })}
                        variant={isActive ? "primary" : "secondary"}
                        size="sm"
                      >
                        {classOption.className}
                      </Button>
                    );
                  })}
                </FormActions>
              )}
              {selectedClassInfo ? (
                <>
                  {isEditingClassInfo ? (
                    <Card tone="subtle" padding="md" style={{ marginBottom: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                        <Field label="Name">
                          <input value={editClassName} onChange={(e) => setEditClassName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                        </Field>
                        <Field label="Subject">
                          <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                        </Field>
                        <Field label="Grade Level">
                          <input value={editGradeLevel} onChange={(e) => setEditGradeLevel(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                        </Field>
                        <Field label="Course Code">
                          <input value={editCourseCode} onChange={(e) => setEditCourseCode(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                        </Field>
                        <Field label="Term">
                          <input value={editTerm} onChange={(e) => setEditTerm(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                        </Field>
                      </div>
                    </Card>
                  ) : (
                    <Card tone="subtle" padding="sm" style={{ marginBottom: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                        <div><div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 2 }}>Name</div><div style={{ fontWeight: 800 }}>{selectedClassInfo.className}</div></div>
                        {selectedClassInfo.subject && <div><div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 2 }}>Subject</div><div style={{ fontWeight: 700 }}>{selectedClassInfo.subject}</div></div>}
                        {selectedClassInfo.gradeLevel && <div><div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 2 }}>Grade Level</div><div style={{ fontWeight: 700 }}>{selectedClassInfo.gradeLevel}</div></div>}
                        {selectedClassInfo.courseCode && <div><div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 2 }}>Course Code</div><div style={{ fontWeight: 700 }}>{selectedClassInfo.courseCode}</div></div>}
                        {selectedClassInfo.term && <div><div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 2 }}>Term</div><div style={{ fontWeight: 700 }}>{selectedClassInfo.term}</div></div>}
                      </div>
                    </Card>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 10 }}>
                    {selectedClassInfo.joinCode && (
                      <Card
                        padding="sm"
                        style={{
                          background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                          border: "1px solid #e5e7eb",
                          minHeight: 78,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                        }}
                      >
                        <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 6 }}>Join Code</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 800, fontSize: 28, lineHeight: 1 }}>{selectedClassInfo.joinCode}</div>
                          <div style={{ width: 42, height: 42, borderRadius: 14, background: "#eef4ff", color: "#2563eb", display: "grid", placeItems: "center", fontWeight: 800 }}>JC</div>
                        </div>
                      </Card>
                    )}
                    <Card
                      padding="sm"
                      style={{
                        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                        border: "1px solid #e5e7eb",
                        minHeight: 78,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                      }}
                    >
                      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 6 }}>Total Quizzes</div>
                      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontWeight: 800, fontSize: 28, lineHeight: 1 }}>{Array.isArray(selectedClassInfo.quizzes) ? selectedClassInfo.quizzes.length : 0}</div>
                        <div style={{ display: "flex", alignItems: "end", gap: 6, height: 40 }}>
                          <div style={{ width: 18, height: 12, borderRadius: 3, background: "#dbeafe" }} />
                          <div style={{ width: 18, height: 24, borderRadius: 3, background: "#bfdbfe" }} />
                          <div style={{ width: 18, height: 34, borderRadius: 3, background: "#93c5fd" }} />
                          <div style={{ width: 18, height: 40, borderRadius: 3, background: "#60a5fa" }} />
                        </div>
                      </div>
                    </Card>
                    <Card
                      padding="sm"
                      style={{
                        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                        border: "1px solid #e5e7eb",
                        minHeight: 78,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                      }}
                    >
                      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 6 }}>Students In Class</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontWeight: 800, fontSize: 28, lineHeight: 1 }}>{classStudents.length}</div>
                        <div style={{ width: 42, height: 42, borderRadius: 999, background: "#eef4ff", color: "#2563eb", display: "grid", placeItems: "center", fontWeight: 800 }}>ST</div>
                      </div>
                    </Card>
                  </div>

                  <FormActions style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                    {!isEditingClassInfo ? (
                      <Button
                        type="button"
                        onClick={() => setIsEditingClassInfo(true)}
                        variant="primary"
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <ActionIcon type="edit" />
                        Edit Class
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          onClick={handleSaveClassInfo}
                          disabled={submitting}
                          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                        >
                          <ActionIcon type="edit" />
                          {submitting ? "Saving..." : "Save Class"}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => {
                            setIsEditingClassInfo(false);
                            setEditClassName(String(selectedClassInfo?.className || ""));
                            setEditSubject(String(selectedClassInfo?.subject || ""));
                            setEditGradeLevel(String(selectedClassInfo?.gradeLevel || ""));
                            setEditCourseCode(String(selectedClassInfo?.courseCode || ""));
                            setEditTerm(String(selectedClassInfo?.term || ""));
                          }}
                          variant="secondary"
                          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                        >
                          <ActionIcon type="history" />
                          Cancel Edit
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      onClick={() => setSearchParams({ generateAi: String(selectedClassInfo.classId) })}
                      variant="secondary"
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                    >
                      <ActionIcon type="quiz" />
                      Create Quiz
                    </Button>
                    <Button
                      type="button"
                      onClick={() => navigate(`/study-tools/create?classId=${selectedClassInfo.classId}`)}
                      variant="secondary"
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                    >
                      <ActionIcon type="notes" />
                      Notes / Flash Cards
                    </Button>
                    <Button
                      type="button"
                      onClick={() => navigate(`/study-tools?classId=${selectedClassInfo.classId}`)}
                      variant="secondary"
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                    >
                      <ActionIcon type="history" />
                      Previous Flash Cards
                    </Button>
                    {(selectedClassInfo.quizzes || []).length > 5 && (
                      <Button
                        type="button"
                        onClick={() => setSearchParams({ aiHistory: String(selectedClassInfo.classId) })}
                        variant="secondary"
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                      >
                        <ActionIcon type="ai" />
                        Create From AI History
                      </Button>
                    )}
                  </FormActions>

                  {!!selectedClassInfo.quizzes?.length && (
                    <Card padding="md" style={{ marginBottom: 12, border: "1px solid #e5e7eb" }}>
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 18, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 24 }}>Class Quizzes</div>
                          <StatusPill tone="neutral">{`${selectedClassInfo.quizzes.length} Quizzes`}</StatusPill>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, flexWrap: "wrap", flex: 1 }}>
                          <button
                            type="button"
                            disabled={!selectedClassQuiz}
                            onClick={() => selectedClassQuiz && handleCreateNewDraftFromQuiz(selectedClassQuiz.quizId)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid #dbe4f3",
                              background: selectedClassQuiz ? "#fff" : "#f8fafc",
                              color: selectedClassQuiz ? "#0f172a" : "#94a3b8",
                              cursor: selectedClassQuiz ? "pointer" : "not-allowed",
                              fontWeight: 700,
                            }}
                          >
                            New Draft
                          </button>
                          <button
                            type="button"
                            disabled={!selectedClassQuiz}
                            onClick={() => selectedClassQuiz && navigate(`/quiz/${selectedClassQuiz.quizId}/edit`)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid #dbe4f3",
                              background: selectedClassQuiz ? "#fff" : "#f8fafc",
                              color: selectedClassQuiz ? "#0f172a" : "#94a3b8",
                              cursor: selectedClassQuiz ? "pointer" : "not-allowed",
                              fontWeight: 700,
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={!selectedClassQuiz}
                            onClick={() => selectedClassQuiz && setSearchParams({ assignQuiz: String(selectedClassQuiz.quizId) })}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid #dbe4f3",
                              background: selectedClassQuiz ? "#fff" : "#f8fafc",
                              color: selectedClassQuiz ? "#0f172a" : "#94a3b8",
                              cursor: selectedClassQuiz ? "pointer" : "not-allowed",
                              fontWeight: 700,
                            }}
                          >
                            Assign
                          </button>
                          <button
                            type="button"
                            disabled={!selectedClassQuiz}
                            onClick={() => selectedClassQuiz && handleUpdateQuizTimeLimit(selectedClassQuiz)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid #dbe4f3",
                              background: selectedClassQuiz ? "#fff" : "#f8fafc",
                              color: selectedClassQuiz ? "#0f172a" : "#94a3b8",
                              cursor: selectedClassQuiz ? "pointer" : "not-allowed",
                              fontWeight: 700,
                            }}
                          >
                            Time
                          </button>
                          <button
                            type="button"
                            disabled={!selectedClassQuiz}
                            onClick={() => selectedClassQuiz && handleDeleteQuizFromClass(selectedClassQuiz)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid #fecaca",
                              background: selectedClassQuiz ? "#fff" : "#f8fafc",
                              color: selectedClassQuiz ? "#dc2626" : "#fca5a5",
                              cursor: selectedClassQuiz ? "pointer" : "not-allowed",
                              fontWeight: 700,
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        <div style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, marginLeft: "auto" }}>All Task</div>
                      </div>
                      <div style={{ maxHeight: 300, overflowY: "auto" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 10 }}>
                          {selectedClassInfo.quizzes.map((q) => (
                            <button
                              key={q.quizId}
                              type="button"
                              onClick={() => {
                                const quizStatus = String(q.status || "").toUpperCase();
                                if (quizStatus === "DRAFT") {
                                  navigate(`/quiz/${q.quizId}/edit`);
                                  return;
                                }
                                navigate(`/quiz/${q.quizId}`);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "10px 8px",
                                borderBottom: "1px solid #f1f5f9",
                                position: "relative",
                                borderRadius: 12,
                                background: Number(selectedClassQuizId) === Number(q.quizId) ? "#f8fbff" : "transparent",
                                border: "1px solid transparent",
                                textAlign: "left",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="radio"
                                name="selected-class-quiz"
                                checked={Number(selectedClassQuizId) === Number(q.quizId)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setSelectedClassQuizId(Number(q.quizId));
                                  setClassQuizMenuId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${q.title}`}
                              />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 800, lineHeight: 1.35 }}>
                                  {q.title}
                                  {` (${Number(q.questionCount || 0)} Q)`}
                                  {q.status === "Draft" ? " [Draft]" : ""}
                                </div>
                                <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                                  {q.isAssigned ? "Assigned" : "Not assigned"}
                                  {` | `}
                                  {Number(q.timeLimitMinutes || 0) > 0 ? `${Number(q.timeLimitMinutes || 0)} min` : "No timer"}
                                  {q.createDate ? ` | Created: ${new Date(q.createDate).toLocaleString()}` : ""}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </Card>
                  )}

                  <Card padding="md" style={{ border: "1px solid #e5e7eb", maxHeight: 260, overflowY: "auto" }}>
                    <div style={{ fontWeight: 800, marginBottom: 10 }}>Students In This Class</div>
                    <div>
                      {!classStudents.length && <div style={{ color: "#6b7280" }}>No students linked to this class.</div>}
                      {classStudents.map((s) => (
                        <div key={s.studentId} style={{ padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
                          <b>{s.studentCode}</b> ({s.userName}) {s.isActive ? "" : "[Inactive]"}
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              ) : (
                <InlineAlert tone="info">
                  Select a class in the sidebar to view class information.
                </InlineAlert>
              )}
            </>
          )}
        </Card>
      )}

      {createClass && (
        <FormSection
          title="Create Class"
          style={{ maxWidth: 640, marginBottom: 24 }}
          description={
            <button
              type="button"
              onClick={cancel}
              style={{
                padding: 0,
                border: "none",
                background: "transparent",
                color: "#1d4ed8",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {"< Back to Dashboard"}
            </button>
          }
        >
          <form onSubmit={handleCreateClass}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <input
                placeholder="Class name"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                required
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={showClassNameOnExport} onChange={(e) => setShowClassNameOnExport(e.target.checked)} />
                Show on exported PDF
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <input
                placeholder="Subject (optional)"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={showSubjectOnExport} onChange={(e) => setShowSubjectOnExport(e.target.checked)} />
                Show on exported PDF
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <input
                placeholder="Grade level (optional)"
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={showGradeLevelOnExport} onChange={(e) => setShowGradeLevelOnExport(e.target.checked)} />
                Show on exported PDF
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <input
                placeholder="Course code (optional)"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={showCourseCodeOnExport} onChange={(e) => setShowCourseCodeOnExport(e.target.checked)} />
                Show on exported PDF
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <input
                placeholder="Term (optional)"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={showTermOnExport} onChange={(e) => setShowTermOnExport(e.target.checked)} />
                Show on exported PDF
              </label>
            </div>
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <FormActions>
              <Button
                type="submit"
                onClick={(e) => {
                  const reason = getCreateClassDisabledReason();
                  if (!reason) return;
                  e.preventDefault();
                  setError(reason);
                }}
                variant="primary"
                style={getActionButtonStyle(canCreateClass)}
              >
                {submitting ? "Creating..." : "Create"}
              </Button>
              <Button type="button" onClick={cancel} variant="secondary">
                Cancel
              </Button>
            </FormActions>
          </form>
        </FormSection>
      )}

      {importStudents && isManager && (
        <FormSection title="Import Students (Excel)" style={{ maxWidth: 560, marginBottom: 24 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6b7280" }}>
            Required columns: <b>StudentCode</b>, <b>UserName</b>, <b>Password</b>, <b>ClassName</b>. Optional: <b>QuizLimit</b>.
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6b7280" }}>
            <b>ClassName must already exist</b> (create class first). Unknown class names will be rejected.
          </p>
          <Button
            type="button"
            onClick={downloadStudentsTemplate}
            variant="secondary"
            size="sm"
            style={{ marginBottom: 10 }}
          >
            Download Template
          </Button>
          <form onSubmit={handleImportStudentsExcel}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f && !isAllowedSpreadsheetFile(f)) {
                  setStudentsExcelFile(null);
                  setError("Invalid file type. Only .xlsx, .xls, or .csv files are allowed.");
                  e.target.value = "";
                  return;
                }
                setStudentsExcelFile(f);
              }}
              style={{ marginBottom: 10 }}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <FormActions>
              <Button
                type="submit"
                onClick={(e) => {
                  const reason = getImportStudentsDisabledReason();
                  if (!reason) return;
                  e.preventDefault();
                  setError(reason);
                }}
                variant="primary"
                style={{ ...getActionButtonStyle(canImportStudents), padding: "8px 14px" }}
              >
                {submitting ? "Importing..." : "Import Students"}
              </Button>
              {!!studentsImportFailedRows.length && (
                <Button
                  type="button"
                  onClick={downloadStudentsFailedRowsReport}
                  variant="secondary"
                >
                  Download Failed Rows Report
                </Button>
              )}
              <Button type="button" onClick={cancel} variant="secondary">
                Close
              </Button>
            </FormActions>
          </form>
        </FormSection>
      )}

      {createStudent && isManager && (
        <FormSection
          title="Create Student"
          description={
            <>
              <button
                type="button"
                onClick={cancel}
                style={{
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: "#1d4ed8",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                {"< Back to Dashboard"}
              </button>
              <div>Create a student account with a code, username, and temporary password.</div>
            </>
          }
          style={{ maxWidth: 420, marginBottom: 24 }}
        >
          <form onSubmit={handleCreateStudent}>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="Student code">
                <input
                  placeholder="Student code"
                  value={studentCode}
                  onChange={(e) => setStudentCode(e.target.value)}
                  required
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                />
              </Field>
              <Field label="Username">
                <input
                  placeholder="UserName"
                  value={studentUserName}
                  onChange={(e) => setStudentUserName(e.target.value)}
                  required
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                />
              </Field>
              <Field label="Temporary password" hint="Use at least 6 characters.">
                <input
                  placeholder="Temporary password"
                  type="password"
                  minLength={6}
                  value={studentPassword}
                  onChange={(e) => setStudentPassword(e.target.value)}
                  required
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                />
              </Field>
              <Field label="Confirm password">
                <input
                  placeholder="Confirm password"
                  type="password"
                  minLength={6}
                  value={studentPasswordConfirm}
                  onChange={(e) => setStudentPasswordConfirm(e.target.value)}
                  required
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                />
              </Field>
            </div>
            {error && <InlineAlert tone="danger" style={{ marginTop: 12 }}>{error}</InlineAlert>}
            {success && <InlineAlert tone="success" style={{ marginTop: 12 }}>{success}</InlineAlert>}
            <FormActions style={{ marginTop: 14 }}>
              <Button
                type="submit"
                onClick={(e) => {
                  const reason = getCreateStudentDisabledReason();
                  if (!reason) return;
                  e.preventDefault();
                  setError(reason);
                }}
                variant="primary"
                style={getActionButtonStyle(canCreateStudent)}
              >
                {submitting ? "Creating..." : "Create Student"}
              </Button>
              <Button type="button" onClick={cancel} variant="secondary">
                Cancel
              </Button>
            </FormActions>
          </form>
        </FormSection>
      )}

      {assignQuizId && isManager && (
        <FormSection title="Assign Students To Quiz" style={{ maxWidth: 760, marginBottom: 24 }}>
          {assignQuizTitle && (
            <p style={{ marginTop: 0, marginBottom: 14, color: "#4b5563" }}>
              Quiz: <b>{assignQuizTitle}</b>
            </p>
          )}
          <form onSubmit={handleSaveAssignments}>
            <Field label="Class" style={{ marginBottom: 12 }}>
              <select
                value={assignClassName}
                onChange={(e) => setAssignClassName(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
              >
                <option value="">All Classes</option>
                {assignClassOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={assignStudents.length > 0 && assignSelected.length === assignStudents.length}
                onChange={(e) => toggleAssignSelectAll(e.target.checked)}
              />
              Select All
            </label>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, maxHeight: 340, overflowY: "auto", marginBottom: 12 }}>
              {!assignStudents.length && <div style={{ color: "#6b7280" }}>No students found for this teacher.</div>}
              {assignStudents.map((s) => (
                <label
                  key={s.studentId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 6px",
                    borderBottom: "1px solid #f1f5f9",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={assignSelected.includes(Number(s.studentId))}
                    onChange={() => toggleAssignStudent(Number(s.studentId))}
                  />
                  <span>
                    <b>{s.studentCode}</b> ({s.userName})
                  </span>
                </label>
              ))}
            </div>

            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            {success && <InlineAlert tone="success">{success}</InlineAlert>}
            <FormActions style={{ marginTop: 12 }}>
              <Button
                type="submit"
                onClick={(e) => {
                  const reason = getSaveAssignmentsDisabledReason();
                  if (!reason) return;
                  e.preventDefault();
                  setError(reason);
                }}
                variant="primary"
                style={getActionButtonStyle(canSaveAssignments)}
              >
                {submitting ? "Saving..." : "Save Assignments"}
              </Button>
              <Button type="button" onClick={cancel} variant="secondary">
                Close
              </Button>
            </FormActions>
          </form>
        </FormSection>
      )}

      {activeQuizBuilderClassId && (
        <Card style={{ maxWidth: 760, marginBottom: 14, padding: 10 }}>
          <FormActions style={{ gap: 8 }}>
            <Button
              type="button"
              onClick={() => setSearchParams({ createQuiz: String(activeQuizBuilderClassId) })}
              variant={createQuizClassId ? "primary" : "ghost"}
              size="sm"
            >
              {ti18n("createQuiz.tab_manual", "Create Quiz")}
            </Button>
            <Button
              type="button"
              onClick={() => setSearchParams({ generateAi: String(activeQuizBuilderClassId) })}
              variant={generateAiClassId ? "primary" : "ghost"}
              size="sm"
            >
              {`${ti18n("createQuiz.tab_ai", "Generate AI Quiz")} (${aiTotalQuestions})`}
            </Button>
            <Button
              type="button"
              onClick={() => setSearchParams({ importExcel: String(activeQuizBuilderClassId) })}
              variant={importExcelClassId ? "primary" : "ghost"}
              size="sm"
            >
              {ti18n("createQuiz.tab_import", "Import Excel Quiz")}
            </Button>
          </FormActions>
        </Card>
      )}

      {createQuizClassId && (
        <div style={{ maxWidth: 760, marginBottom: 24, padding: 24, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          {renderClassActionBackLinks(createQuizClassId)}
          <h3 style={{ marginTop: 0 }}>{ti18n("createQuiz.title", "Create Quiz")}</h3>
          <form onSubmit={handleCreateQuiz} style={{ display: "grid", gap: 18 }}>
            <input
              placeholder="Quiz title"
              value={quizTitle}
              onChange={(e) => setQuizTitle(e.target.value)}
              required
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <textarea
              placeholder="Description (optional)"
              value={quizDescription}
              onChange={(e) => setQuizDescription(e.target.value)}
              rows={2}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <div style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 10, color: "#374151" }}>Question Mix</div>
              <QuestionMixMatrix
                maxTotal={25}
                footer={`Total questions: ${manualTotalQuestions} / 25`}
                items={[
                  {
                    key: "mcq",
                    label: "MCQ",
                    count: manualMcqCount,
                    difficulty: manualMcqDifficulty,
                    onCountChange: (value) => {
                      const v = Math.max(0, Math.min(25, Number(value || 0)));
                      const short = Number(manualShortCount || 0);
                      const tf = Number(manualTrueFalseCount || 0);
                      const mixMatch = Number(manualMixMatchCount || 0);
                      const long = Number(manualLongCount || 0);
                      const safe = Math.min(v, Math.max(0, 25 - short - tf - mixMatch - long));
                      setManualMcqCount(safe);
                    },
                    onDifficultyChange: setManualMcqDifficulty,
                  },
                  {
                    key: "short",
                    label: "Short",
                    count: manualShortCount,
                    difficulty: manualShortDifficulty,
                    onCountChange: (value) => {
                      const v = Math.max(0, Math.min(25, Number(value || 0)));
                      const mcq = Number(manualMcqCount || 0);
                      const tf = Number(manualTrueFalseCount || 0);
                      const mixMatch = Number(manualMixMatchCount || 0);
                      const long = Number(manualLongCount || 0);
                      const safe = Math.min(v, Math.max(0, 25 - mcq - tf - mixMatch - long));
                      setManualShortCount(safe);
                    },
                    onDifficultyChange: setManualShortDifficulty,
                  },
                  {
                    key: "tf",
                    label: "True / False",
                    count: manualTrueFalseCount,
                    difficulty: manualTrueFalseDifficulty,
                    onCountChange: (value) => {
                      const v = Math.max(0, Math.min(25, Number(value || 0)));
                      const mcq = Number(manualMcqCount || 0);
                      const short = Number(manualShortCount || 0);
                      const mixMatch = Number(manualMixMatchCount || 0);
                      const long = Number(manualLongCount || 0);
                      const safe = Math.min(v, Math.max(0, 25 - mcq - short - mixMatch - long));
                      setManualTrueFalseCount(safe);
                    },
                    onDifficultyChange: setManualTrueFalseDifficulty,
                  },
                  {
                    key: "mix-match",
                    label: "Mix Match",
                    count: manualMixMatchCount,
                    difficulty: manualMixMatchDifficulty,
                    onCountChange: (value) => {
                      const v = Math.max(0, Math.min(25, Number(value || 0)));
                      const mcq = Number(manualMcqCount || 0);
                      const short = Number(manualShortCount || 0);
                      const tf = Number(manualTrueFalseCount || 0);
                      const long = Number(manualLongCount || 0);
                      const safe = Math.min(v, Math.max(0, 25 - mcq - short - tf - long));
                      setManualMixMatchCount(safe);
                    },
                    onDifficultyChange: setManualMixMatchDifficulty,
                  },
                  {
                    key: "long",
                    label: "Long",
                    count: manualLongCount,
                    difficulty: manualLongDifficulty,
                    onCountChange: (value) => {
                      const v = Math.max(0, Math.min(5, Number(value || 0)));
                      const mcq = Number(manualMcqCount || 0);
                      const short = Number(manualShortCount || 0);
                      const tf = Number(manualTrueFalseCount || 0);
                      const mixMatch = Number(manualMixMatchCount || 0);
                      const safe = Math.min(v, Math.max(0, 25 - mcq - short - tf - mixMatch));
                      setManualLongCount(safe);
                    },
                    onDifficultyChange: setManualLongDifficulty,
                  },
                ]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                  Attempts Allowed
                </label>
                <select
                  value={manualAttemptLimit}
                  onChange={(e) => setManualAttemptLimit(Number(e.target.value))}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                  Time Limits (minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={manualTimeLimitMinutes}
                  onChange={(e) => {
                    const n = Number(e.target.value || 0);
                    if (!Number.isFinite(n)) return setManualTimeLimitMinutes(0);
                    setManualTimeLimitMinutes(Math.min(300, Math.max(0, Math.trunc(n))));
                  }}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                  Set `0` for no timer.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "end" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, minHeight: 42, width: "100%" }}>
                  <input
                    type="checkbox"
                    checked={manualRevealAnswersAfterSubmit}
                    onChange={(e) => setManualRevealAnswersAfterSubmit(e.target.checked)}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Reveal answers after submit</span>
                </label>
              </div>
            </div>

            <DisclaimerPanel
              title={manualDisclaimer?.Title || "Manual Quiz Disclaimer"}
              text={manualDisclaimer?.DisclaimerText || "Loading disclaimer..."}
              checked={createQuizDisclaimerAccepted}
              onChange={setCreateQuizDisclaimerAccepted}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
              <button
                type="submit"
                onClick={(e) => {
                  const reason = getCreateQuizDisabledReason();
                  if (!reason) return;
                  e.preventDefault();
                  setError(reason);
                }}
                style={getActionButtonStyle(canCreateQuiz)}
              >
                {submitting ? ti18n("common.loading", "Loading...") : ti18n("createQuiz.btn_create", "Create")}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {generateAiClassId && (
        <div style={{ maxWidth: 760, marginBottom: 24, padding: 24, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          {renderClassActionBackLinks(generateAiClassId)}
          <h3 style={{ marginTop: 0 }}>{aiAssessmentType === "ASSIGNMENT" ? "Generate Assignment With AI" : "Generate Quiz With AI"}</h3>
          <form onSubmit={handleGenerateAiQuiz} style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                  AI Content Type
                </label>
                <select
                  value={aiAssessmentType}
                  onChange={(e) => {
                    const nextType = String(e.target.value || "QUIZ").toUpperCase() === "ASSIGNMENT" ? "ASSIGNMENT" : "QUIZ";
                    setAiAssessmentType(nextType);
                    if (nextType === "ASSIGNMENT") {
                      setAiCount(0);
                      setAiShortCount(0);
                      setAiTrueFalseCount(0);
                      setAiMixMatchCount(0);
                      setAiLongCount((prev) => Math.max(1, Math.min(5, Number(prev || 3))));
                    }
                  }}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                >
                  <option value="QUIZ">{ti18n("createQuiz.tab_manual", "Create Quiz")} (mixed question types)</option>
                  <option value="ASSIGNMENT">Assignment (long questions only)</option>
                </select>
              </div>
              {aiAssessmentType === "ASSIGNMENT" && (
                <>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                      Deadline (date & time)
                    </label>
                    <input
                      type="datetime-local"
                      value={aiAssignmentDeadline}
                      onChange={(e) => setAiAssignmentDeadline(e.target.value)}
                      style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                    />
                    <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                      Uses your local timezone.
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                      Total Marks (optional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={aiAssignmentTotalMarks}
                      onChange={(e) => setAiAssignmentTotalMarks(e.target.value)}
                      style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                      Weight % (optional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={aiAssignmentWeightPercent}
                      onChange={(e) => setAiAssignmentWeightPercent(e.target.value)}
                      style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                    />
                  </div>
                </>
              )}
            </div>
            <div>
              <input
                placeholder="Topic (e.g., Database normalization)"
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                maxLength={120}
                required
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <p style={{ color: "#6b7280", fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                Enter one focused topic only (example: Trigonometric Functions).
              </p>
            </div>

            <div style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 14, background: "#fbfdff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#374151" }}>{ti18n("upload.title", "Upload Course Outline")} (Optional)</div>
                  <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                    {aiReferenceSource === "document"
                      ? ti18n("upload.rules_summary", "Supported: PDF, DOCX, TXT. Max 10 MB.")
                      : `${String(aiPastedReferenceText || "").length} / 20000 characters`}
                  </div>
                  {!!courseOutlineDocumentName && (
                    <div style={{ marginTop: 4, color: "#374151", fontSize: 12 }}>
                      Current: <b>{courseOutlineDocumentName}</b>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAiReferenceSource("document");
                      setShowCourseOutlineModal(true);
                    }}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 10,
                      border: "1px solid #2563eb",
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Upload Document
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAiReferenceSource("text");
                      setShowCourseOutlineModal(true);
                    }}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 10,
                      border: "1px solid #2563eb",
                      background: "#ffffff",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Copy / Paste Text
                  </button>
                </div>
              </div>
            </div>

            {showCourseOutlineModal && (
              <div
                onClick={() => setShowCourseOutlineModal(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(15,23,42,0.45)",
                  zIndex: 70,
                  display: "grid",
                  placeItems: "center",
                  padding: 18,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "min(760px, 96vw)",
                    maxHeight: "88vh",
                    overflowY: "auto",
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, color: "#374151" }}>{ti18n("upload.title", "Upload Course Outline")} (Optional)</div>
                    <button
                      type="button"
                      onClick={() => setShowCourseOutlineModal(false)}
                      style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
                    >
                      Close
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setAiReferenceSource("document");
                        setCourseOutlineError("");
                      }}
                      style={{
                        padding: "7px 12px",
                        borderRadius: 999,
                        border: aiReferenceSource === "document" ? "1px solid #2563eb" : "1px solid #d1d5db",
                        background: aiReferenceSource === "document" ? "#eff6ff" : "#fff",
                        color: aiReferenceSource === "document" ? "#1d4ed8" : "#374151",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Use Document
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAiReferenceSource("text");
                        setCourseOutlineError("");
                        setCourseOutlineFile(null);
                        setCourseOutlineDocumentId(null);
                        setCourseOutlineDocumentName("");
                        setCourseOutlineStatus("");
                        setCourseOutlineWarnings([]);
                      }}
                      style={{
                        padding: "7px 12px",
                        borderRadius: 999,
                        border: aiReferenceSource === "text" ? "1px solid #2563eb" : "1px solid #d1d5db",
                        background: aiReferenceSource === "text" ? "#eff6ff" : "#fff",
                        color: aiReferenceSource === "text" ? "#1d4ed8" : "#374151",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Copy / Paste Text
                    </button>
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 10 }}>
                    {aiReferenceSource === "document"
                      ? ti18n("upload.rules_summary", "Supported: PDF, DOCX, TXT. Max 10 MB.")
                      : "Paste relevant course outline/reference text (max 20,000 characters)."}
                  </div>
                  {aiReferenceSource === "document" ? (
                    <>
                      <div style={{ marginBottom: 10 }}>
                        <select
                          value={courseOutlineDocumentId || ""}
                          onChange={(e) => {
                            const nextId = Number(e.target.value || 0) || null;
                            if (!nextId) {
                              setCourseOutlineDocumentId(null);
                              setCourseOutlineDocumentName("");
                              setCourseOutlineStatus("");
                              setCourseOutlineWarnings([]);
                              return;
                            }
                            const selectedDoc = (courseOutlineDocuments || []).find((doc) => Number(doc.documentId) === nextId);
                            setCourseOutlineFile(null);
                            setCourseOutlineDocumentId(nextId);
                            setCourseOutlineDocumentName(String(selectedDoc?.originalFileName || ""));
                            setCourseOutlineStatus("Extracted");
                            setCourseOutlineWarnings(Array.isArray(selectedDoc?.warningCodes) ? selectedDoc.warningCodes : []);
                            setCourseOutlineError("");
                          }}
                          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff" }}
                        >
                          <option value="">Select existing document (optional)</option>
                          {(courseOutlineDocuments || []).map((doc) => (
                            <option key={doc.documentId} value={doc.documentId}>
                              {doc.originalFileName} {doc.courseCode ? `(${doc.courseCode})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                          onChange={(e) => {
                            setCourseOutlineFile(e.target.files?.[0] || null);
                            setCourseOutlineError("");
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (courseOutlineBusy) {
                              setCourseOutlineError("Upload is already in progress. Please wait.");
                              return;
                            }
                            if (!courseOutlineFile) {
                              setCourseOutlineError("Please choose a PDF, DOCX, or TXT file first.");
                              return;
                            }
                            handleUploadCourseOutline();
                          }}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            cursor: !courseOutlineFile || courseOutlineBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          {courseOutlineBusy ? "Uploading..." : "Upload"}
                        </button>
                        {courseOutlineDocumentId && (
                          <button
                            type="button"
                            onClick={() => {
                              if (courseOutlineBusy) {
                                setCourseOutlineError("Please wait for upload processing to finish before removing.");
                                return;
                              }
                              handleRemoveCourseOutline();
                            }}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #fecaca",
                              background: "#fff1f2",
                              color: "#be123c",
                              cursor: courseOutlineBusy ? "not-allowed" : "pointer",
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {(courseOutlineFile || courseOutlineDocumentName) && (
                        <div style={{ marginTop: 8, color: "#374151", fontSize: 12 }}>
                          File: <b>{courseOutlineFile?.name || courseOutlineDocumentName}</b>
                          {courseOutlineFile ? ` (${Math.round((Number(courseOutlineFile.size || 0) / 1024) * 10) / 10} KB)` : ""}
                        </div>
                      )}
                      {courseOutlineDocumentId && (
                        <div style={{ marginTop: 8, color: "#374151", fontSize: 12 }}>
                          Status: <b>{courseOutlineStatus || "Uploaded"}</b> | Document ID: {courseOutlineDocumentId}
                        </div>
                      )}
                      {!!courseOutlineWarnings.length && (
                        <div style={{ marginTop: 8, color: "#92400e", fontSize: 12 }}>
                          Warnings: {courseOutlineWarnings.join(", ")}
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <textarea
                        value={aiPastedReferenceText}
                        onChange={(e) => setAiPastedReferenceText(String(e.target.value || "").slice(0, 20000))}
                        rows={8}
                        placeholder="Paste course outline or reference text here..."
                        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 8, padding: 10, resize: "vertical", background: "#fff" }}
                      />
                      <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12 }}>
                        {String(aiPastedReferenceText || "").length} / 20000 characters
                      </div>
                    </div>
                  )}
                  {!!courseOutlineError && (
                    <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>
                      {courseOutlineError}
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setShowCourseOutlineModal(false)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCourseOutlineError("");
                        setShowCourseOutlineModal(false);
                      }}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #2563eb",
                        background: "#2563eb",
                        color: "#fff",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}

            <DisclaimerPanel
              title={aiDisclaimer?.Title || "AI Generated Quiz Disclaimer"}
              text={aiDisclaimer?.DisclaimerText || "Loading disclaimer..."}
              checked={aiDisclaimerAccepted}
              onChange={setAiDisclaimerAccepted}
            />

            <div style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 10, color: "#374151" }}>
                {aiAssessmentType === "ASSIGNMENT" ? "Assignment Questions" : "Question Mix"}
              </div>
              <QuestionMixMatrix
                maxTotal={maxMcqsPerQuiz}
                footer={`Total questions: ${aiTotalQuestions} / ${maxMcqsPerQuiz}`}
                items={aiAssessmentType === "ASSIGNMENT" ? [
                  {
                    key: "long",
                    label: "Long",
                    count: aiLongCount,
                    difficulty: aiLongDifficulty,
                    onCountChange: (value) => {
                      const next = Number(value || 0);
                      if (!Number.isFinite(next)) {
                        setAiLongCount(1);
                        return;
                      }
                      const safe = Math.min(
                        Math.max(next, 1),
                        Math.min(5, maxMcqsPerQuiz)
                      );
                      setAiLongCount(safe);
                    },
                    onDifficultyChange: setAiLongDifficulty,
                  },
                ] : [
                  {
                    key: "mcq",
                    label: "MCQ",
                    count: aiCount,
                    difficulty: aiDifficulty,
                    onCountChange: (value) => {
                      const next = Number(value || 0);
                      if (!Number.isFinite(next)) {
                        setAiCount(0);
                        return;
                      }
                      const safe = Math.min(
                        Math.max(next, 0),
                        Math.max(0, maxMcqsPerQuiz - Number(aiShortCount || 0) - Number(aiTrueFalseCount || 0) - Number(aiMixMatchCount || 0) - Number(aiLongCount || 0))
                      );
                      setAiCount(safe);
                    },
                    onDifficultyChange: setAiDifficulty,
                  },
                  {
                    key: "short",
                    label: "Short",
                    count: aiShortCount,
                    difficulty: aiShortDifficulty,
                    onCountChange: (value) => {
                      const next = Number(value || 0);
                      if (!Number.isFinite(next)) {
                        setAiShortCount(0);
                        return;
                      }
                      const safe = Math.min(
                        Math.max(next, 0),
                        Math.max(0, maxMcqsPerQuiz - Number(aiCount || 0) - Number(aiTrueFalseCount || 0) - Number(aiMixMatchCount || 0) - Number(aiLongCount || 0))
                      );
                      setAiShortCount(safe);
                    },
                    onDifficultyChange: setAiShortDifficulty,
                  },
                  {
                    key: "tf",
                    label: "True / False",
                    count: aiTrueFalseCount,
                    difficulty: aiTrueFalseDifficulty,
                    onCountChange: (value) => {
                      const next = Number(value || 0);
                      if (!Number.isFinite(next)) {
                        setAiTrueFalseCount(0);
                        return;
                      }
                      const safe = Math.min(
                        Math.max(next, 0),
                        Math.max(0, maxMcqsPerQuiz - Number(aiCount || 0) - Number(aiShortCount || 0) - Number(aiMixMatchCount || 0) - Number(aiLongCount || 0))
                      );
                      setAiTrueFalseCount(safe);
                    },
                    onDifficultyChange: setAiTrueFalseDifficulty,
                  },
                  {
                    key: "mix-match",
                    label: "Mix Match",
                    count: aiMixMatchCount,
                    difficulty: aiMixMatchDifficulty,
                    onCountChange: (value) => {
                      const next = Number(value || 0);
                      if (!Number.isFinite(next)) {
                        setAiMixMatchCount(0);
                        return;
                      }
                      const safe = Math.min(
                        Math.max(next, 0),
                        Math.max(0, maxMcqsPerQuiz - Number(aiCount || 0) - Number(aiShortCount || 0) - Number(aiTrueFalseCount || 0) - Number(aiLongCount || 0))
                      );
                      setAiMixMatchCount(safe);
                    },
                    onDifficultyChange: setAiMixMatchDifficulty,
                  },
                  {
                    key: "long",
                    label: "Long",
                    count: aiLongCount,
                    difficulty: aiLongDifficulty,
                    onCountChange: (value) => {
                      const next = Number(value || 0);
                      if (!Number.isFinite(next)) {
                        setAiLongCount(0);
                        return;
                      }
                      const safe = Math.min(
                        Math.max(next, 0),
                        Math.min(5, Math.max(0, maxMcqsPerQuiz - Number(aiCount || 0) - Number(aiShortCount || 0) - Number(aiTrueFalseCount || 0) - Number(aiMixMatchCount || 0)))
                      );
                      setAiLongCount(safe);
                    },
                    onDifficultyChange: setAiLongDifficulty,
                  },
                ]}
              />
            </div>

            {aiAssessmentType !== "ASSIGNMENT" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                    Attempts Allowed
                  </label>
                  <select
                    value={aiAttemptLimit}
                    onChange={(e) => setAiAttemptLimit(Number(e.target.value))}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                    Time Limits (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={300}
                    value={aiTimeLimitMinutes}
                    onChange={(e) => {
                      const n = Number(e.target.value || 0);
                      if (!Number.isFinite(n)) return setAiTimeLimitMinutes(0);
                      setAiTimeLimitMinutes(Math.min(300, Math.max(0, Math.trunc(n))));
                    }}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                  />
                  <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                    Set `0` for no timer.
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "end" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, minHeight: 42, width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={aiRevealAnswersAfterSubmit}
                      onChange={(e) => setAiRevealAnswersAfterSubmit(e.target.checked)}
                    />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Reveal answers after submit</span>
                  </label>
                </div>
              </div>
            )}
            {aiJobId && (
              <p style={{ color: "#6b7280", fontSize: 14 }}>
                Job #{aiJobId} status: <b>{aiStatus || "Queued"}</b>
              </p>
            )}
            {!aiCapability.canGenerate && (
              <p style={{ color: "#dc2626", fontSize: 14 }}>
                AI generation disabled: {aiCapability.reason || "Provider not available"}
              </p>
            )}
            {!isManager && subscription?.isStudentPostTrialLocked && (
              <p style={{ color: "#dc2626", fontSize: 14 }}>
                AI Practice is locked after your trial. Upgrade to continue.
              </p>
            )}
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {showAiFailureFallback && (
              <div
                style={{
                  border: "1px solid #fecaca",
                  background: "#fff7f7",
                  color: "#991b1b",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 2,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  AI could not generate this quiz right now. You can import from Excel instead.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!!(activeQuizBuilderClassId || generateAiClassId) && (
                    <button
                      type="button"
                      onClick={() => setSearchParams({ importExcel: String(activeQuizBuilderClassId || generateAiClassId) })}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #7c3aed",
                        background: "#f5f3ff",
                        color: "#6d28d9",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Import Excel Quiz
                    </button>
                  )}
                </div>
              </div>
            )}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            {aiProgressActive && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                    Progress: {aiProgressStatus}
                  </span>
                  <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>{aiProgressPercent}%</span>
                </div>
                <div style={{ width: "100%", height: 8, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${aiProgressPercent}%`,
                      height: "100%",
                      background: aiProgressStatus.toLowerCase().includes("failed") ? "#dc2626" : "#16a34a",
                      transition: "width 350ms ease",
                    }}
                  />
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
              <button
                type="submit"
                onClick={(e) => {
                  const reason = getGenerateAiDisabledReason();
                  if (!reason) return;
                  e.preventDefault();
                  setError(reason);
                }}
                style={getActionButtonStyle(canGenerateAi)}
              >
                {submitting ? ti18n("common.loading", "Loading...") : ti18n("createQuiz.btn_generate", "Generate")}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {aiHistoryClassId && (
        <div style={{ maxWidth: 760, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          {renderClassActionBackLinks(aiHistoryClassId)}
          <h3 style={{ marginTop: 0 }}>Create Quiz From AI History</h3>
          <p style={{ color: "#6b7280", marginTop: 0 }}>
            Choose a previous unedited AI-generated quiz snapshot and create a new draft in this class.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 10 }}>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                Attempts Allowed
              </label>
              <select
                value={historyAttemptLimit}
                onChange={(e) => setHistoryAttemptLimit(Number(e.target.value))}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                Time Limits (minutes)
              </label>
              <input
                type="number"
                min={0}
                max={300}
                value={historyTimeLimitMinutes}
                onChange={(e) => {
                  const n = Number(e.target.value || 0);
                  if (!Number.isFinite(n)) return setHistoryTimeLimitMinutes(0);
                  setHistoryTimeLimitMinutes(Math.min(300, Math.max(0, Math.trunc(n))));
                }}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                Set `0` for no timer.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "end" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, minHeight: 42, width: "100%" }}>
                <input
                  type="checkbox"
                  checked={historyRevealAnswersAfterSubmit}
                  onChange={(e) => setHistoryRevealAnswersAfterSubmit(e.target.checked)}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Reveal answers after submit</span>
              </label>
            </div>
          </div>
          {loadingAiHistory && <p style={{ color: "#6b7280", fontSize: 14 }}>Loading history...</p>}
          {!loadingAiHistory && !aiHistoryItems.length && (
            <p style={{ color: "#6b7280", fontSize: 14 }}>No AI history found for this class.</p>
          )}
          {!loadingAiHistory && !!aiHistoryItems.length && (
            <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ color: "#475569", fontSize: 13, fontWeight: 700 }}>
                Select multiple AI history items to create one mixed draft.
              </div>
              <button
                type="button"
                onClick={() => {
                  if (creatingFromHistoryId) {
                    setError("Please wait. A draft is currently being created.");
                    return;
                  }
                  handleCreateMixedFromAiHistory();
                }}
                style={getActionButtonStyle(selectedAiHistoryIds.length >= 2 && !creatingFromHistoryId)}
              >
                {creatingFromHistoryId === "mixed" ? "Creating..." : `Create Mixed Draft${selectedAiHistoryIds.length ? ` (${selectedAiHistoryIds.length})` : ""}`}
              </button>
            </div>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
              {aiHistoryItems.map((item) => (
                <div
                  key={item.aiQuizDictionaryId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderBottom: "1px solid #f1f5f9",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={selectedAiHistoryIds.includes(Number(item.aiQuizDictionaryId))}
                      onChange={(e) => {
                        const id = Number(item.aiQuizDictionaryId);
                        setSelectedAiHistoryIds((prev) => (
                          e.target.checked
                            ? [...prev, id]
                            : prev.filter((value) => Number(value) !== id)
                        ));
                      }}
                      disabled={!!creatingFromHistoryId}
                    />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#111827" }}>
                      {item.topic || "AI Topic"} ({Number(item.questionCount || 0)} Q)
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 12 }}>
                      {item.difficulty || "Medium"} | {item.sourceProvider || "ai"} {item.modelName ? `| ${item.modelName}` : ""}
                      {item.createDate ? ` | ${new Date(item.createDate).toLocaleString()}` : ""}
                    </div>
                  </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (creatingFromHistoryId) {
                        setError("Please wait. A draft is currently being created.");
                        return;
                      }
                      handleCreateFromAiHistory(item);
                    }}
                    style={getActionButtonStyle(!creatingFromHistoryId)}
                  >
                    {creatingFromHistoryId === item.aiQuizDictionaryId ? "Creating..." : "Create Draft"}
                  </button>
                </div>
              ))}
            </div>
            </>
          )}
          {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
          {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {importExcelClassId && (
        <div style={{ maxWidth: 760, marginBottom: 24, padding: 24, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          {renderClassActionBackLinks(importExcelClassId)}
          <h3 style={{ marginTop: 0 }}>Import Quizzes From Excel</h3>
          <div style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 12, background: "#fbfdff", marginBottom: 16 }}>
            <p style={{ color: "#6b7280", marginTop: 0, marginBottom: 8 }}>
              Required columns: <b>ClassName</b>, <b>QuizName</b>, <b>QuestionText</b>, <b>OptionA</b>, <b>OptionB</b>, <b>OptionC</b>, <b>OptionD</b>, <b>CorrectOption</b>.
            </p>
            <p style={{ color: "#6b7280", margin: "0 0 8px" }}>
              Optional: Topic, Difficulty, Explanation, QuestionType, Points, ExpectedAnswerText.
            </p>
            <p style={{ color: "#6b7280", margin: "0 0 8px" }}>
              For <b>QuestionType=LONG</b>: keep <b>QuestionText</b> detailed (20+ chars), set optional <b>Points</b> (1..100), and leave option/correct columns blank.
            </p>
            <p style={{ color: "#6b7280", margin: 0 }}>
              <b>ClassName must already exist</b> for the selected student. If not, create the class first.
            </p>
          </div>
          <form onSubmit={handleImportExcel} style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                  Attempts Allowed
                </label>
                <select
                  value={importAttemptLimit}
                  onChange={(e) => setImportAttemptLimit(Number(e.target.value))}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                  Time Limits (minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={importTimeLimitMinutes}
                  onChange={(e) => {
                    const n = Number(e.target.value || 0);
                    if (!Number.isFinite(n)) return setImportTimeLimitMinutes(0);
                    setImportTimeLimitMinutes(Math.min(300, Math.max(0, Math.trunc(n))));
                  }}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                  Set `0` for no timer.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "end" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, minHeight: 42, width: "100%" }}>
                  <input
                    type="checkbox"
                    checked={importRevealAnswersAfterSubmit}
                    onChange={(e) => setImportRevealAnswersAfterSubmit(e.target.checked)}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Reveal answers after submit</span>
                </label>
              </div>
            </div>
            <div style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 12 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                Upload Spreadsheet
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  if (f && !isAllowedSpreadsheetFile(f)) {
                    setExcelFile(null);
                    setError("Invalid file type. Only .xlsx, .xls, or .csv files are allowed.");
                    e.target.value = "";
                    return;
                  }
                  setExcelFile(f);
                }}
              />
            </div>
            <DisclaimerPanel
              title={manualDisclaimer?.Title || "Manual Quiz Disclaimer"}
              text={manualDisclaimer?.DisclaimerText || "Loading disclaimer..."}
              checked={importExcelDisclaimerAccepted}
              onChange={setImportExcelDisclaimerAccepted}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
              <button
                type="submit"
                onClick={(e) => {
                  const reason = getImportQuizDisabledReason();
                  if (!reason) return;
                  e.preventDefault();
                  setError(reason);
                }}
                style={getActionButtonStyle(canImportQuizExcelReady)}
              >
                {submitting ? "Importing..." : "Upload & Import"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Close
              </button>
            </div>
          </form>
        </div>
      )}

      {manageQuizId && (
        <div style={{ maxWidth: 520, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Manage Quiz</h3>
          {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
          {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              onClick={() => navigate(`/quiz/${manageQuizId}/edit`)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
            >
              {isManager ? "Teacher Review & Edit" : "Input / Edit Quiz"}
            </button>
            {!isManager && (
              <button
                type="button"
                onClick={() => {
                  if (submitting) {
                    setError("Publishing is already in progress. Please wait.");
                    return;
                  }
                  handlePublishQuiz();
                }}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}
              >
                {submitting ? "Publishing..." : "Publish"}
              </button>
            )}
            <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {!createClass && !createStudent && !importStudents && !classInfoId && !createQuizClassId && !manageQuizId && !assignQuizId && !generateAiClassId && !importExcelClassId && !aiHistoryClassId && (
        <p style={{ color: "#6b7280" }}>Select a class and quiz from the sidebar, or create a class or quiz.</p>
      )}
      </div>
    </PageShell>
  );
}
