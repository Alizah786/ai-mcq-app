import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiGet } from "../api/http";
import { useUIText } from "../context/UITextContext";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

export default function StudyToolsList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loadCategoryKeys, t, msg } = useUIText();
  const classId = Number(searchParams.get("classId") || 0) || null;
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "studyTools.list.title",
      "studyTools.list.subtitle",
      "studyTools.list.createNew",
      "studyTools.list.loading",
      "studyTools.list.empty",
      "studyTools.list.created",
      "studyTools.list.updated",
      "studyTools.list.open",
      "studyTools.list.studyFlashcards",
      "studyTools.output.flashcards",
      "studyTools.output.assessment",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", ["studyTools.list.loadFailed"]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setBusy(true);
      setErr("");
      try {
        const res = await apiGet("/api/study-materials");
        if (!alive) return;
        setItems(Array.isArray(res.studyMaterials) ? res.studyMaterials : []);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || msg("studyTools.list.loadFailed", "Failed to load study materials."));
      } finally {
        if (alive) setBusy(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (String(item.status || "").toLowerCase() === "failed") return false;
        const outputs = Array.isArray(item.outputs) ? item.outputs : [];
        return outputs.length > 0;
      }),
    [items]
  );

  function openStudyMaterial(item) {
    const outputs = Array.isArray(item.outputs) ? item.outputs : [];
    const preferredTab = outputs.includes("flashcards")
      ? "flashcards"
      : outputs.includes("assignments")
        ? "assignments"
      : outputs.includes("notes")
        ? "notes"
        : outputs[0] || "notes";
    const params = new URLSearchParams();
    params.set("tab", preferredTab);
    params.set("version", String(item.latestVersionNo || 1));
    if (classId) params.set("classId", String(classId));
    navigate(`/study-tools/${item.studyMaterialSetId}?${params.toString()}`);
  }

  return (
    <div style={{ maxWidth: 1180 }}>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>{t("studyTools.list.title", "My Study Materials")}</h2>
          <div style={{ color: "#64748b", fontSize: 14 }}>{t("studyTools.list.subtitle", "Open previously created notes, flash cards, and assessments.")}</div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/study-tools/create${classId ? `?classId=${classId}` : ""}`)}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontWeight: 700 }}
        >
          {t("studyTools.list.createNew", "Create New")}
        </button>
      </div>

      {busy ? <div style={{ color: "#334155", fontWeight: 700 }}>{t("studyTools.list.loading", "Loading...")}</div> : null}
      {err ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{err}</div> : null}
      {!busy && !err && visibleItems.length === 0 ? (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 18, background: "#fff" }}>
          {t("studyTools.list.empty", "No completed study materials found.")}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 14 }}>
        {visibleItems.map((item) => {
          const outputs = Array.isArray(item.outputs) ? item.outputs : [];
          const hasFlashcards = outputs.includes("flashcards") && Number(item.flashcardCount || 0) > 0;
          const hasOpenableContent = outputs.length > 0;

          return (
            <div
              key={item.studyMaterialSetId}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 16,
                background: "#fff",
                padding: 18,
                display: "flex",
                justifyContent: "space-between",
                gap: 18,
                alignItems: "center",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>{item.subject || "-"}</div>
                  <span style={{ color: "#64748b", fontSize: 13 }}>•</span>
                  <div style={{ color: "#334155", fontWeight: 700 }}>{item.topic || "-"}</div>
                  <span style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #d1d5db", background: item.status === "Completed" ? "#ecfdf5" : "#eff6ff", color: item.status === "Completed" ? "#065f46" : "#1d4ed8", fontSize: 12, fontWeight: 800 }}>
                    {item.status}
                  </span>
                </div>
                <div style={{ color: "#64748b", fontSize: 13, marginBottom: 10 }}>
                  {t("studyTools.list.created", "Created")} {formatDate(item.createdAtUtc)} • {t("studyTools.list.updated", "Updated")} {formatDate(item.updatedAtUtc)} • v{item.latestVersionNo || 1}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {outputs.map((output) => (
                    <span key={`${item.studyMaterialSetId}-${output}`} style={{ border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 999, padding: "5px 9px", fontSize: 12, color: "#475569", fontWeight: 700 }}>
                      {output === "flashcards"
                        ? `${t("studyTools.output.flashcards", "Flash Cards")}${item.flashcardCount ? ` (${item.flashcardCount})` : ""}`
                        : output === "assignments"
                          ? `${t("studyTools.output.assessment", "Assessment")}${item.assignmentCount ? ` (${item.assignmentCount})` : ""}`
                          : output[0].toUpperCase() + output.slice(1)}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {hasOpenableContent ? (
                  <button
                    type="button"
                    onClick={() => openStudyMaterial(item)}
                    style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontWeight: 700 }}
                  >
                    {t("studyTools.list.open", "Open")}
                  </button>
                ) : null}
                {hasFlashcards ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/study-tools/${item.studyMaterialSetId}/flashcards${classId ? `?classId=${classId}` : ""}`, { state: { initialIndex: 0, versionNo: item.latestVersionNo, returnToGrid: true, classId } })}
                    style={{ padding: "9px 12px", borderRadius: 10, border: "none", background: "#0f766e", color: "#fff", cursor: "pointer", fontWeight: 700 }}
                  >
                    {t("studyTools.list.studyFlashcards", "Study Flash Cards")}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

