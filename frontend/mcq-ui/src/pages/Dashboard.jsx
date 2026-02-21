import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSidebarRefresh } from "../context/SidebarRefreshContext";
import { useAuth } from "../context/AuthContext";
import { apiGet, apiPost, apiPut, apiUpload } from "../api/http";

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

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { triggerRefresh } = useSidebarRefresh();
  const { isManager, selectedStudentId } = useAuth();
  const createClass = searchParams.get("createClass") === "1";
  const createStudent = searchParams.get("createStudent") === "1";
  const importStudents = searchParams.get("importStudents") === "1";
  const classInfoId = searchParams.get("classInfo");
  const createQuizClassId = searchParams.get("createQuiz");
  const manageQuizId = searchParams.get("manageQuiz");
  const assignQuizId = searchParams.get("assignQuiz");
  const generateAiClassId = searchParams.get("generateAi");
  const importExcelClassId = searchParams.get("importExcel");

  const [className, setClassName] = useState("");
  const [subject, setSubject] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [quizTitle, setQuizTitle] = useState("");
  const [quizDescription, setQuizDescription] = useState("");
  const [createQuizDisclaimerAccepted, setCreateQuizDisclaimerAccepted] = useState(false);
  const [studentUserName, setStudentUserName] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [studentPasswordConfirm, setStudentPasswordConfirm] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState("Medium");
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useState(false);
  const [aiJobId, setAiJobId] = useState(null);
  const [aiStatus, setAiStatus] = useState("");
  const [aiCapability, setAiCapability] = useState({ canGenerate: true, reason: "", provider: "" });
  const [excelFile, setExcelFile] = useState(null);
  const [studentsExcelFile, setStudentsExcelFile] = useState(null);
  const [studentsImportFailedRows, setStudentsImportFailedRows] = useState([]);
  const [selectedClassInfo, setSelectedClassInfo] = useState(null);
  const [classStudents, setClassStudents] = useState([]);
  const [assignQuizTitle, setAssignQuizTitle] = useState("");
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

  useEffect(() => {
    setError("");
    setSuccess("");
  }, [createClass, createStudent, importStudents, classInfoId, createQuizClassId, manageQuizId, assignQuizId, generateAiClassId, importExcelClassId]);

  useEffect(() => {
    if (!classInfoId) {
      setSelectedClassInfo(null);
      setClassStudents([]);
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
        setClassStudents([]);
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
        const data = await apiGet(`/api/quizzes/${assignQuizId}/assignments/students`);
        if (cancelled) return;
        const students = Array.isArray(data.students) ? data.students : [];
        setAssignQuizTitle(data.quizTitle || "");
        setAssignStudents(students);
        setAssignSelected(students.filter((s) => s.assigned).map((s) => Number(s.studentId)));
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load assignment students");
        setAssignStudents([]);
        setAssignSelected([]);
      }
    }
    loadAssignmentData();
    return () => {
      cancelled = true;
    };
  }, [assignQuizId, isManager]);

  useEffect(() => {
    if (!aiJobId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const job = await apiGet(`/api/ai/jobs/${aiJobId}`);
        if (cancelled) return;
        setAiStatus(job.status || "");

        if (job.status === "Completed") {
          setSuccess("AI quiz generated successfully.");
          setAiJobId(null);
          setAiStatus("");
          triggerRefresh();
          if (job.resultQuizId) setSearchParams({ manageQuiz: String(job.resultQuizId) });
        }

        if (job.status === "Failed") {
          setSuccess("");
          setError(job.errorMessage || "AI generation failed");
          setAiJobId(null);
          setAiStatus("");
        }
      } catch (err) {
        if (cancelled) return;
        setSuccess("");
        setError(err.message || "Failed to poll AI generation status");
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

  async function handleRunReport(e) {
    e.preventDefault();
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
        studentId: isManager ? Number(selectedStudentId) : undefined,
      });
      setSuccess(created?.joinCode ? `Class created. Join code: ${created.joinCode}` : "Class created.");
      setClassName("");
      setSubject("");
      setGradeLevel("");
      triggerRefresh();
      setSearchParams({});
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
      const created = await apiPost(`/api/classes/${createQuizClassId}/quizzes`, {
        title: quizTitle.trim(),
        description: quizDescription.trim() || undefined,
        disclaimerAcknowledged: true,
      });
      setSuccess("Quiz created (draft).");
      setQuizTitle("");
      setQuizDescription("");
      setCreateQuizDisclaimerAccepted(false);
      triggerRefresh();
      if (created?.quizId) setSearchParams({ manageQuiz: String(created.quizId) });
      else setSearchParams({});
    } catch (err) {
      setError(err.message || "Failed to create quiz");
    } finally {
      setSubmitting(false);
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
    if (!aiDisclaimerAccepted) {
      setError("Please read and acknowledge the AI quiz disclaimer before generating.");
      return;
    }
    const topicValidationError = validateAiTopic(aiTopic);
    if (topicValidationError) {
      setError(topicValidationError);
      return;
    }

    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const created = await apiPost("/api/ai/jobs", {
        classId: Number(generateAiClassId),
        topic: aiTopic.trim(),
        numQuestions: Number(aiCount),
        difficulty: aiDifficulty,
        disclaimerAcknowledged: true,
        studentId: isManager ? Number(selectedStudentId) : undefined,
      });
      setAiJobId(created.jobId);
      setAiStatus(created.status || "Queued");
      setSuccess("AI generation started in background.");
      setAiDisclaimerAccepted(false);
    } catch (err) {
      setError(err.message || "Failed to start AI generation");
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
      setError("Please choose an Excel file (.xlsx or .xls).");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", excelFile);
      if (isManager && selectedStudentId) {
        form.append("studentId", String(selectedStudentId));
      }
      const result = await apiUpload("/api/import/excel", form);
      setSuccess(
        `Import complete: ${result.importedQuestions} question(s), ${result.quizzesTouched} quiz(es), ${result.classesTouched} class(es).`
      );
      setExcelFile(null);
      triggerRefresh();
    } catch (err) {
      setError(err.message || "Excel import failed");
    } finally {
      setSubmitting(false);
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
      setError("Please choose a students Excel file (.xlsx or .xls).");
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

  function downloadStudentsTemplate() {
    const csv = [
      "StudentCode,UserName,Password,ClassName,QuizLimit",
      "STD-001,student1,TempPass123,Database Fundamentals,40",
      "STD-002,student2,TempPass123,Grade 12 Economics,40",
    ].join("\n");
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
    const header = "RowNumber,UserName,StudentCode,Reason";
    const escapeCsv = (v) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, "\"\"")}"`;
      }
      return s;
    };
    const rows = studentsImportFailedRows.map((r) =>
      [r.rowNumber, r.userName, r.studentCode, r.reason].map(escapeCsv).join(",")
    );
    const csv = [header, ...rows].join("\n");
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

  const canCreateClass = !submitting && !!className.trim() && (!isManager || !!selectedStudentId);
  const canImportStudents = !submitting && !!studentsExcelFile;
  const canCreateStudent =
    !submitting &&
    !!studentCode.trim() &&
    !!studentUserName.trim() &&
    String(studentPassword || "").length >= 6 &&
    studentPassword === studentPasswordConfirm;
  const canSaveAssignments = !submitting;
  const canCreateQuiz = !submitting && !!quizTitle.trim() && !!createQuizDisclaimerAccepted;
  const canGenerateAi =
    !submitting &&
    !aiJobId &&
    !!aiCapability.canGenerate &&
    !!aiDisclaimerAccepted &&
    !!String(aiTopic || "").trim() &&
    Number(aiCount) >= 1 &&
    Number(aiCount) <= 20;
  const canImportQuizExcel = !submitting && !!excelFile && (!isManager || !!selectedStudentId);

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

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>

      {isManager && !createClass && !createStudent && !importStudents && !classInfoId && !createQuizClassId && !manageQuizId && !assignQuizId && !generateAiClassId && !importExcelClassId && (
        <div style={{ maxWidth: 980, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>Teacher Report</h3>
          <form onSubmit={handleRunReport} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr auto", gap: 10, alignItems: "end" }}>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Class</label>
              <select value={reportClassId} onChange={(e) => setReportClassId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}>
                <option value="">All Classes</option>
                {reportClassOptions.map((c) => (
                  <option key={c.classId} value={c.classId}>{c.className}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Student</label>
              <select value={reportStudentId} onChange={(e) => setReportStudentId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}>
                <option value="">All Students</option>
                {reportStudentOptions.map((s) => (
                  <option key={s.studentId} value={s.studentId}>{s.studentCode} ({s.userName})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Quiz</label>
              <select value={reportQuizId} onChange={(e) => setReportQuizId(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}>
                <option value="">All Quizzes</option>
                {reportQuizOptions.map((q) => (
                  <option key={`${q.quizId}-${q.classId}-${q.studentId}`} value={q.quizId}>{q.title}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={reportLoading} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", height: 40 }}>
              {reportLoading ? "Loading..." : "Submit"}
            </button>
          </form>
          {reportError && <p style={{ marginTop: 10, color: "#dc2626", fontSize: 14 }}>{reportError}</p>}

          {reportResult && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
                <div style={{ padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}><b>Attempts:</b> {reportResult.summary?.attemptsCount || 0}</div>
                <div style={{ padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}><b>Students:</b> {reportResult.summary?.studentsCount || 0}</div>
                <div style={{ padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}><b>Avg %:</b> {reportResult.summary?.avgScorePercent || 0}</div>
                <div style={{ padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}><b>Best %:</b> {reportResult.summary?.bestScorePercent || 0}</div>
                <div style={{ padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}><b>Worst %:</b> {reportResult.summary?.worstScorePercent || 0}</div>
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
        </div>
      )}

      {createClass && (
        <div style={{ maxWidth: 400, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Create Class</h3>
          <form onSubmit={handleCreateClass}>
            <input
              placeholder="Class name"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <input
              placeholder="Subject (optional)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <input
              placeholder="Grade level (optional)"
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={!canCreateClass} style={getActionButtonStyle(canCreateClass)}>
                {submitting ? "Creating..." : "Create"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {importStudents && isManager && (
        <div style={{ maxWidth: 560, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Import Students (Excel)</h3>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6b7280" }}>
            Required columns: <b>StudentCode</b>, <b>UserName</b>, <b>Password</b>, <b>ClassName</b>. Optional: <b>QuizLimit</b>.
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6b7280" }}>
            <b>ClassName must already exist</b> (create class first). Unknown class names will be rejected.
          </p>
          <button
            type="button"
            onClick={downloadStudentsTemplate}
            style={{ marginBottom: 10, padding: "7px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
          >
            Download Template
          </button>
          <form onSubmit={handleImportStudentsExcel}>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setStudentsExcelFile(e.target.files?.[0] || null)}
              style={{ marginBottom: 10 }}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="submit"
                disabled={!canImportStudents}
                style={{ ...getActionButtonStyle(canImportStudents), padding: "8px 14px" }}
              >
                {submitting ? "Importing..." : "Import Students"}
              </button>
              {!!studentsImportFailedRows.length && (
                <button
                  type="button"
                  onClick={downloadStudentsFailedRowsReport}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
                >
                  Download Failed Rows Report
                </button>
              )}
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Close
              </button>
            </div>
          </form>
        </div>
      )}

      {createStudent && isManager && (
        <div style={{ maxWidth: 420, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Create Student</h3>
          <form onSubmit={handleCreateStudent}>
            <input
              placeholder="Student code"
              value={studentCode}
              onChange={(e) => setStudentCode(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <input
              placeholder="UserName"
              value={studentUserName}
              onChange={(e) => setStudentUserName(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <input
              placeholder="Temporary password"
              type="password"
              minLength={6}
              value={studentPassword}
              onChange={(e) => setStudentPassword(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <input
              placeholder="Confirm password"
              type="password"
              minLength={6}
              value={studentPasswordConfirm}
              onChange={(e) => setStudentPasswordConfirm(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={!canCreateStudent} style={getActionButtonStyle(canCreateStudent)}>
                {submitting ? "Creating..." : "Create Student"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {classInfoId && selectedClassInfo && (
        <div style={{ maxWidth: 860, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Class Information</h3>
          <p style={{ margin: "0 0 8px" }}><b>Name:</b> {selectedClassInfo.className}</p>
          {selectedClassInfo.subject && <p style={{ margin: "0 0 8px" }}><b>Subject:</b> {selectedClassInfo.subject}</p>}
          {selectedClassInfo.gradeLevel && <p style={{ margin: "0 0 8px" }}><b>Grade Level:</b> {selectedClassInfo.gradeLevel}</p>}
          {selectedClassInfo.joinCode && <p style={{ margin: "0 0 8px" }}><b>Join Code:</b> {selectedClassInfo.joinCode}</p>}
          <p style={{ margin: "0 0 8px" }}><b>Total Quizzes:</b> {Array.isArray(selectedClassInfo.quizzes) ? selectedClassInfo.quizzes.length : 0}</p>
          <p style={{ margin: "0 0 8px" }}><b>Total Students In Class:</b> {classStudents.length}</p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setSearchParams({ createQuiz: String(selectedClassInfo.classId) })}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d7dde6", background: "#f6f7f9", color: "#5f6f8d", fontWeight: 800, cursor: "pointer" }}
            >
              Create Quiz
            </button>
            <button
              type="button"
              onClick={() => setSearchParams({ generateAi: String(selectedClassInfo.classId) })}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d7dde6", background: "#f6f7f9", color: "#5f6f8d", fontWeight: 800, cursor: "pointer" }}
            >
              Generate AI Quiz
            </button>
            <button
              type="button"
              onClick={() => setSearchParams({ importExcel: String(selectedClassInfo.classId) })}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d7dde6", background: "#f6f7f9", color: "#5f6f8d", fontWeight: 800, cursor: "pointer" }}
            >
              Import Excel Quiz
            </button>
          </div>

          {!!selectedClassInfo.quizzes?.length && (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, maxHeight: 300, overflowY: "auto" }}>
              {selectedClassInfo.quizzes.map((q) => (
                <div key={q.quizId} style={{ padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
                  <b>{q.title}</b> ({Number(q.questionCount || 0)} Q){q.isAssigned ? " [Assigned]" : ""}{q.status === "Draft" ? " [Draft]" : ""}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <p style={{ margin: "0 0 8px" }}><b>Students In This Class:</b></p>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, maxHeight: 260, overflowY: "auto" }}>
              {!classStudents.length && <div style={{ color: "#6b7280" }}>No students linked to this class.</div>}
              {classStudents.map((s) => (
                <div key={s.studentId} style={{ padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
                  <b>{s.studentCode}</b> ({s.userName}) {s.isActive ? "" : "[Inactive]"}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {assignQuizId && isManager && (
        <div style={{ maxWidth: 760, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Assign Students To Quiz</h3>
          {assignQuizTitle && (
            <p style={{ marginTop: -6, color: "#4b5563" }}>
              Quiz: <b>{assignQuizTitle}</b>
            </p>
          )}
          <form onSubmit={handleSaveAssignments}>
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

            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="submit"
                disabled={!canSaveAssignments}
                style={getActionButtonStyle(canSaveAssignments)}
              >
                {submitting ? "Saving..." : "Save Assignments"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Close
              </button>
            </div>
          </form>
        </div>
      )}

      {createQuizClassId && (
        <div style={{ maxWidth: 400, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Create Quiz</h3>
          <form onSubmit={handleCreateQuiz}>
            <input
              placeholder="Quiz title"
              value={quizTitle}
              onChange={(e) => setQuizTitle(e.target.value)}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <textarea
              placeholder="Description (optional)"
              value={quizDescription}
              onChange={(e) => setQuizDescription(e.target.value)}
              rows={2}
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10, fontSize: 13, color: "#4b5563", lineHeight: 1.45 }}>
              <input
                type="checkbox"
                checked={createQuizDisclaimerAccepted}
                onChange={(e) => setCreateQuizDisclaimerAccepted(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                I acknowledge that AI-generated quiz content is for educational practice, may contain errors, and must be reviewed before use.
              </span>
            </label>
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={!canCreateQuiz} style={getActionButtonStyle(canCreateQuiz)}>
                {submitting ? "Creating..." : "Create"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {generateAiClassId && (
        <div style={{ maxWidth: 460, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Generate Quiz With AI</h3>
          <form onSubmit={handleGenerateAiQuiz}>
            <input
              placeholder="Topic (e.g., Database normalization)"
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              maxLength={120}
              required
              style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
            />
            <p style={{ color: "#6b7280", fontSize: 12, marginTop: -4, marginBottom: 8 }}>
              Enter one focused topic only (example: Trigonometric Functions).
            </p>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10, fontSize: 13, color: "#4b5563", lineHeight: 1.45 }}>
              <input
                type="checkbox"
                checked={aiDisclaimerAccepted}
                onChange={(e) => setAiDisclaimerAccepted(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                I acknowledge AI-generated quiz content is for educational practice, may contain errors, and must be reviewed before use.
              </span>
            </label>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <input
                type="number"
                min={1}
                max={20}
                value={aiCount}
                onChange={(e) => setAiCount(e.target.value)}
                style={{ width: 120, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              />
              <select
                value={aiDifficulty}
                onChange={(e) => setAiDifficulty(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", boxSizing: "border-box" }}
              >
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
              </select>
            </div>
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
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={!canGenerateAi} style={getActionButtonStyle(canGenerateAi)}>
                {submitting ? "Starting..." : "Generate"}
              </button>
              <button type="button" onClick={cancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {importExcelClassId && (
        <div style={{ maxWidth: 760, marginBottom: 24, padding: 16, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <h3 style={{ marginTop: 0 }}>Import Quizzes From Excel</h3>
          <p style={{ color: "#6b7280", marginTop: 0 }}>
            Required columns: <b>ClassName</b>, <b>QuizName</b>, <b>QuestionText</b>, <b>OptionA</b>, <b>OptionB</b>, <b>OptionC</b>, <b>OptionD</b>, <b>CorrectOption</b>.
          </p>
          <p style={{ color: "#6b7280", marginTop: -8 }}>
            Optional: Topic, Difficulty, Explanation.
          </p>
          <p style={{ color: "#6b7280", marginTop: -8 }}>
            <b>ClassName must already exist</b> for the selected student. If not, create the class first.
          </p>
          <form onSubmit={handleImportExcel}>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
              style={{ marginBottom: 12 }}
            />
            {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
            {success && <p style={{ color: "#16a34a", fontSize: 14 }}>{success}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={!canImportQuizExcel} style={getActionButtonStyle(canImportQuizExcel)}>
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
                disabled={submitting}
                onClick={handlePublishQuiz}
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

      {!createClass && !createStudent && !importStudents && !classInfoId && !createQuizClassId && !manageQuizId && !assignQuizId && !generateAiClassId && !importExcelClassId && (
        <p style={{ color: "#6b7280" }}>Select a class and quiz from the sidebar, or create a class or quiz.</p>
      )}
    </div>
  );
}
