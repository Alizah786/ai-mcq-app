import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiGet } from "../api/http";
import { useUIText } from "../context/UITextContext";

function shuffleList(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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

export default function StudyToolsFlashcards() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loadCategoryKeys, t, msg } = useUIText();
  const classId = Number(searchParams.get("classId") || location.state?.classId || 0) || null;
  const motionTimer = useRef(null);
  const resetTimer = useRef(null);
  const [cards, setCards] = useState([]);
  const [baseCards, setBaseCards] = useState([]);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [versionNo, setVersionNo] = useState(0);
  const [versions, setVersions] = useState([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [motionClass, setMotionClass] = useState("");
  const [lastMove, setLastMove] = useState("next");

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "studyTools.flashcards.title",
      "studyTools.flashcards.close",
      "studyTools.flashcards.question",
      "studyTools.flashcards.answer",
      "studyTools.flashcards.shuffle",
      "studyTools.flashcards.previous",
      "studyTools.flashcards.showQuestion",
      "studyTools.flashcards.showAnswer",
      "studyTools.flashcards.next",
      "studyTools.output.flashcards",
    ]).catch(() => {});
    loadCategoryKeys("UI_MESSAGE", [
      "studyTools.flashcards.none",
      "studyTools.flashcards.loadFailed",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    return () => {
      if (motionTimer.current) clearTimeout(motionTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  function goBackToGrid() {
    const params = new URLSearchParams();
    params.set("tab", "flashcards");
    if (versionNo) params.set("version", String(versionNo));
    if (classId) params.set("classId", String(classId));
    navigate(`/study-tools/${id}?${params.toString()}`, { state: { activeTab: "flashcards", versionNo, returnToGrid: true, classId } });
  }

  async function loadSet(targetVersionNo = null) {
    setBusy(true);
    setErr("");
    try {
      const res = await apiGet(`/api/study-materials/${id}`);
      const sm = res.studyMaterial;
      const preferredVersionNo = Number(targetVersionNo || location.state?.versionNo || 0);
      const selectedVersion =
        preferredVersionNo
          ? (await apiGet(`/api/study-materials/${id}/versions/${preferredVersionNo}`)).version
          : sm.latestVersion || null;
      const flashcards = Array.isArray(selectedVersion?.flashcards) ? selectedVersion.flashcards : [];
      setTitle(selectedVersion?.title || t("studyTools.output.flashcards", "Flash Cards"));
      setSubtitle(`${sm?.subject || "-"} • ${sm?.topic || "-"}`);
      setVersionNo(Number(selectedVersion?.versionNo || sm?.latestVersionNo || 0));
      setVersions(Array.isArray(sm?.versions) ? sm.versions : []);
      setBaseCards(flashcards);
      setCards(shuffleOn ? shuffleList(flashcards) : flashcards);
      setIndex(Math.min(Number(location.state?.initialIndex || 0), Math.max(flashcards.length - 1, 0)));
      setFlipped(false);
      setMotionClass("");
      setLastMove("next");
      if (!flashcards.length) {
        setErr(msg("studyTools.flashcards.none", "No flashcards were generated for this study material."));
      }
    } catch (e) {
      setErr(e.message || msg("studyTools.flashcards.loadFailed", "Failed to load flashcards."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadSet();
  }, [id, location.key]);

  function move(step) {
    if (!cards.length || motionClass) return;
    setLastMove(step > 0 ? "next" : "prev");
    const outClass = step > 0 ? "card-exit-left" : "card-exit-right";
    const inClass = step > 0 ? "card-enter-right" : "card-enter-left";
    setMotionClass(outClass);
    motionTimer.current = setTimeout(() => {
      setIndex((current) => (current + step + cards.length) % cards.length);
      setFlipped(false);
      setMotionClass(inClass);
      resetTimer.current = setTimeout(() => setMotionClass(""), 360);
    }, 200);
  }

  function toggleShuffle() {
    const nextShuffle = !shuffleOn;
    setShuffleOn(nextShuffle);
    setCards(nextShuffle ? shuffleList(baseCards) : [...baseCards]);
    setIndex(0);
    setFlipped(false);
    setMotionClass("");
    setLastMove("next");
  }

  const current = cards[index] || null;
  const progressLabel = useMemo(() => (cards.length ? `${index + 1} / ${cards.length}` : "0 / 0"), [index, cards.length]);

  return (
    <div style={{ maxWidth: 1080 }}>
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
      <style>{`
        .flashcard-stage {
          perspective: 1800px;
          perspective-origin: 50% 35%;
        }
        .flashcard-motion {
          min-height: 420px;
          width: 100%;
          transition: transform 360ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease, filter 220ms ease;
          will-change: transform, opacity;
        }
        .flashcard-motion.card-exit-left {
          transform-origin: right center;
          transform: translateX(-48px) rotateY(-72deg) rotateX(6deg) scale(0.96);
          opacity: 0;
          filter: blur(1px);
        }
        .flashcard-motion.card-exit-right {
          transform-origin: left center;
          transform: translateX(48px) rotateY(72deg) rotateX(6deg) scale(0.96);
          opacity: 0;
          filter: blur(1px);
        }
        .flashcard-motion.card-enter-right {
          transform-origin: left center;
          animation: flashcard-enter-right 360ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .flashcard-motion.card-enter-left {
          transform-origin: right center;
          animation: flashcard-enter-left 360ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .flashcard-flip {
          position: relative;
          min-height: 420px;
          width: 100%;
          transform-style: preserve-3d;
          transition: transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1);
          will-change: transform;
        }
        .flashcard-flip.is-flipped {
          transform: rotateY(180deg);
        }
        .flashcard-face {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          border-radius: 24px;
          padding: 36px;
          box-shadow: inset 0 0 0 1px #e5e7eb;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .flashcard-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 20px;
          padding: 10px 24px 20px;
        }
        .flashcard-tags {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: auto;
        }
        .flashcard-face.back {
          transform: rotateY(180deg);
          background: linear-gradient(135deg, #eff6ff, #dbeafe);
        }
        .flashcard-face.front {
          background: linear-gradient(135deg, #ffffff, #f8fafc);
        }
        .flashcard-face::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 24px;
          pointer-events: none;
          background: linear-gradient(115deg, rgba(255,255,255,0.32), transparent 38%, transparent 62%, rgba(15,23,42,0.06));
          opacity: 0.8;
        }
        @keyframes flashcard-enter-right {
          from {
            opacity: 0;
            transform: translateX(54px) rotateY(76deg) rotateX(8deg) scale(0.95);
            filter: blur(1px);
          }
          to {
            opacity: 1;
            transform: translateX(0) rotateY(0deg) rotateX(0deg) scale(1);
            filter: blur(0);
          }
        }
        @keyframes flashcard-enter-left {
          from {
            opacity: 0;
            transform: translateX(-54px) rotateY(-76deg) rotateX(8deg) scale(0.95);
            filter: blur(1px);
          }
          to {
            opacity: 1;
            transform: translateX(0) rotateY(0deg) rotateX(0deg) scale(1);
            filter: blur(0);
          }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>{t("studyTools.flashcards.title", "Flash Cards")}</h2>
          <div style={{ color: "#64748b", fontSize: 13 }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select
            value={versionNo || ""}
            onChange={(e) => loadSet(Number(e.target.value))}
            style={{ padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }}
          >
            {versions.map((v) => (
              <option key={v.versionNo} value={v.versionNo}>v{v.versionNo}</option>
            ))}
          </select>
        </div>
      </div>

      {err ? (
        <div style={{ border: "1px solid #fecaca", background: "#fff1f2", color: "#9f1239", borderRadius: 12, padding: 12, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 24, background: "#ffffff", minHeight: 620, padding: 28, display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)", position: "relative" }}>
        <div
          role="button"
          tabIndex={0}
          onClick={goBackToGrid}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              goBackToGrid();
            }
          }}
          aria-label={t("studyTools.flashcards.close", "Close")}
          title={t("studyTools.flashcards.close", "Close")}
          style={{
            position: "absolute",
            top: 18,
            right: 28,
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: "#ffffff",
            color: "#334155",
            fontSize: 20,
            fontWeight: 800,
            cursor: "pointer",
            lineHeight: 1,
            display: "grid",
            placeItems: "center",
            zIndex: 2,
            overflow: "hidden",
            boxSizing: "border-box",
            boxShadow: "0 8px 24px rgba(15,23,42,0.08), inset 0 0 0 1px #d1d5db",
            userSelect: "none",
          }}
        >
          <span style={{ display: "block", transform: "translateY(-1px)" }}>×</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#334155", fontSize: 14 }}>
          <div style={{ fontWeight: 700 }}>{title || t("studyTools.output.flashcards", "Flash Cards")}</div>
          <div>{progressLabel}</div>
        </div>

        <div className="flashcard-stage">
          <button
            type="button"
            onClick={() => setFlipped((value) => !value)}
            disabled={!current || busy}
            style={{ border: "none", background: "transparent", width: "100%", padding: 0, cursor: current ? "pointer" : "default" }}
          >
            <div className={`flashcard-motion ${motionClass}`.trim()}>
              <div className={`flashcard-flip ${flipped ? "is-flipped" : ""}`.trim()}>
                <div className="flashcard-face front">
                  <div style={{ color: "#64748b", fontSize: 13, marginBottom: 8, fontWeight: 700, textAlign: "center" }}>{t("studyTools.flashcards.question", "Question")}</div>
                  <div className="flashcard-content">
                    <div style={{ fontSize: 42, lineHeight: 1.35, color: "#0f172a", fontWeight: 500, maxWidth: 820 }}>
                      {renderInlineText(current ? current.front || "-" : msg("studyTools.flashcards.none", "No flashcards were generated for this study material."), "player-front")}
                    </div>
                  </div>
                  {Array.isArray(current?.tags) && current.tags.length ? (
                    <div className="flashcard-tags">
                      {current.tags.map((tag, idx) => (
                        <span key={`${tag}-${idx}`} style={{ border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 999, padding: "6px 10px", fontSize: 12, color: "#475569" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flashcard-face back">
                  <div style={{ color: "#475569", fontSize: 13, marginBottom: 8, fontWeight: 700, textAlign: "center" }}>{t("studyTools.flashcards.answer", "Answer")}</div>
                  <div className="flashcard-content">
                    <div style={{ fontSize: 42, lineHeight: 1.35, color: "#0f172a", fontWeight: 500, maxWidth: 820 }}>
                      {renderInlineText(current ? current.back || "-" : msg("studyTools.flashcards.none", "No flashcards were generated for this study material."), "player-back")}
                    </div>
                  </div>
                  {Array.isArray(current?.tags) && current.tags.length ? (
                    <div className="flashcard-tags">
                      {current.tags.map((tag, idx) => (
                        <span key={`${tag}-${idx}`} style={{ border: "1px solid #93c5fd", background: "rgba(255,255,255,0.55)", borderRadius: 999, padding: "6px 10px", fontSize: 12, color: "#334155" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#4f46e5", fontWeight: 700 }}>
              {t("studyTools.flashcards.shuffle", "Shuffle cards")}
              <input type="checkbox" checked={shuffleOn} onChange={toggleShuffle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <button type="button" onClick={() => move(-1)} disabled={!cards.length || !!motionClass} style={{ padding: "14px 18px", borderRadius: 999, border: "1px solid #cbd5e1", background: "#eef2ff", color: "#334155", fontSize: 16, fontWeight: 700, cursor: "pointer", minWidth: 116, boxShadow: lastMove === "prev" && motionClass ? "0 8px 18px rgba(99,102,241,0.18)" : "none" }}>{t("studyTools.flashcards.previous", "Previous")}</button>
            <button type="button" onClick={() => setFlipped((value) => !value)} disabled={!cards.length || !!motionClass} style={{ padding: "14px 24px", borderRadius: 999, border: "none", background: "#111827", color: "#fff", fontWeight: 700, cursor: "pointer", minWidth: 146, boxShadow: "0 10px 28px rgba(15,23,42,0.22)" }}>{flipped ? t("studyTools.flashcards.showQuestion", "Show Question") : t("studyTools.flashcards.showAnswer", "Show Answer")}</button>
            <button type="button" onClick={() => move(1)} disabled={!cards.length || !!motionClass} style={{ padding: "14px 18px", borderRadius: 999, border: "1px solid #cbd5e1", background: "#eef2ff", color: "#334155", fontSize: 16, fontWeight: 700, cursor: "pointer", minWidth: 116, boxShadow: lastMove === "next" && motionClass ? "0 8px 18px rgba(99,102,241,0.18)" : "none" }}>{t("studyTools.flashcards.next", "Next")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}


