import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/http";
import { useAuth } from "../context/AuthContext";
import { useUIText } from "../context/UITextContext";
import { getRoleCode } from "../utils/domainCodes";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import InlineAlert from "../components/ui/InlineAlert";
import { orderQuizQuestions } from "./quizUtils";

const PLAYFIELD_HEIGHT = 620;
const PLAYER_WIDTH = 72;
const PLAYER_HEIGHT = 46;
const PLAYER_Y_OFFSET = 78;
const PROJECTILE_SIZE = 12;
const STEP_MS = 34;
const PROJECTILE_SPEED = 16;
const START_DELAY_OPTIONS = [2, 4, 8, 12, 16, 20, 24];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shuffleArray(items) {
  const next = Array.isArray(items) ? [...items] : [];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function getNormalizedOptionId(option) {
  return (
    option?.optionId ??
    option?.id ??
    option?.questionOptionId ??
    option?.answerOptionId ??
    null
  );
}

function buildRoundTuning(settings = {}) {
  const startDelaySeconds = Number(settings?.startDelaySeconds || 6);
  const fallMultiplier = Number(settings?.fallMultiplier || 1);
  return {
    readDelayMs: Math.max(0, startDelaySeconds * 1000),
    fallMultiplier: clamp(fallMultiplier, 0.5, 2),
  };
}

export function buildTargets(question, width, tuning) {
  const options = shuffleArray(Array.isArray(question?.options) ? question.options : []);
  const laneCount = Math.max(options.length, 1);
  const laneWidth = Math.max((width - 44) / laneCount, 120);

  return options.map((option, index) => {
    const text = String(option.text || `Option ${index + 1}`);
    const estimatedWidth = 74 + Math.min(text.length * 9, 170);
    const estimatedHeight = text.length > 22 ? 86 : 70;
    const cardWidth = clamp(Math.min(laneWidth - 12, estimatedWidth), 96, 210);
    const laneCenter = 22 + laneWidth * index + laneWidth / 2;
    const jitter = ((index % 2 === 0 ? -1 : 1) * Math.min(18, laneWidth * 0.12));
    const normalizedOptionId = getNormalizedOptionId(option);
    return {
      id: `target-${normalizedOptionId ?? index}`,
      optionId: normalizedOptionId,
      label: String.fromCharCode(65 + index),
      text,
      isCorrect: !!option.isCorrect,
      x: clamp(laneCenter - cardWidth / 2 + jitter, 12, Math.max(12, width - cardWidth - 12)),
      y: -(index * 86),
      width: cardWidth,
      height: estimatedHeight,
      speed: (1.15 + index * 0.08) * (tuning?.fallMultiplier || 1),
      drift: (index % 2 === 0 ? 0.18 : -0.18) * Math.max(0.65, tuning?.fallMultiplier || 1),
    };
  });
}

export function resolveArcadeRoundFrame({
  fieldWidth,
  lives,
  hits,
  misses,
  roundState,
  roundMessage,
  roundColor,
  roundCorrectOptionId,
  projectiles,
  targets,
}) {
  const nextProjectiles = (Array.isArray(projectiles) ? projectiles : [])
    .map((projectile) => ({ ...projectile, y: projectile.y - PROJECTILE_SPEED }))
    .filter((projectile) => projectile.y + projectile.height > 0);

  let nextTargets = (Array.isArray(targets) ? targets : []).map((target, index, allTargets) => {
    const speedMultiplier = allTargets.length === 1 ? 2.8 : 1;
    return {
      ...target,
      x: clamp(target.x + target.drift, 8, Math.max(8, fieldWidth - target.width - 8)),
      y: target.y + target.speed * speedMultiplier,
      drift:
        target.x <= 8 || target.x + target.width >= fieldWidth - 8
          ? target.drift * -1
          : target.drift,
    };
  });

  const consumedProjectiles = new Set();
  const removedTargets = new Set();
  let nextState = roundState;
  let nextMessage = roundMessage;
  let nextColor = roundColor;
  let nextLives = lives;
  let nextHits = hits;
  let nextMisses = misses;
  let selectedOptionId = null;

  for (let pIndex = 0; pIndex < nextProjectiles.length; pIndex += 1) {
    const projectile = nextProjectiles[pIndex];
    for (let tIndex = 0; tIndex < nextTargets.length; tIndex += 1) {
      const target = nextTargets[tIndex];
      if (removedTargets.has(target.id)) continue;
      if (!intersects(projectile, target)) continue;
      consumedProjectiles.add(pIndex);
      if (target.isCorrect) {
        nextState = "failed";
        nextMessage = "Wrong shot. You hit the correct answer.";
        nextColor = "#b91c1c";
        nextLives = Math.max(0, nextLives - 1);
      } else {
        removedTargets.add(target.id);
        nextHits += 1;
      }
      break;
    }
    if (nextState === "failed") break;
  }

  nextProjectiles.splice(0, nextProjectiles.length, ...nextProjectiles.filter((_, index) => !consumedProjectiles.has(index)));
  nextTargets = nextTargets.filter((target) => !removedTargets.has(target.id));

  const failLineY = PLAYFIELD_HEIGHT - PLAYER_Y_OFFSET + 12;

  if (nextState === "playing") {
    const escapedWrongExists = nextTargets.some(
      (target) => !target.isCorrect && target.y + target.height >= failLineY
    );
    if (escapedWrongExists) {
      nextState = "failed";
      nextMessage = "A wrong answer slipped through.";
      nextColor = "#b91c1c";
      nextMisses += 1;
      nextLives = Math.max(0, nextLives - 1);
      nextTargets = [];
      nextProjectiles.splice(0, nextProjectiles.length);
    }
  }

  if (nextState === "playing") {
    const remainingWrongTargets = nextTargets.filter((target) => !target.isCorrect);
    if (remainingWrongTargets.length === 0) {
      const correctTarget = nextTargets.find((target) => target.isCorrect);
      selectedOptionId = roundCorrectOptionId ?? getNormalizedOptionId(correctTarget);
      nextState = "success";
      nextMessage = "Round cleared. You preserved the correct answer.";
      nextColor = "#166534";
      nextTargets = [];
      nextProjectiles.splice(0, nextProjectiles.length);
    }
  }

  return {
    projectiles: nextProjectiles,
    targets: nextTargets,
    lives: nextLives,
    hits: nextHits,
    misses: nextMisses,
    roundState: nextState,
    roundMessage: nextMessage,
    roundColor: nextColor,
    roundSelectedOptionId: selectedOptionId,
    roundCorrectOptionId,
    roundWasSuccess: nextState === "success",
  };
}

function intersects(projectile, target) {
  return (
    projectile.x < target.x + target.width &&
    projectile.x + projectile.width > target.x &&
    projectile.y < target.y + target.height &&
    projectile.y + projectile.height > target.y
  );
}

function isSupportedQuestion(question) {
  const qType = String(question?.questionType || "MCQ").toUpperCase();
  return qType === "MCQ" || qType === "TRUE_FALSE";
}

function buildEmptyGame(width) {
  return {
    fieldWidth: width,
    playerX: Math.max(18, width / 2 - PLAYER_WIDTH / 2),
    projectiles: [],
    targets: [],
    lives: 3,
    hits: 0,
    misses: 0,
    roundState: "idle",
    roundMessage: "",
    roundColor: "#1d4ed8",
    roundReadUntil: 0,
    roundReadDelayMs: 0,
    pausedState: null,
    pausedReadRemainingMs: 0,
    roundSelectedOptionId: null,
    roundCorrectOptionId: null,
    roundWasSuccess: false,
  };
}

export function resolveArcadeRoundSelection({
  roundState,
  roundWasSuccess,
  roundSelectedOptionId,
  roundCorrectOptionId,
  options,
}) {
  const wasSuccessfulRound = roundState === "success" || roundWasSuccess === true;
  let resolvedOptionId = roundSelectedOptionId ?? roundCorrectOptionId ?? null;

  if (wasSuccessfulRound && resolvedOptionId === null && Array.isArray(options)) {
    const correctOpt = options.find((option) => !!option?.isCorrect);
    resolvedOptionId = getNormalizedOptionId(correctOpt);
  }

  return {
    wasSuccessfulRound,
    resolvedOptionId,
  };
}

export function buildLiveArcadeOutcomes({
  questionOutcomes,
  currentQuestionId,
  roundState,
  roundWasSuccess,
}) {
  const next = { ...(questionOutcomes || {}) };
  const currentAlreadyRecorded =
    currentQuestionId != null &&
    Object.prototype.hasOwnProperty.call(next, currentQuestionId);
  const currentRoundResolved = roundState === "success" || roundState === "failed";

  if (!currentAlreadyRecorded && currentRoundResolved && currentQuestionId != null) {
    next[currentQuestionId] = roundState === "success" || roundWasSuccess === true;
  }

  return next;
}

export default function QuizArcade() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const { isManager, selectedStudentId, user } = useAuth();
  const { loadCategoryKeys, t, msg } = useUIText();
  const fieldRef = useRef(null);
  const answersRef = useRef({});

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [quiz, setQuiz] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(0);
  const [attemptLimit, setAttemptLimit] = useState(1);
  const [result, setResult] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [fieldWidth, setFieldWidth] = useState(860);
  const [answers, setAnswers] = useState({});
  const [questionOutcomes, setQuestionOutcomes] = useState({});
  const [game, setGame] = useState(() => buildEmptyGame(860));
  const [startDelaySeconds, setStartDelaySeconds] = useState(8);
  const [fallSpeed, setFallSpeed] = useState(1);

  const isAssignedStudent =
    getRoleCode(user) === "STUDENT" &&
    Number(user?.managerId || 0) > 0 &&
    !user?.isDirectStudent;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    loadCategoryKeys("UI_LABEL", [
      "quiz.loading",
      "quiz.noQuizFound",
      "quiz.submit.button",
      "quiz.submitting.button",
    ]).catch(() => {});
  }, [loadCategoryKeys]);

  useEffect(() => {
    function measure() {
      const width = Math.max(320, Math.floor(fieldRef.current?.clientWidth || 860));
      setFieldWidth(width);
      setGame((prev) => ({
        ...prev,
        fieldWidth: width,
        playerX: clamp(prev.playerX, 18, Math.max(18, width - PLAYER_WIDTH - 18)),
      }));
    }

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    let alive = true;

    async function start() {
      try {
        setLoading(true);
        setErr("");
        setResult(null);

        if (isManager && !selectedStudentId) {
          setErr(msg("quiz.selectStudent.error", "Select a student from sidebar before starting quiz."));
          return;
        }

        const query = new URLSearchParams();
        query.set("mode", "arcade");
        if (isManager && selectedStudentId) query.set("studentId", String(selectedStudentId));
        const data = await apiPost(`/api/quizzes/${quizId}/attempts/start?${query.toString()}`, {});
        if (!alive) return;

        const nextQuiz = data?.quiz || null;
        const ordered = orderQuizQuestions(nextQuiz?.questions || []);
        if (!ordered.length) {
          setErr(msg("quiz.noQuestions.error", "Quiz has no questions yet. Add questions before attempting."));
          return;
        }
        if (ordered.some((question) => !isSupportedQuestion(question))) {
          setErr("Arcade mode currently supports only multiple-choice and true/false quizzes.");
          return;
        }

        setQuiz(nextQuiz);
        setAttemptId(data?.attemptId || null);
        setAttemptsRemaining(Number(data?.attemptsRemaining || 0));
        setAttemptLimit(Number(data?.attemptLimit || 1));
        setCurrentQuestionIndex(0);
        setAnswers({});
        setQuestionOutcomes({});
        answersRef.current = {};
      } catch (e) {
        if (!alive) return;
        setErr(e.message || "Failed to start arcade mode.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    start();
    return () => {
      alive = false;
    };
  }, [quizId, isManager, selectedStudentId, msg]);

  const questions = useMemo(() => orderQuizQuestions(quiz?.questions || []), [quiz]);
  const currentQuestion = questions[currentQuestionIndex] || null;
  const isComplete = !!result;

  useEffect(() => {
    if (!currentQuestion || isComplete) return;
    const tuning = buildRoundTuning({
      startDelaySeconds,
      fallMultiplier: fallSpeed,
    });
    const targets = buildTargets(currentQuestion, fieldWidth, tuning);
    const correctOptionId = getNormalizedOptionId(
      Array.isArray(currentQuestion?.options)
        ? currentQuestion.options.find((option) => !!option?.isCorrect)
        : null
    );
    setGame((prev) => ({
      ...prev,
      fieldWidth,
      playerX: clamp(fieldWidth / 2 - PLAYER_WIDTH / 2, 18, Math.max(18, fieldWidth - PLAYER_WIDTH - 18)),
      projectiles: [],
      targets,
      roundState: "playing",
      roundMessage: `Read the question first. Answers drop in ${(tuning.readDelayMs / 1000).toFixed(0)}s.`,
      roundColor: "#1d4ed8",
      roundReadUntil: Date.now() + tuning.readDelayMs,
      roundReadDelayMs: tuning.readDelayMs,
      pausedReadRemainingMs: 0,
      roundSelectedOptionId: null,
      roundCorrectOptionId: correctOptionId,
      roundWasSuccess: false,
    }));
  }, [currentQuestion?.questionId, fieldWidth, isComplete, startDelaySeconds, fallSpeed]);

  useEffect(() => {
    if (!currentQuestion || isComplete || game.roundState !== "playing") return undefined;

    const timer = window.setInterval(() => {
      setGame((prev) => {
        if (prev.roundState !== "playing") return prev;
        const now = Date.now();
        if (prev.roundReadUntil && now < prev.roundReadUntil) {
          const secondsLeft = Math.max(0, prev.roundReadUntil - now) / 1000;
          return {
            ...prev,
            roundMessage: `Read the question first. Answers drop in ${Math.ceil(secondsLeft)}s.`,
            roundColor: "#1d4ed8",
          };
        }
        return {
          ...prev,
          ...resolveArcadeRoundFrame({
            fieldWidth: prev.fieldWidth,
            lives: prev.lives,
            hits: prev.hits,
            misses: prev.misses,
            roundState: prev.roundState,
            roundMessage: prev.roundMessage,
            roundColor: prev.roundColor,
            roundCorrectOptionId: prev.roundCorrectOptionId,
            projectiles: prev.projectiles,
            targets: prev.targets,
          }),
          roundReadUntil: 0,
          pausedReadRemainingMs: 0,
        };
      });
    }, STEP_MS);

    return () => window.clearInterval(timer);
  }, [currentQuestion?.questionId, game.roundState, isComplete]);

  useEffect(() => {
    if (!currentQuestion) return undefined;
    if (game.roundState !== "success" && game.roundState !== "failed") return undefined;

    const timer = window.setTimeout(() => {
      const { wasSuccessfulRound, resolvedOptionId } = resolveArcadeRoundSelection({
        roundState: game.roundState,
        roundWasSuccess: game.roundWasSuccess,
        roundSelectedOptionId: game.roundSelectedOptionId,
        roundCorrectOptionId: game.roundCorrectOptionId,
        options: currentQuestion?.options,
      });
      const wasAlreadyRecorded =
        currentQuestion?.questionId != null &&
        Object.prototype.hasOwnProperty.call(questionOutcomes, currentQuestion.questionId);

      const nextAnswers = wasSuccessfulRound
        ? {
            ...answersRef.current,
            [currentQuestion.questionId]: { selectedOptionId: resolvedOptionId },
          }
        : { ...answersRef.current };

      setAnswers(nextAnswers);
      setQuestionOutcomes((prev) =>
        wasAlreadyRecorded
          ? prev
          : { ...prev, [currentQuestion.questionId]: wasSuccessfulRound }
      );
      answersRef.current = nextAnswers;

      const lastQuestion = currentQuestionIndex >= questions.length - 1;
      const noLivesLeft = game.lives <= 0;

      if (lastQuestion || noLivesLeft) {
        handleSubmit(nextAnswers);
        return;
      }

      setCurrentQuestionIndex((prev) => prev + 1);
    }, 950);

    return () => window.clearTimeout(timer);
  }, [game.roundState, game.roundSelectedOptionId, game.roundCorrectOptionId, game.roundWasSuccess, game.lives, currentQuestionIndex, currentQuestion, questionOutcomes, questions.length]);

  useEffect(() => {
    if (!currentQuestion || isComplete) return undefined;

    function onKeyDown(event) {
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        setGame((prev) =>
          prev.roundState !== "playing"
            ? prev
            : {
                ...prev,
                playerX: clamp(prev.playerX - 28, 18, Math.max(18, prev.fieldWidth - PLAYER_WIDTH - 18)),
              }
        );
      }
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        setGame((prev) =>
          prev.roundState !== "playing"
            ? prev
            : {
                ...prev,
                playerX: clamp(prev.playerX + 28, 18, Math.max(18, prev.fieldWidth - PLAYER_WIDTH - 18)),
              }
        );
      }
      if (event.key === " " || event.key === "ArrowUp") {
        event.preventDefault();
        shoot();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentQuestion?.questionId, isComplete]);

  function shoot(playerXOverride = null) {
    setGame((prev) => {
      if (prev.roundState !== "playing") return prev;
      const originX = playerXOverride == null ? prev.playerX : clamp(playerXOverride, 18, Math.max(18, prev.fieldWidth - PLAYER_WIDTH - 18));
      return {
        ...prev,
        playerX: originX,
        projectiles: [
          ...prev.projectiles,
          {
            id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            x: originX + PLAYER_WIDTH / 2 - PROJECTILE_SIZE / 2,
            y: PLAYFIELD_HEIGHT - PLAYER_Y_OFFSET - 16,
            width: PROJECTILE_SIZE,
            height: 22,
          },
        ],
      };
    });
  }

  function togglePause() {
    setGame((prev) => {
      if (prev.roundState === "paused") {
        const now = Date.now();
        return {
          ...prev,
          roundState: prev.pausedState || "playing",
          pausedState: null,
          roundReadUntil: prev.pausedReadRemainingMs ? now + prev.pausedReadRemainingMs : 0,
          pausedReadRemainingMs: 0,
          roundMessage:
            (prev.pausedState || "playing") === "playing"
              ? prev.pausedReadRemainingMs > 0
                ? `Read the question first. Answers drop in ${Math.ceil(prev.pausedReadRemainingMs / 1000)}s.`
                : "Round resumed."
              : prev.roundMessage,
          roundColor: "#1d4ed8",
        };
      }
      if (prev.roundState !== "playing") return prev;
      return {
        ...prev,
        roundState: "paused",
        pausedState: "playing",
        pausedReadRemainingMs: prev.roundReadUntil ? Math.max(0, prev.roundReadUntil - Date.now()) : 0,
        roundMessage: "Game paused.",
        roundColor: "#475569",
      };
    });
  }

  async function handleSubmit(answerMap) {
    if (!attemptId || submitting || result) return;
    try {
      setSubmitting(true);
      const payload = {
        answers: questions.map((question) => ({
          questionId: question.questionId,
          selectedOptionId: answerMap[question.questionId]?.selectedOptionId ?? null,
          textAnswer: null,
          numberAnswer: null,
        })),
      };

      const submitRes = await apiPost(`/api/attempts/${attemptId}/submit`, payload);
      const resultRes = await apiGet(`/api/attempts/${attemptId}/result`);
      setAttemptsRemaining(Number(resultRes?.attemptsRemaining ?? submitRes?.attemptsRemaining ?? 0));
      setAttemptLimit(Number(resultRes?.attemptLimit ?? submitRes?.attemptLimit ?? attemptLimit));
      setResult(resultRes || submitRes || { scorePercent: 0, score: 0, total: 0 });
      setGame((prev) => ({
        ...prev,
        roundState: "done",
        roundMessage: "Run complete.",
        roundColor: "#0f172a",
      }));
    } catch (e) {
      setErr(e.message || "Failed to submit arcade quiz.");
    } finally {
      setSubmitting(false);
    }
  }

  const progressLabel = questions.length
    ? `Question ${Math.min(currentQuestionIndex + 1, questions.length)} / ${questions.length}`
    : "Question 0 / 0";

  const scorePercent = Number(result?.scorePercent ?? 0);
  const totalChoicesThisRound = Array.isArray(currentQuestion?.options) ? currentQuestion.options.length : 0;
  const clearedCount = game.hits;
  const currentQuestionId = currentQuestion?.questionId ?? null;
  const liveQuestionOutcomes = useMemo(
    () =>
      buildLiveArcadeOutcomes({
        questionOutcomes,
        currentQuestionId,
        roundState: game.roundState,
        roundWasSuccess: game.roundWasSuccess,
      }),
    [questionOutcomes, currentQuestionId, game.roundState, game.roundWasSuccess]
  );

  const displayResolvedQuestionsCount = Math.min(
    questions.length,
    Object.keys(liveQuestionOutcomes).length
  );

  const displayCorrectQuestionsCount = Math.min(
    questions.length,
    Object.values(liveQuestionOutcomes).filter((value) => value === true).length
  );

  const backendScore = Math.min(questions.length, Number(result?.score ?? 0));
  const finalCorrectQuestionsCount = Math.max(displayCorrectQuestionsCount, backendScore);
  const clearedPercent = questions.length > 0
    ? Math.round((finalCorrectQuestionsCount / questions.length) * 100)
    : 0;
  const roundSucceeded = game.roundState === "success";
  const accuracyPercent =
    displayResolvedQuestionsCount > 0
      ? Math.round((finalCorrectQuestionsCount / displayResolvedQuestionsCount) * 100)
      : 0;
  const progressQuestionNumber = Math.min(questions.length || 0, currentQuestionIndex + 1);
  const correctSoFarDenominator = questions.length || 0;

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ color: "#2563eb", fontWeight: 900, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            Quiz Arcade
          </div>
          <h1 style={{ margin: 0, color: "#142033", fontSize: 20, lineHeight: 1.15 }}>
            {quiz?.title || t("quiz.loading", "Loading quiz...")}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={togglePause}
            disabled={loading || submitting || isComplete || game.roundState === "done"}
          >
            {game.roundState === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>
            Restart Arcade
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => navigate(`/quiz/${quizId}`)}>
            Standard Quiz
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </div>

      {err ? <InlineAlert tone="danger" style={{ marginBottom: 14 }}>{err}</InlineAlert> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 220px", gap: 14, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <Card style={{ padding: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <div style={{ color: "#64748b", fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  {progressLabel}
                </div>
                <div style={{ color: "#142033", fontSize: 16, fontWeight: 900, lineHeight: 1.28, maxWidth: 620 }}>
                  {currentQuestion?.questionText || "Preparing round..."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ padding: "5px 9px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 800 }}>
                  Lives {game.lives}
                </span>
                <span style={{ padding: "5px 9px", borderRadius: 999, background: "#ecfdf5", color: "#047857", fontSize: 12, fontWeight: 800 }}>
                  Cleared {clearedCount}/{totalChoicesThisRound || 0}
                </span>
              </div>
            </div>

            <div
              ref={fieldRef}
              onClick={(event) => {
                const bounds = fieldRef.current?.getBoundingClientRect();
                if (!bounds || isComplete) return;
                const nextX = event.clientX - bounds.left - PLAYER_WIDTH / 2;
                shoot(nextX);
              }}
              style={{
                position: "relative",
                minHeight: PLAYFIELD_HEIGHT,
                borderRadius: 20,
                overflow: "hidden",
                border: "1px solid #bfdbfe",
                background:
                  "radial-gradient(circle at 20% 28%, rgba(147,197,253,0.28), transparent 18%), radial-gradient(circle at 82% 16%, rgba(191,219,254,0.2), transparent 15%), linear-gradient(180deg, #0f2454 0%, #123575 54%, #194ec2 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 22%, rgba(255,255,255,0.04) 23%, transparent 24%, rgba(255,255,255,0.04) 48%, transparent 49%, rgba(15,23,42,0.12) 100%)" }} />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage:
                    "linear-gradient(rgba(191,219,254,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(191,219,254,0.12) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                  opacity: 0.35,
                }}
              />

              {game.targets.map((target) => (
                <div
                  key={target.id}
                  style={{
                    position: "absolute",
                    left: target.x,
                    top: target.y,
                    width: target.width,
                    minHeight: target.height,
                    padding: "9px 11px",
                    borderRadius: 14,
                    border: "1px solid rgba(191,219,254,0.95)",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,246,255,0.96))",
                    color: "#142033",
                    boxShadow: "0 10px 24px rgba(15,23,42,0.22)",
                    boxSizing: "border-box",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.8, marginBottom: 4 }}>
                    {target.label}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      lineHeight: 1.2,
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      hyphens: "auto",
                    }}
                  >
                    {target.text}
                  </div>
                </div>
              ))}

              {game.projectiles.map((projectile) => (
                <div
                  key={projectile.id}
                  style={{
                    position: "absolute",
                    left: projectile.x,
                    top: projectile.y,
                    width: projectile.width,
                    height: projectile.height,
                    borderRadius: 999,
                    background: "linear-gradient(180deg,#fef08a,#f97316)",
                    boxShadow: "0 0 20px rgba(251,146,60,0.6)",
                  }}
                />
              ))}

              <div
                style={{
                  position: "absolute",
                  left: game.playerX,
                  bottom: 58,
                  width: PLAYER_WIDTH,
                  height: 74,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <svg
                  viewBox="0 0 64 96"
                  aria-hidden="true"
                  style={{
                    width: 58,
                    height: 74,
                    filter: "drop-shadow(0 10px 20px rgba(15,23,42,0.32))",
                  }}
                >
                  <defs>
                    <linearGradient id="jetBody" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fecaca" />
                      <stop offset="45%" stopColor="#f87171" />
                      <stop offset="100%" stopColor="#b91c1c" />
                    </linearGradient>
                    <linearGradient id="jetWing" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#fca5a5" />
                      <stop offset="100%" stopColor="#991b1b" />
                    </linearGradient>
                    <linearGradient id="jetFlame" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fde68a" />
                      <stop offset="55%" stopColor="#fb923c" />
                      <stop offset="100%" stopColor="#ef4444" />
                    </linearGradient>
                  </defs>
                  <path d="M32 6 L37 18 L44 24 L50 42 L60 56 L44 54 L40 68 L34 62 L30 62 L24 68 L20 54 L4 56 L14 42 L20 24 L27 18 Z" fill="url(#jetWing)" />
                  <path d="M32 8 L38 22 L39 56 L32 72 L25 56 L26 22 Z" fill="url(#jetBody)" stroke="#fee2e2" strokeWidth="2" />
                  <path d="M26 28 L18 42 L10 46 L24 48 Z" fill="url(#jetWing)" opacity="0.95" />
                  <path d="M38 28 L46 42 L54 46 L40 48 Z" fill="url(#jetWing)" opacity="0.95" />
                  <path d="M28 18 L32 12 L36 18 Z" fill="#fff1f2" opacity="0.95" />
                  <ellipse cx="32" cy="26" rx="5.5" ry="8" fill="#fee2e2" stroke="#fff1f2" strokeWidth="1.5" />
                  <path d="M28 72 L32 88 L36 72 Z" fill="url(#jetFlame)" />
                </svg>
              </div>

              <div
                style={{
                  position: "absolute",
                  left: Math.max(18, game.playerX - 48),
                  bottom: 14,
                  display: "grid",
                  justifyItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setGame((prev) => ({ ...prev, playerX: clamp(prev.playerX - 36, 18, Math.max(18, prev.fieldWidth - PLAYER_WIDTH - 18)) }))}>
                    Left
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={shoot}>
                    Shoot
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setGame((prev) => ({ ...prev, playerX: clamp(prev.playerX + 36, 18, Math.max(18, prev.fieldWidth - PLAYER_WIDTH - 18)) }))}>
                    Right
                  </Button>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8, color: "#cbd5e1", fontSize: 11, fontWeight: 700, textAlign: "center" }}>
              Move with <b>A / D</b> or <b>arrow keys</b>, fire with <b>space</b>, or tap the arena.
            </div>
          </Card>
        </div>

        <div style={{ minWidth: 0 }}>
          <Card style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
              Arcade Controls
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, marginBottom: 6 }}>Start interval</div>
                <select
                  value={startDelaySeconds}
                  onChange={(event) => setStartDelaySeconds(Number(event.target.value || 8))}
                  disabled={game.roundState === "playing" || game.roundState === "paused"}
                  style={{
                    width: "100%",
                    minHeight: 40,
                    borderRadius: 12,
                    border: "1px solid #cbd5e1",
                    padding: "0 12px",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#142033",
                    background: "#fff",
                  }}
                >
                  {START_DELAY_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds}s
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800 }}>Fall speed</div>
                  <div style={{ color: "#142033", fontSize: 12, fontWeight: 800 }}>{fallSpeed.toFixed(1)}x</div>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.8"
                  step="0.1"
                  value={fallSpeed}
                  onChange={(event) => setFallSpeed(Number(event.target.value || 1))}
                  disabled={game.roundState === "playing" || game.roundState === "paused"}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          </Card>

          <Card style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Round Results
            </div>
            <div
              style={{
                color: roundSucceeded ? "#16a34a" : game.roundColor,
                fontSize: 22,
                fontWeight: 900,
                lineHeight: 1.15,
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              {roundSucceeded ? "Correct! ✓" : game.roundMessage || "Loading round..."}
            </div>
            <div style={{ borderTop: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
                <div style={{ color: "#f97316", fontSize: 24, lineHeight: 1 }}>◎</div>
                <div style={{ color: "#334155", fontSize: 12 }}>
                  Correct so far:{" "}
                  <b style={{ color: "#142033", fontSize: 16 }}>
                    {`${finalCorrectQuestionsCount} / ${correctSoFarDenominator}`}
                  </b>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: "1px solid #e2e8f0" }}>
                <div style={{ color: "#0ea5e9", fontSize: 24, lineHeight: 1 }}>◉</div>
                <div style={{ color: "#334155", fontSize: 12 }}>
                  Accuracy:{" "}
                  <b style={{ color: "#142033", fontSize: 16 }}>
                    {displayResolvedQuestionsCount > 0 ? `${accuracyPercent}%` : "--"}
                  </b>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0 8px" }}>
                <div style={{ color: "#f59e0b", fontSize: 24, lineHeight: 1 }}>▣</div>
                <div style={{ color: "#334155", fontSize: 12, whiteSpace: "nowrap" }}>
                  Progress: <b style={{ color: "#142033", fontSize: 16, whiteSpace: "nowrap" }}>Question {progressQuestionNumber} / {questions.length || 0}</b>
                </div>
              </div>
            </div>
            <div style={{ display: "none", marginTop: 12, gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, marginBottom: 4 }}>Attempt</div>
                <div style={{ color: "#142033", fontSize: 18, fontWeight: 900 }}>
                  {Math.max(0, Number(attemptLimit || 1) - Number(attemptsRemaining || 0))} <span style={{ color: "#0f766e", fontSize: 13 }}>❤</span>
                </div>
              </div>
              <div>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, marginBottom: 4 }}>Cleared</div>
                <div style={{ color: "#142033", fontSize: 18, fontWeight: 900 }}>
                  {game.hits} <span style={{ color: "#10b981", fontSize: 13 }}>✔</span>
                </div>
              </div>
              <div>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, marginBottom: 4 }}>Misses</div>
                <div style={{ color: "#142033", fontSize: 18, fontWeight: 900 }}>{game.misses}</div>
              </div>
              <div>
                <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, marginBottom: 4 }}>Lives</div>
                <div style={{ color: "#142033", fontSize: 18, fontWeight: 900 }}>{game.lives}</div>
              </div>
            </div>
            <div style={{ marginTop: 8, color: "#64748b", fontSize: 12, fontWeight: 800 }}>
              Final result: {finalCorrectQuestionsCount}/{questions.length || 0} marks = {clearedPercent}%
            </div>
          </Card>

          {loading ? (
            <Card style={{ padding: 14 }}>{t("quiz.loading", "Loading quiz...")}</Card>
          ) : null}

          {submitting ? (
            <Card style={{ padding: 14 }}>{t("quiz.submitting.button", "Submitting...")}</Card>
          ) : null}

          {result ? (
            <Card style={{ padding: 14 }}>
              <div style={{ color: "#64748b", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                Final Result
              </div>
              <div style={{ color: "#142033", fontSize: 28, fontWeight: 900, lineHeight: 1 }}>
                {scorePercent}%
              </div>
              <div style={{ marginTop: 8, color: "#475569", fontSize: 14 }}>
                Score <b>{finalCorrectQuestionsCount}</b> / <b>{result.total}</b>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>
                  Restart Arcade
                </Button>
                <Button type="button" size="sm" variant="primary" onClick={() => navigate(`/quiz/${quizId}`)}>
                  Review Standard Result
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => navigate("/results")}>
                  My Results
                </Button>
              </div>
            </Card>
          ) : null}

          {!result ? (
            <Card style={{ padding: 14 }}>
              <div style={{ color: "#64748b", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                Rules
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, color: "#334155", lineHeight: 1.55, fontSize: 12 }}>
                <li>Shoot every wrong answer card before one slips through.</li>
                <li>Do not hit the correct answer card.</li>
                <li>Each mistake costs one life.</li>
                <li>When all wrong cards are cleared, the correct option is recorded automatically.</li>
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
