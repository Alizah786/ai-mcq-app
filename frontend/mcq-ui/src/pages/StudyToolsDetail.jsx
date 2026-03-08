import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../api/http";
import { useUIText } from "../context/UITextContext";

function emptyVersion() {
  return {
    versionNo: 0,
    title: "",
    summary: "",
    keywords: [],
    notesMarkdown: "",
    flashcards: [],
    assignments: [],
    isUserEdited: false,
  };
}

function renderInlineText(value, keyPrefix = "inline") {
  const text = String(value || "");
  const regex = /\^(\{[^}]+\}|[A-Za-z0-9+\-]+)/g;
  const nodes = [];
  let lastIndex = 0;
  let match;
  let partIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const rawExponent = match[1] || "";
    const exponent = rawExponent.startsWith("{") && rawExponent.endsWith("}") ? rawExponent.slice(1, -1) : rawExponent;
    nodes.push(
      <sup key={`${keyPrefix}-sup-${partIndex}`} style={{ fontSize: "0.72em", verticalAlign: "super" }}>
        {exponent}
      </sup>,
    );
    lastIndex = regex.lastIndex;
    partIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderInlineBlockText(value, keyPrefix = "block") {
  const lines = String(value || "").split(/\r?\n/);
  return lines.map((line, idx) => (
    <span key={`${keyPrefix}-line-${idx}`}>
      {renderInlineText(line, `${keyPrefix}-${idx}`)}
      {idx < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

function renderSimpleMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  let listItems = [];

  function flushList() {
    if (!listItems.length) return;
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
      continue;
    }
    flushList();
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: trimmed.slice(3) });
    } else if (trimmed.startsWith("# ")) {
      blocks.push({ type: "h1", text: trimmed.slice(2) });
    } else {
      blocks.push({ type: "p", text: trimmed });
    }
  }
  flushList();

  return blocks.map((block, idx) => {
    if (block.type === "h1") {
      return <h1 key={`md-${idx}`} style={{ fontSize: 28, marginTop: idx === 0 ? 0 : 20, marginBottom: 10 }}>{renderInlineText(block.text, `md-h1-${idx}`)}</h1>;
    }
    if (block.type === "h2") {
      return <h2 key={`md-${idx}`} style={{ fontSize: 20, marginTop: 20, marginBottom: 8, color: "#0f172a" }}>{renderInlineText(block.text, `md-h2-${idx}`)}</h2>;
    }
    if (block.type === "list") {
      return (
        <ul key={`md-${idx}`} style={{ marginTop: 0, marginBottom: 14, paddingLeft: 22, color: "#334155" }}>
          {block.items.map((item, itemIdx) => (
            <li key={`md-${idx}-${itemIdx}`} style={{ marginBottom: 6, lineHeight: 1.6 }}>{renderInlineText(item, `md-li-${idx}-${itemIdx}`)}</li>
          ))}
        </ul>
      );
    }
    return <p key={`md-${idx}`} style={{ marginTop: 0, marginBottom: 12, lineHeight: 1.7, color: "#334155" }}>{renderInlineText(block.text, `md-p-${idx}`)}</p>;
  });
}

function compactText(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

export default function StudyToolsDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { loadCategoryKeys, t, msg } = useUIText();
  const [searchParams] = useSearchParams();
  const classId = Number(searchParams.get("classId") || location.state?.classId || 0) || null;
  const [data, setData] = useState(null);
  const initialTab = searchParams.get("tab") || location.state?.activeTab || "notes";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedVersionNo, setSelectedVersionNo] = useState(0);
  const [editing, setEditing] = useState(emptyVersion());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [warning, setWarning] = useState(location.state?.warning || "");
  const [editMode, setEditMode] = useState({ notes: false, summary: false, keywords: false, flashcards: false });
  const [editAssignments, setEditAssignments] = useState(false);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "studyTools.detail.title",
      "studyTools.detail.status.queued",
      "studyTools.detail.studyFlashcards",
      "studyTools.detail.regenerate",
      "studyTools.detail.progress.title",
      "studyTools.detail.progress.queued",
      "studyTools.detail.progress.processing",
      "studyTools.output.flashcards",
      "studyTools.output.assessment",
      "studyTools.detail.editNotes",
      "studyTools.detail.previewNotes",
      "studyTools.detail.editSummary",
      "studyTools.detail.previewSummary",
      "studyTools.detail.noSummary",
      "studyTools.detail.editKeywords",
      "studyTools.detail.previewKeywords",
      "studyTools.detail.flashcards.clickHint",
      "studyTools.detail.card",
      "studyTools.detail.study",
      "studyTools.detail.editFlashcards",
      "studyTools.detail.previewFlashcards",
      "studyTools.detail.editAssessment",
      "studyTools.detail.previewAssessment",
      "studyTools.detail.assignment",
      "studyTools.detail.question",
      "studyTools.detail.example",
      "studyTools.detail.explanation",
      "studyTools.detail.back",
      "studyTools.detail.tryAgain",
      "studyTools.detail.save",
      "studyTools.detail.saved",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "studyTools.detail.loadFailed",
      "studyTools.detail.versionLoadFailed",
      "studyTools.detail.saveFailed",
      "studyTools.detail.regenerateFailed",
      "studyTools.detail.failedBanner",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  async function loadSet(preferredVersionNo = null) {
    const res = await apiGet(`/api/study-materials/${id}`);
    const sm = res.studyMaterial;
    setData(sm);
    const targetVersionNo = Number(preferredVersionNo || searchParams.get("version") || location.state?.versionNo || sm.latestVersion?.versionNo || sm.latestVersionNo || 0);
    const version =
      targetVersionNo && Number(sm.latestVersion?.versionNo || 0) !== targetVersionNo
        ? (await apiGet(`/api/study-materials/${id}/versions/${targetVersionNo}`)).version
        : sm.latestVersion || emptyVersion();
    setSelectedVersionNo(Number(version?.versionNo || targetVersionNo || 0));
    setEditing(version || emptyVersion());
    setEditMode({ notes: false, summary: false, keywords: false, flashcards: false });
    setEditAssignments(false);
    const out = Array.isArray(sm.outputs) ? sm.outputs : [];
    const preferredTab = searchParams.get("tab") || location.state?.activeTab || activeTab;
    if (out.includes(preferredTab)) {
      setActiveTab(preferredTab);
    } else if (!out.includes(activeTab)) {
      setActiveTab(out[0] || "notes");
    }
  }

  useEffect(() => {
    let alive = true;
    async function run() {
      try {
        await loadSet();
      } catch (e) {
        if (!alive) return;
        setErr(e.message || msg("studyTools.detail.loadFailed", "Failed to load study material."));
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [id, location.key, searchParams]);

  useEffect(() => {
    if (!data) return;
    const st = String(data.status || "");
    if (st !== "Queued" && st !== "Processing") return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await apiGet(`/api/study-materials/${id}`);
        if (!alive) return;
        const sm = res.studyMaterial;
        setData(sm);
        if (String(sm.status || "") === "Completed") {
          const preferredVersionNo = Number(searchParams.get("version") || location.state?.versionNo || sm.latestVersion?.versionNo || sm.latestVersionNo || 0);
          const version =
            preferredVersionNo && Number(sm.latestVersion?.versionNo || 0) !== preferredVersionNo
              ? (await apiGet(`/api/study-materials/${id}/versions/${preferredVersionNo}`)).version
              : sm.latestVersion || emptyVersion();
          setEditing(version || emptyVersion());
          setSelectedVersionNo(Number(version?.versionNo || preferredVersionNo || 0));
          setEditMode({ notes: false, summary: false, keywords: false, flashcards: false });
          setEditAssignments(false);
        }
      } catch {
        if (!alive) return;
      }
    }, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [data?.status, id, location.state?.versionNo, searchParams]);

  async function loadVersion(versionNo) {
    setErr("");
    try {
      const r = await apiGet(`/api/study-materials/${id}/versions/${versionNo}`);
      setSelectedVersionNo(Number(versionNo));
      setEditing(r.version || emptyVersion());
      setEditMode({ notes: false, summary: false, keywords: false, flashcards: false });
      setEditAssignments(false);
    } catch (e) {
      setErr(e.message || msg("studyTools.detail.versionLoadFailed", "Failed to load version."));
    }
  }

  async function saveEdits() {
    if (!selectedVersionNo) return;
    setBusy(true);
    setErr("");
    try {
      await apiPut(`/api/study-materials/${id}/versions/${selectedVersionNo}`, {
        summary: editing.summary || "",
        keywords: Array.isArray(editing.keywords) ? editing.keywords : [],
        notesMarkdown: editing.notesMarkdown || "",
        flashcards: Array.isArray(editing.flashcards) ? editing.flashcards : [],
        assignments: Array.isArray(editing.assignments) ? editing.assignments : [],
      });
      setToast(t("studyTools.detail.saved", "Saved"));
      setTimeout(() => setToast(""), 1500);
      await loadSet(selectedVersionNo);
    } catch (e) {
      setErr(e.message || msg("studyTools.detail.saveFailed", "Failed to save."));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setErr("");
    try {
      await apiPost(`/api/study-materials/${id}/regenerate`, {});
      await loadSet();
    } catch (e) {
      setErr(e.message || msg("studyTools.detail.regenerateFailed", "Failed to regenerate."));
    } finally {
      setBusy(false);
    }
  }

  const outputs = useMemo(() => (Array.isArray(data?.outputs) ? data.outputs : []), [data?.outputs]);
  const status = String(data?.status || "");
  const progressPercent = status === "Queued" ? 24 : status === "Processing" ? 72 : status === "Completed" ? 100 : 0;

  return (
    <div style={{ maxWidth: 1280 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" onClick={() => navigate("/dashboard")} style={{ padding: 0, border: "none", background: "transparent", color: "#1d4ed8", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {"< Back to Dashboard"}
        </button>
        {classId ? (
          <button type="button" onClick={() => navigate(`/dashboard?classInfo=${classId}`)} style={{ padding: 0, border: "none", background: "transparent", color: "#1d4ed8", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {"< Back to Class Details"}
          </button>
        ) : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>{t("studyTools.detail.title", "Notes / Flash Cards / Assessment")}</h2>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            {data?.subject || "-"} • {data?.topic || "-"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #d1d5db", background: status === "Completed" ? "#ecfdf5" : status === "Failed" ? "#fef2f2" : "#eff6ff", color: status === "Completed" ? "#065f46" : status === "Failed" ? "#991b1b" : "#1d4ed8", fontWeight: 700, fontSize: 12 }}>
            {status || t("studyTools.detail.status.queued", "Queued")}
          </span>
          <select value={selectedVersionNo || ""} onChange={(e) => loadVersion(Number(e.target.value))} style={{ padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }}>
            {(data?.versions || []).map((v) => (
              <option key={v.versionNo} value={v.versionNo}>v{v.versionNo}</option>
            ))}
          </select>
          {outputs.includes("flashcards") && Array.isArray(editing.flashcards) && editing.flashcards.length ? (
            <button type="button" onClick={() => navigate(`/study-tools/${id}/flashcards`, { state: { initialIndex: 0, versionNo: selectedVersionNo, returnToGrid: true } })} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>{t("studyTools.detail.studyFlashcards", "Study Flash Cards")}</button>
          ) : null}
          <button type="button" onClick={regenerate} disabled={busy} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>{t("studyTools.detail.regenerate", "Regenerate")}</button>
        </div>
      </div>

      {(status === "Queued" || status === "Processing") && (
        <div style={{ border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 10, padding: 12, color: "#1e3a8a", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("studyTools.detail.progress.title", "Working on it... this may take a moment.")}</div>
          <div style={{ width: "100%", height: 12, borderRadius: 999, background: "#dbeafe", overflow: "hidden", marginTop: 8 }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg, #2563eb 0%, #38bdf8 100%)",
                transition: "width 600ms ease",
              }}
            />
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            {status === "Queued"
              ? t("studyTools.detail.progress.queued", "Queued for generation")
              : t("studyTools.detail.progress.processing", "Generating notes and study material")}
          </div>
        </div>
      )}
      {!!warning && (
        <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: 12, color: "#92400e", marginBottom: 12 }}>
          {warning}
        </div>
      )}
      {status === "Failed" && (
        <div style={{ border: "1px solid #fecaca", background: "#fff1f2", borderRadius: 10, padding: 12, color: "#9f1239", marginBottom: 12 }}>
          {msg("studyTools.detail.failedBanner", "Unable to generate study materials right now. Please try again.")}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {outputs.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setActiveTab(o)}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 999,
              background: activeTab === o ? "#e0f2fe" : "#fff",
              color: activeTab === o ? "#0c4a6e" : "#111827",
              fontWeight: 700,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            {o === "flashcards" ? t("studyTools.output.flashcards", "Flash Cards") : o === "assignments" ? t("studyTools.output.assessment", "Assessment") : o[0].toUpperCase() + o.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fff" }}>
        {activeTab === "notes" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button type="button" onClick={() => setEditMode((p) => ({ ...p, notes: !p.notes }))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: editMode.notes ? "#e0f2fe" : "#fff", cursor: "pointer" }}>
                {editMode.notes ? t("studyTools.detail.previewNotes", "Preview Notes") : t("studyTools.detail.editNotes", "Edit Notes")}
              </button>
            </div>
            {editMode.notes ? (
              <textarea
                rows={16}
                value={editing.notesMarkdown || ""}
                onChange={(e) => setEditing((p) => ({ ...p, notesMarkdown: e.target.value }))}
                style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: 10, resize: "vertical" }}
              />
            ) : (
              <div style={{ padding: 4 }}>{renderSimpleMarkdown(editing.notesMarkdown || "")}</div>
            )}
          </>
        )}

        {activeTab === "summary" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button type="button" onClick={() => setEditMode((p) => ({ ...p, summary: !p.summary }))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: editMode.summary ? "#e0f2fe" : "#fff", cursor: "pointer" }}>
                {editMode.summary ? t("studyTools.detail.previewSummary", "Preview Summary") : t("studyTools.detail.editSummary", "Edit Summary")}
              </button>
            </div>
            {editMode.summary ? (
              <textarea
                rows={8}
                value={editing.summary || ""}
                onChange={(e) => setEditing((p) => ({ ...p, summary: e.target.value.slice(0, 1200) }))}
                style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: 10, resize: "vertical" }}
              />
            ) : (
              <div style={{ color: "#334155", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {editing.summary ? renderInlineBlockText(editing.summary, "summary") : t("studyTools.detail.noSummary", "No summary generated.")}
              </div>
            )}
          </>
        )}

        {activeTab === "keywords" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button type="button" onClick={() => setEditMode((p) => ({ ...p, keywords: !p.keywords }))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: editMode.keywords ? "#e0f2fe" : "#fff", cursor: "pointer" }}>
                {editMode.keywords ? t("studyTools.detail.previewKeywords", "Preview Keywords") : t("studyTools.detail.editKeywords", "Edit Keywords")}
              </button>
            </div>
            {editMode.keywords ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(editing.keywords || []).map((k, idx) => (
                  <input
                    key={`${idx}-${k}`}
                    value={k}
                    onChange={(e) =>
                      setEditing((p) => {
                        const arr = [...(p.keywords || [])];
                        arr[idx] = e.target.value.slice(0, 40);
                        return { ...p, keywords: arr.slice(0, 30) };
                      })
                    }
                    style={{ border: "1px solid #d1d5db", borderRadius: 999, padding: "6px 10px" }}
                  />
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(editing.keywords || []).map((k, idx) => (
                  <span key={`${idx}-${k}`} style={{ border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 999, padding: "6px 10px", color: "#334155" }}>{k}</span>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "flashcards" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
              <div style={{ color: "#64748b", fontSize: 13 }}>{t("studyTools.detail.flashcards.clickHint", "Click any card to open the study player.")}</div>
              <div style={{ display: "flex", gap: 8 }}>
                {!editMode.flashcards ? (
            <button type="button" onClick={() => navigate(`/study-tools/${id}/flashcards${classId ? `?classId=${classId}` : ""}`, { state: { initialIndex: 0, versionNo: selectedVersionNo, returnToGrid: true, classId } })} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
                    {t("studyTools.detail.studyFlashcards", "Study Flash Cards")}
                  </button>
                ) : null}
                <button type="button" onClick={() => setEditMode((p) => ({ ...p, flashcards: !p.flashcards }))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: editMode.flashcards ? "#e0f2fe" : "#fff", cursor: "pointer" }}>
                  {editMode.flashcards ? t("studyTools.detail.previewFlashcards", "Preview Flash Cards") : t("studyTools.detail.editFlashcards", "Edit Flash Cards")}
                </button>
              </div>
            </div>
            {editMode.flashcards ? (
              <div style={{ display: "grid", gap: 10 }}>
                {(editing.flashcards || []).map((card, idx) => (
                  <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{t("studyTools.detail.card", "Card")} {idx + 1}</div>
                    <input
                      value={card.front || ""}
                      onChange={(e) =>
                        setEditing((p) => {
                          const arr = [...(p.flashcards || [])];
                          arr[idx] = { ...arr[idx], front: e.target.value.slice(0, 180) };
                          return { ...p, flashcards: arr.slice(0, 50) };
                        })
                      }
                      placeholder={t("studyTools.detail.question", "Question")}
                      style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8, marginBottom: 6 }}
                    />
                    <textarea
                      rows={3}
                      value={card.back || ""}
                      onChange={(e) =>
                        setEditing((p) => {
                          const arr = [...(p.flashcards || [])];
                          arr[idx] = { ...arr[idx], back: e.target.value.slice(0, 400) };
                          return { ...p, flashcards: arr.slice(0, 50) };
                        })
                      }
                      placeholder={t("studyTools.detail.explanation", "Explanation")}
                      style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8, resize: "vertical" }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, alignItems: "stretch" }}>
                {(editing.flashcards || []).map((card, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => navigate(`/study-tools/${id}/flashcards${classId ? `?classId=${classId}` : ""}`, { state: { initialIndex: idx, versionNo: selectedVersionNo, returnToGrid: true, classId } })}
                    style={{
                      textAlign: "left",
                      border: "1px solid #e2e8f0",
                      borderRadius: 18,
                      padding: 18,
                      background: "linear-gradient(180deg, #ffffff, #f8fafc)",
                      cursor: "pointer",
                      minHeight: 230,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      boxShadow: "0 12px 28px rgba(15, 23, 42, 0.05)",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>{t("studyTools.detail.card", "Card")} {idx + 1}</div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a", lineHeight: 1.45, marginBottom: 12 }}>{renderInlineText(card.front || "-", `grid-front-${idx}`)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#475569", lineHeight: 1.65, marginBottom: 14 }}>{renderInlineText(compactText(card.back || "-", 170), `grid-back-${idx}`)}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {(card.tags || []).slice(0, 2).map((tag, tagIdx) => (
                            <span key={`${tag}-${tagIdx}`} style={{ border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 999, padding: "4px 8px", fontSize: 11, color: "#475569" }}>{tag}</span>
                          ))}
                        </div>
                        <span style={{ color: "#2563eb", fontSize: 12, fontWeight: 700 }}>{t("studyTools.detail.study", "Study")}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "assignments" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => setEditAssignments((value) => !value)}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: editAssignments ? "#e0f2fe" : "#fff", cursor: "pointer" }}
              >
                {editAssignments ? t("studyTools.detail.previewAssessment", "Preview Assessment") : t("studyTools.detail.editAssessment", "Edit Assessment")}
              </button>
            </div>
            {editAssignments ? (
              <div style={{ display: "grid", gap: 12 }}>
                {(editing.assignments || []).map((item, idx) => (
                  <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{t("studyTools.detail.assignment", "Assignment")} {idx + 1}</div>
                    <textarea
                      rows={3}
                      value={item.question || ""}
                      onChange={(e) =>
                        setEditing((p) => {
                          const arr = [...(p.assignments || [])];
                          arr[idx] = { ...arr[idx], question: e.target.value.slice(0, 1200) };
                          return { ...p, assignments: arr };
                        })
                      }
                      placeholder={t("studyTools.detail.question", "Question")}
                      style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8, resize: "vertical", marginBottom: 8 }}
                    />
                    <textarea
                      rows={3}
                      value={item.example || ""}
                      onChange={(e) =>
                        setEditing((p) => {
                          const arr = [...(p.assignments || [])];
                          arr[idx] = { ...arr[idx], example: e.target.value.slice(0, 2000) };
                          return { ...p, assignments: arr };
                        })
                      }
                      placeholder={t("studyTools.detail.example", "Example")}
                      style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8, resize: "vertical", marginBottom: 8 }}
                    />
                    <textarea
                      rows={4}
                      value={item.explanation || ""}
                      onChange={(e) =>
                        setEditing((p) => {
                          const arr = [...(p.assignments || [])];
                          arr[idx] = { ...arr[idx], explanation: e.target.value.slice(0, 3000) };
                          return { ...p, assignments: arr };
                        })
                      }
                      placeholder={t("studyTools.detail.explanation", "Explanation")}
                      style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 8, resize: "vertical" }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {(editing.assignments || []).map((item, idx) => (
                  <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#f8fafc" }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{t("studyTools.detail.assignment", "Assignment")} {idx + 1}</div>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 18, marginBottom: 10 }}>{renderInlineText(item.question || "-", `assignment-question-${idx}`)}</div>
                    {!!item.example && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, color: "#334155", marginBottom: 4 }}>{t("studyTools.detail.example", "Example")}</div>
                        <div style={{ color: "#334155", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{renderInlineBlockText(item.example, `assignment-example-${idx}`)}</div>
                      </div>
                    )}
                    {!!item.explanation && (
                      <div>
                        <div style={{ fontWeight: 700, color: "#334155", marginBottom: 4 }}>{t("studyTools.detail.explanation", "Explanation")}</div>
                        <div style={{ color: "#334155", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{renderInlineBlockText(item.explanation, `assignment-explanation-${idx}`)}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {err ? <div style={{ color: "#b91c1c", marginTop: 10 }}>{err}</div> : null}
      {toast ? <div style={{ color: "#047857", marginTop: 10 }}>{toast}</div> : null}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <button type="button" onClick={() => navigate(classId ? `/dashboard?classInfo=${classId}` : "/dashboard")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>{t("studyTools.detail.back", "Back")}</button>
        <div style={{ display: "flex", gap: 8 }}>
          {status === "Failed" ? (
            <button type="button" onClick={regenerate} disabled={busy} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>{t("studyTools.detail.tryAgain", "Try Again")}</button>
          ) : null}
          <button type="button" onClick={saveEdits} disabled={busy} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontWeight: 700 }}>{t("studyTools.detail.save", "Save")}</button>
        </div>
      </div>
    </div>
  );
}

