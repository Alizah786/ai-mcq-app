import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSidebarRefresh } from "../context/SidebarRefreshContext";
import { apiDelete, apiGet, apiPost, apiPut } from "../api/http";
import { useUIText } from "../context/UITextContext";
import { useRef } from "react";
import BrandLogo from "./BrandLogo";

function formatSidebarQuizTitle(title) {
  const text = String(title || "").trim();
  if (!text) return "Untitled";
  return text
    .replace(/\s*quiz\s*$/i, "")
    .replace(/\s*-\s*ai\s*$/i, "")
    .trim();
}

function isAiQuizTitle(title) {
  return /\bai quiz\b/i.test(String(title || ""));
}

export default function Sidebar({ onNavigate, isMobile = false, searchQuery = "" }) {
  const navigate = useNavigate();
  const { user, isManager, selectedStudentId, setSelectedStudentId } = useAuth();
  const { refreshKey, triggerRefresh } = useSidebarRefresh();
  const { loadCategoryKeys, t, msg } = useUIText();
  const [openClassId, setOpenClassId] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiCapability, setAiCapability] = useState({ canGenerate: true, reason: "", provider: "" });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [openQuizMenu, setOpenQuizMenu] = useState(null);
  const [openQuizGroups, setOpenQuizGroups] = useState({});
  const quizMenuRef = useRef(null);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "sidebar.selectStudent",
      "sidebar.createStudent",
      "sidebar.importStudents",
      "sidebar.myClasses",
      "sidebar.myResults",
      "sidebar.joinCode",
      "sidebar.createQuiz",
      "sidebar.notesFlashcards",
      "sidebar.previousFlashcards",
      "sidebar.createFromAiHistory",
      "sidebar.deleteClass",
      "sidebar.createClass",
      "sidebar.profile",
      "sidebar.loading",
      "sidebar.noStudents",
      "sidebar.upgrade.button",
      "sidebar.close.button",
      "sidebar.upgradeModal.title",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "sidebar.error.failedStudents",
      "sidebar.error.failedClasses",
      "sidebar.error.createClassFirst",
      "sidebar.search.empty",
      "sidebar.upgradeModal.body",
      "sidebar.upgradeModal.studentBasic",
      "sidebar.upgradeModal.studentPro",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    let alive = true;
    async function fetchStudentsIfManager() {
      if (!isManager) {
        setStudents([]);
        return;
      }
      try {
        const res = await apiGet("/api/teacher/students");
        if (!alive) return;
        const list = res.students || [];
        setStudents(list);
        if (list.length === 0) {
          if (selectedStudentId) setSelectedStudentId(null);
          return;
        }
        const selectedInList = list.some((s) => Number(s.studentId) === Number(selectedStudentId));
        if (!selectedStudentId || !selectedInList) {
          setSelectedStudentId(list[0].studentId);
        }
      } catch (e) {
        if (!alive) return;
        setError(e.message || msg("sidebar.error.failedStudents", "Failed to load students"));
      }
    }
    fetchStudentsIfManager();
    return () => {
      alive = false;
    };
  }, [isManager, refreshKey, selectedStudentId, setSelectedStudentId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    async function fetchClasses() {
      try {
        const query = isManager && selectedStudentId ? `?studentId=${selectedStudentId}` : "";
        const res = await apiGet(`/api/classes${query}`);
        if (alive) setClasses(res.classes || []);
      } catch (e) {
        if (!alive) return;
        if (isManager && students.length === 0) {
          setError("");
          setClasses([]);
          return;
        }
        setError(e.message || msg("sidebar.error.failedClasses", "Failed to load classes"));
      } finally {
        if (alive) setLoading(false);
      }
    }
    if (isManager && (!selectedStudentId || students.length === 0)) {
      setClasses([]);
      setLoading(false);
      return;
    }
    fetchClasses();
    return () => {
      alive = false;
    };
  }, [refreshKey, isManager, selectedStudentId, students.length]);

  useEffect(() => {
    let alive = true;
    async function fetchAICapability() {
      try {
        const cap = await apiGet("/api/ai/capability");
        if (!alive) return;
        setAiCapability({
          canGenerate: !!cap.canGenerate,
          reason: cap.reason || "",
          provider: cap.provider || "",
        });
      } catch (e) {
        if (!alive) return;
        setAiCapability({
          canGenerate: false,
          reason: e.message || "AI capability check failed",
          provider: "",
        });
      }
    }
    fetchAICapability();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!openQuizMenu) return;
      if (quizMenuRef.current && !quizMenuRef.current.contains(event.target)) {
        setOpenQuizMenu(null);
      }
    }
    function handleEscape(event) {
      if (event.key === "Escape") setOpenQuizMenu(null);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openQuizMenu]);


  async function handleDeleteQuiz(e, quizId) {
    e.stopPropagation();
    const ok = window.confirm("Delete this quiz and all related attempts?");
    if (!ok) return;
    try {
      await apiDelete(`/api/quizzes/${quizId}`);
      triggerRefresh();
    } catch (err) {
      alert(err.message || "Failed to delete quiz");
    }
  }

  async function handleDeleteClass(e, classId) {
    e.stopPropagation();
    const ok = window.confirm("Delete this empty class?");
    if (!ok) return;
    try {
      await apiDelete(`/api/classes/${classId}`);
      if (openClassId === classId) setOpenClassId(null);
      triggerRefresh();
    } catch (err) {
      alert(err.message || "Failed to delete class");
    }
  }

  async function handleUpdateQuizTimeLimit(e, classId, quizId, currentMinutes) {
    e.stopPropagation();
    const initial = Number.isFinite(Number(currentMinutes)) ? String(Number(currentMinutes)) : "0";
    const raw = window.prompt("Set quiz time limit in minutes (0-300). Use 0 for no timer.", initial);
    if (raw == null) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      alert("Please enter a valid number.");
      return;
    }
    const minutes = Math.trunc(parsed);
    if (minutes < 0 || minutes > 300) {
      alert("Time limit must be between 0 and 300 minutes.");
      return;
    }
    try {
      await apiPut(`/api/quizzes/${quizId}/time-limit`, { timeLimitMinutes: minutes });
      setClasses((prev) =>
        prev.map((c) =>
          Number(c.classId) !== Number(classId)
            ? c
            : {
                ...c,
                quizzes: (c.quizzes || []).map((q) =>
                  Number(q.quizId) === Number(quizId)
                    ? { ...q, timeLimitMinutes: minutes }
                    : q
                ),
              }
        )
      );
      triggerRefresh();
    } catch (err) {
      alert(err.message || "Failed to update time limit");
    }
  }

  async function handleCreateNewDraft(e, quizId) {
    e.stopPropagation();
    try {
      const created = await apiPost(`/api/quizzes/${quizId}/new-draft`, {});
      setOpenQuizMenu(null);
      triggerRefresh();
      if (Number(created?.quizId || 0) > 0) {
        go(`/quiz/${Number(created.quizId)}/edit`);
      }
    } catch (err) {
      alert(err.message || "Failed to create draft");
    }
  }

  function go(path) {
    navigate(path);
    setOpenQuizMenu(null);
    if (onNavigate) onNavigate();
  }

  function isQuizGroupOpen(classId, groupKey) {
    const key = `${classId}:${groupKey}`;
    return openQuizGroups[key] !== false;
  }

  function toggleQuizGroup(classId, groupKey) {
    const key = `${classId}:${groupKey}`;
    setOpenQuizGroups((prev) => ({
      ...prev,
      [key]: prev[key] === false ? true : false,
    }));
  }

  const studentLabel = isManager
    ? students.find((s) => s.studentId === Number(selectedStudentId))?.studentCode || "Select student"
    : user?.displayName || "";
  const selectedStudent = students.find((s) => s.studentId === Number(selectedStudentId)) || null;
  const roleLabel = user?.role === "Manager" ? "Teacher" : (user?.role || "User");
  const teacherLabel = !isManager && user?.role === "Student" && user?.teacherUserName
    ? String(user.teacherUserName)
    : "";
  const canCreateClass = isManager || user?.role !== "Student" || !teacherLabel;
  const normalizedQuery = String(searchQuery || "").trim().toLowerCase();

  function handleGenerateAiClick(classId) {
    go(`/dashboard?generateAi=${classId}`);
  }

  function handleCreateClassClick() {
    if (isManager && !selectedStudentId) {
      setError(msg("sidebar.error.createClassFirst", "Create a student first, then create a class."));
      go("/dashboard?createStudent=1");
      return;
    }
    setError("");
    go("/dashboard?createClass=1");
  }

  const filteredClasses = !normalizedQuery
    ? classes
    : classes
        .map((c) => {
          const classMatch = String(c.className || "").toLowerCase().includes(normalizedQuery);
          const quizzes = Array.isArray(c.quizzes) ? c.quizzes : [];
          const matchedQuizzes = quizzes.filter((q) =>
            String(q.title || "").toLowerCase().includes(normalizedQuery)
          );

          if (classMatch) return c;
          if (matchedQuizzes.length) return { ...c, quizzes: matchedQuizzes };
          return null;
        })
        .filter(Boolean);
  const activeOpenClass = classes.find((c) => Number(c.classId) === Number(openClassId)) || null;

  return (
    <aside
      style={{
        width: isMobile ? "min(92vw, 404px)" : 404,
        minWidth: isMobile ? "min(92vw, 404px)" : 404,
        height: isMobile ? "100vh" : "auto",
        background: "#eef1f5",
        borderRight: "1px solid #e5e7eb",
        padding: 18,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          background: "#f3f4f6",
          border: "1px solid #d7dde6",
          borderRadius: 34,
          padding: 18,
          minHeight: "calc(100vh - 28px)",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <BrandLogo />
        </div>

        <div style={{ height: 1, background: "#d7dde6", marginBottom: 14 }} />

        {isManager && (
          <>
            <div style={{ color: "#7484a1", fontWeight: 700, fontSize: 15, letterSpacing: 0.4, marginBottom: 8 }}>{t("sidebar.selectStudent", "Select Student")}</div>
            <select
              value={selectedStudentId || ""}
              onChange={(e) => setSelectedStudentId(e.target.value ? Number(e.target.value) : null)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 16,
                border: "1px solid #d7dde6",
                marginBottom: 10,
                fontSize: 14,
                fontWeight: 700,
                color: "#26334d",
                background: "#ffffff",
              }}
            >
              {!students.length && <option value="">{t("sidebar.noStudents", "No students")}</option>}
              {students.map((s) => (
                <option key={s.studentId} value={s.studentId}>
                  {s.studentCode} ({s.userName})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => go("/dashboard?createStudent=1")}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 999,
                border: "1px solid #d7dde6",
                background: "#f6f7f9",
                cursor: "pointer",
                marginBottom: 12,
                fontSize: 18,
                fontWeight: 800,
                color: "#111827",
              }}
            >
              <span style={{ color: "#ef8d3a", marginRight: 8 }}>+</span>
              {t("sidebar.createStudent", "Create Student")}
            </button>
            <button
              type="button"
              onClick={() => go("/dashboard?importStudents=1")}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 999,
                border: "1px solid #d7dde6",
                background: "#f6f7f9",
                cursor: "pointer",
                marginBottom: 12,
                fontSize: 16,
                fontWeight: 800,
                color: "#111827",
              }}
            >
              <span style={{ color: "#2563eb", marginRight: 8 }}>+</span>
              {t("sidebar.importStudents", "Import Students (Excel)")}
            </button>
          </>
        )}


        <div style={{ color: "#7484a1", fontWeight: 700, fontSize: 15, letterSpacing: 1, marginBottom: 10 }}>{t("sidebar.myClasses", "MY CLASSES")}</div>
        {!isManager && (
          <button
            type="button"
            onClick={() => go("/results")}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid #d7dde6",
              background: "#f7f8fa",
              color: "#1f2937",
              fontWeight: 700,
              fontSize: 15,
              marginBottom: 10,
              cursor: "pointer",
            }}
          >
            {t("sidebar.myResults", "My Results")}
          </button>
        )}

        {loading && <div style={{ color: "#374151", fontSize: 17, fontWeight: 700 }}>{t("sidebar.loading", "Loading...")}</div>}
        {error && <div style={{ color: "#dc2626", fontSize: 15 }}>{error}</div>}
        <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>
          {!loading &&
            !error &&
            filteredClasses.map((c) => (
              <div key={c.classId} style={{ marginBottom: 10 }}>
                <button
                  onClick={() => {
                    const nextOpen = openClassId === c.classId ? null : c.classId;
                    setOpenClassId(nextOpen);
                    if (nextOpen) {
                      go(`/dashboard?classInfo=${c.classId}`);
                    } else {
                      go("/dashboard");
                    }
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 16,
                    border: "1px solid #d7dde6",
                    background: openClassId === c.classId ? "#e8edf6" : "#f7f8fa",
                    cursor: "pointer",
                    fontWeight: 800,
                    fontSize: 18,
                    color: "#121826",
                  }}
                >
                  <span style={{ color: "#9a8df1", marginRight: 8 }}>[ ]</span>
                  {c.className}
                </button>

                {openClassId === c.classId && (
                  <div style={{ marginTop: 8, paddingLeft: 8 }}>
                    {c.joinCode && (
                      <div style={{ padding: "0 8px 8px", fontSize: 14, fontWeight: 700, color: "#5f6f8d" }}>
                        {t("sidebar.joinCode", "Join code")}: <b>{c.joinCode}</b>
                      </div>
                    )}
                    {[
                      { key: "ai", heading: "AI Quiz", items: (c.quizzes || []).filter((q) => isAiQuizTitle(q.title)) },
                      { key: "manual", heading: "Manual Quiz", items: (c.quizzes || []).filter((q) => !isAiQuizTitle(q.title)) },
                    ].map((group) =>
                      group.items.length ? (
                        <div key={`${c.classId}-${group.key}`} style={{ marginBottom: 10 }}>
                          <button
                            type="button"
                            onClick={() => toggleQuizGroup(c.classId, group.key)}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "6px 8px 4px",
                              border: "none",
                              background: "transparent",
                              color: "#64748b",
                              fontSize: 13,
                              fontWeight: 800,
                              letterSpacing: 0.3,
                              cursor: "pointer",
                            }}
                          >
                            <span>{group.heading}</span>
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>
                              {isQuizGroupOpen(c.classId, group.key) ? "▾" : "▸"}
                            </span>
                          </button>
                          {isQuizGroupOpen(c.classId, group.key) && group.items.map((q) => (
                            <div
                              key={q.quizId}
                              onClick={() => {
                                if (q.status === "Draft") {
                                  go(`/quiz/${q.quizId}/edit`);
                                  return;
                                }
                                go(`/quiz/${q.quizId}`);
                              }}
                              style={{
                                padding: "10px 8px",
                                borderRadius: 12,
                                cursor: "pointer",
                                color: "#111827",
                                display: "block",
                                fontWeight: 700,
                                fontSize: 16,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 2 }}>
                                <div style={{ lineHeight: 1.35, whiteSpace: "normal", wordBreak: "normal", overflowWrap: "normal", minWidth: 0, flex: 1 }}>
                                  <span style={{ fontWeight: 800, color: "#111827" }}>
                                    [Quiz ({Number(q.questionCount || 0)} Q)]
                                  </span>
                                  <span style={{ marginLeft: 6 }}>
                                    {formatSidebarQuizTitle(q.title)}
                                  </span>
                                  <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 700, color: "#5f6f8d" }}>
                                    | {Number(q.timeLimitMinutes || 0) > 0 ? `${Number(q.timeLimitMinutes)} min` : "No timer"}
                                  </span>
                                  {q.isAssigned && (
                                    <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 800, color: "#0f766e" }}>(Assigned)</span>
                                  )}
                                  {q.status === "Draft" && (
                                    <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 700, color: "#5f6f8d" }}>(Draft)</span>
                                  )}
                                </div>
                                <div style={{ display: "flex", justifyContent: "flex-end", position: "relative", flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenQuizMenu((current) =>
                                      current && Number(current.quizId) === Number(q.quizId) && Number(current.classId) === Number(c.classId)
                                        ? null
                                        : { quizId: Number(q.quizId), classId: Number(c.classId) }
                                    );
                                  }}
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    color: "#334155",
                                    borderRadius: 10,
                                    fontSize: 20,
                                    lineHeight: 1,
                                    fontWeight: 700,
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                  }}
                                  aria-label="Open quiz actions"
                                >
                                  ...
                                </button>
                                {openQuizMenu && Number(openQuizMenu.quizId) === Number(q.quizId) && Number(openQuizMenu.classId) === Number(c.classId) ? (
                                  <div
                                    ref={quizMenuRef}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      position: "absolute",
                                      top: 34,
                                      right: 0,
                                      minWidth: 180,
                                      background: "#ffffff",
                                      border: "1px solid #d7dde6",
                                      borderRadius: 18,
                                      boxShadow: "0 18px 40px rgba(15, 23, 42, 0.18)",
                                      padding: 8,
                                      zIndex: 20,
                                    }}
                                  >
                                    {isManager ? (
                                      <button
                                        type="button"
                                        onClick={(e) => handleCreateNewDraft(e, q.quizId)}
                                        style={{
                                          width: "100%",
                                          textAlign: "left",
                                          border: "none",
                                          background: "transparent",
                                          color: "#111827",
                                          borderRadius: 12,
                                          fontSize: 14,
                                          padding: "10px 12px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        New Draft
                                      </button>
                                    ) : null}
                                    {isManager && q.status === "Draft" ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenQuizMenu(null);
                                          go(`/quiz/${q.quizId}/edit`);
                                        }}
                                        style={{
                                          width: "100%",
                                          textAlign: "left",
                                          border: "none",
                                          background: "transparent",
                                          color: "#111827",
                                          borderRadius: 12,
                                          fontSize: 14,
                                          padding: "10px 12px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Edit
                                      </button>
                                    ) : null}
                                    {isManager ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenQuizMenu(null);
                                          go(`/dashboard?assignQuiz=${q.quizId}`);
                                        }}
                                        style={{
                                          width: "100%",
                                          textAlign: "left",
                                          border: "none",
                                          background: "transparent",
                                          color: "#111827",
                                          borderRadius: 12,
                                          fontSize: 14,
                                          padding: "10px 12px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Assign
                                      </button>
                                    ) : null}
                                    {isManager ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          handleUpdateQuizTimeLimit(e, c.classId, q.quizId, Number(q.timeLimitMinutes || 0));
                                          setOpenQuizMenu(null);
                                        }}
                                        style={{
                                          width: "100%",
                                          textAlign: "left",
                                          border: "none",
                                          background: "transparent",
                                          color: "#111827",
                                          borderRadius: 12,
                                          fontSize: 14,
                                          padding: "10px 12px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Time
                                      </button>
                                    ) : null}
                                    <div style={{ height: 1, background: "#e5e7eb", margin: "6px 4px" }} />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        handleDeleteQuiz(e, q.quizId);
                                        setOpenQuizMenu(null);
                                      }}
                                      style={{
                                        width: "100%",
                                        textAlign: "left",
                                        border: "none",
                                        background: "transparent",
                                        color: "#dc2626",
                                        borderRadius: 12,
                                        fontSize: 14,
                                        padding: "10px 12px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null
                    )}
                    {(c.quizzes || []).length === 0 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteClass(e, c.classId)}
                        style={{
                          marginTop: 8,
                          marginLeft: 8,
                          border: "1px solid #fecaca",
                          background: "#fff1f2",
                          color: "#be123c",
                          borderRadius: 8,
                          fontSize: 14,
                          fontWeight: 700,
                          padding: "6px 10px",
                          cursor: "pointer",
                        }}
                      >
                        {t("sidebar.deleteClass", "Delete Class")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          {!loading && !error && !filteredClasses.length && !!normalizedQuery && (
            <div style={{ color: "#6b7280", fontSize: 14, padding: "6px 2px" }}>
              {msg("sidebar.search.empty", "No classes or quizzes found for")} "{searchQuery}".
            </div>
          )}
        </div>

        {activeOpenClass && (
          <div
            style={{
              border: "1px solid #d7dde6",
              borderRadius: 14,
              background: "#f7f8fa",
              padding: 10,
              marginTop: 10,
              marginBottom: 8,
            }}
          >
            <div style={{ color: "#7484a1", fontWeight: 800, fontSize: 12, letterSpacing: 0.4, marginBottom: 8 }}>
              CLASS ACTIONS
            </div>
            <button
              type="button"
              onClick={() => handleGenerateAiClick(activeOpenClass.classId)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "7px 8px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "#1d4ed8",
                fontWeight: 800,
                fontSize: 16,
                cursor: "pointer",
                marginBottom: 2,
              }}
            >
              + {t("sidebar.createQuiz", "Create Quiz")}
            </button>
            <button
              type="button"
              onClick={() => go(`/study-tools/create?classId=${activeOpenClass.classId}`)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "7px 8px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "#0f766e",
                fontWeight: 800,
                fontSize: 16,
                cursor: "pointer",
                marginBottom: 2,
              }}
            >
              + {t("sidebar.notesFlashcards", "Notes / Flash Cards")}
            </button>
            <button
              type="button"
              onClick={() => go("/study-tools")}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "7px 8px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "#0f766e",
                fontWeight: 800,
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              + {t("sidebar.previousFlashcards", "Previous Flash Cards")}
            </button>
            {(activeOpenClass.quizzes || []).length > 5 && (
              <button
                type="button"
                onClick={() => go(`/dashboard?aiHistory=${activeOpenClass.classId}`)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 8px",
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "#0b5ed7",
                  fontWeight: 800,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                + {t("sidebar.createFromAiHistory", "Create From AI History")}
              </button>
            )}
          </div>
        )}

        {canCreateClass && (
          <button
            type="button"
            onClick={handleCreateClassClick}
            style={{
              width: "100%",
              padding: "12px 12px",
              borderRadius: 999,
              border: "1px solid #d7dde6",
              background: "#f6f7f9",
              cursor: "pointer",
              marginTop: 10,
              marginBottom: 8,
              fontSize: 18,
              fontWeight: 800,
              color: "#111827",
            }}
          >
            <span style={{ color: "#ef8d3a", marginRight: 8 }}>+</span>
            {t("sidebar.createClass", "Create Class")}
          </button>
        )}

        <button
          type="button"
          onClick={() => go("/profile")}
          style={{
            width: "100%",
            padding: "11px 12px",
            borderRadius: 14,
            border: "1px solid #d7dde6",
            background: "#f6f7f9",
            cursor: "pointer",
            marginBottom: 8,
            fontSize: 16,
            fontWeight: 700,
            color: "#334155",
          }}
        >
          {t("sidebar.profile", "Profile")}
        </button>
      </div>
      {showUpgradeModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 80,
            padding: 20,
          }}
          onClick={() => setShowUpgradeModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 96vw)",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              padding: 18,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>{t("sidebar.upgradeModal.title", "AI Practice Locked After Trial")}</h3>
            <p style={{ color: "#4b5563", marginTop: 0 }}>
              {msg("sidebar.upgradeModal.body", "Your free student trial has ended. Upgrade to unlock AI Practice, higher monthly limits, and advanced analytics.")}
            </p>
            <ul style={{ marginTop: 0, marginBottom: 14, color: "#374151" }}>
              <li>{msg("sidebar.upgradeModal.studentBasic", "Student Basic: 50 AI practice quizzes/month")}</li>
              <li>{msg("sidebar.upgradeModal.studentPro", "Student Pro: 200 AI practice quizzes/month + advanced analytics")}</li>
            </ul>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}
              >
                {t("sidebar.close.button", "Close")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUpgradeModal(false);
                  go("/pricing");
                }}
                style={{ border: "none", background: "#16a34a", color: "#fff", borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontWeight: 700 }}
              >
                {t("sidebar.upgrade.button", "Upgrade")}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

