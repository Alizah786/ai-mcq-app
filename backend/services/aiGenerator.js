const { execQuery } = require("../db");
const { TYPES } = require("tedious");

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeProviderName(name) {
  return String(name || "").trim().toLowerCase();
}

function detectProvider() {
  const forced = normalizeProviderName(process.env.AI_PROVIDER);
  const hasOpenAI = !!String(process.env.OPENAI_API_KEY || "").trim();
  const hasGemini = !!String(process.env.GEMINI_API_KEY || "").trim();

  if (forced === "openai") return { provider: "openai", enabled: hasOpenAI, reason: hasOpenAI ? null : "OPENAI_API_KEY missing" };
  if (forced === "gemini") return { provider: "gemini", enabled: hasGemini, reason: hasGemini ? null : "GEMINI_API_KEY missing" };
  if (forced === "local") return { provider: "local", enabled: true, reason: null };

  if (hasOpenAI) return { provider: "openai", enabled: true, reason: null };
  if (hasGemini) return { provider: "gemini", enabled: true, reason: null };
  return { provider: "local", enabled: true, reason: null };
}

function getAIProviderInfo() {
  return detectProvider();
}

async function validateOpenAIKey() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { valid: false, reason: "OPENAI_API_KEY missing" };
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { valid: false, reason: `OpenAI validation failed (${r.status}) ${t}`.slice(0, 300) };
    }
    return { valid: true, reason: null };
  } catch (err) {
    return { valid: false, reason: `OpenAI validation error: ${err.message}` };
  }
}

async function validateGeminiKey() {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { valid: false, reason: "GEMINI_API_KEY missing" };
  const configuredModel = String(process.env.GEMINI_MODEL || "gemini-flash-latest").trim().replace(/^models\//i, "");
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: "GET" }
    );
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { valid: false, reason: `Gemini validation failed (${r.status}) ${t}`.slice(0, 300) };
    }
    const data = await r.json().catch(() => ({}));
    const models = Array.isArray(data?.models) ? data.models : [];

    // Accept either full name "models/xyz" or short "xyz".
    const modelEntry = models.find((m) => {
      const full = String(m?.name || "");
      const short = full.replace(/^models\//i, "");
      return short === configuredModel || full === configuredModel;
    });

    if (!modelEntry) {
      return {
        valid: false,
        reason: `Configured Gemini model '${configuredModel}' not found. Set GEMINI_MODEL to a listed model (e.g. gemini-flash-latest).`,
      };
    }

    const methods = Array.isArray(modelEntry.supportedGenerationMethods)
      ? modelEntry.supportedGenerationMethods
      : [];
    const supportsGenerate = methods.includes("generateContent");
    if (!supportsGenerate) {
      return {
        valid: false,
        reason: `Configured Gemini model '${configuredModel}' does not support generateContent.`,
      };
    }

    return { valid: true, reason: null };
  } catch (err) {
    return { valid: false, reason: `Gemini validation error: ${err.message}` };
  }
}

async function getAICapability() {
  const info = detectProvider();
  if (!info.enabled) {
    return { provider: info.provider, canGenerate: false, reason: info.reason || "Provider not configured" };
  }
  if (info.provider === "local") {
    return { provider: "local", canGenerate: true, reason: null };
  }
  if (info.provider === "openai") {
    const v = await validateOpenAIKey();
    return { provider: "openai", canGenerate: v.valid, reason: v.reason };
  }
  if (info.provider === "gemini") {
    const v = await validateGeminiKey();
    return { provider: "gemini", canGenerate: v.valid, reason: v.reason };
  }
  return { provider: info.provider, canGenerate: false, reason: "Unknown provider" };
}

function buildPrompt({ topic, difficulty, numQuestions }) {
  return [
    "Generate MCQ quiz content as strict JSON only.",
    `Topic: ${topic || "General knowledge"}`,
    `Difficulty: ${difficulty || "Medium"}`,
    `Number of questions: ${numQuestions}`,
    "Output JSON shape:",
    '{ "questions": [ { "questionText": "...", "explanation": "...", "diagramType": "none|svg|mermaid", "diagramData": "<svg ...>...</svg> or mermaid text or null", "options": [ {"text":"..."}, {"text":"..."}, {"text":"..."}, {"text":"..."} ], "correctIndex": 0 } ] }',
    "Rules:",
    "- Exactly 4 options per question",
    "- correctIndex must be 0..3",
    "- diagramType is optional; use 'svg' for geometry/trigonometry when useful",
    "- If diagramType is 'none', diagramData must be null or empty",
    "- Clear, non-ambiguous questions",
    "- Explanation must be clear for first-year college students",
    "- Write explanation as a math tutor in numbered steps",
    "- Step 1 must identify what is given",
    "- Include the formula/law used (e.g., Tangent, Sine Law, Cosine Law)",
    "- Show substitution of numbers into formula",
    "- Show each calculation step separately; do not skip steps",
    "- Explain each step in simple language",
    "- Round final answer properly and state units when applicable",
    "- Avoid long compact equations; break into readable lines",
    "- End explanation with a short line: Final Answer: <value with units>",
  ].join("\n");
}

function parseGeneratedJson(rawText) {
  if (!rawText) throw new Error("AI returned empty response");
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? rawText.slice(firstBrace, lastBrace + 1) : rawText;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI response was not valid JSON");
  }
  if (!Array.isArray(parsed.questions) || !parsed.questions.length) {
    throw new Error("AI JSON missing questions array");
  }
  return parsed;
}

function normalizeQuestions(parsed, requestedCount) {
  const out = [];
  for (const q of parsed.questions) {
    if (!q || typeof q.questionText !== "string" || !q.questionText.trim()) continue;
    if (!Array.isArray(q.options) || q.options.length < 4) continue;
    const options = q.options
      .slice(0, 4)
      .map((o) => (typeof o?.text === "string" ? o.text.trim() : ""))
      .filter(Boolean);
    if (options.length !== 4) continue;
    let correctIndex = toInt(q.correctIndex, -1);
    if (correctIndex < 0 || correctIndex > 3) correctIndex = 0;
    const diagramTypeRaw = String(q.diagramType || "none").trim().toLowerCase();
    const diagramType = ["none", "svg", "mermaid"].includes(diagramTypeRaw) ? diagramTypeRaw : "none";
    const diagramData =
      diagramType !== "none" && typeof q.diagramData === "string" && q.diagramData.trim()
        ? q.diagramData.trim()
        : null;
    out.push({
      questionText: q.questionText.trim(),
      explanation: typeof q.explanation === "string" ? q.explanation.trim() : null,
      diagramType,
      diagramData,
      options,
      correctIndex,
    });
    if (out.length >= requestedCount) break;
  }
  if (!out.length) throw new Error("AI produced no usable questions");
  return out;
}

function normalizeCompareText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function validateGeneratedQuestions(questions) {
  const errors = [];

  if (!Array.isArray(questions) || !questions.length) {
    return { ok: false, errors: ["No questions generated."] };
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const idx = i + 1;
    const qText = String(q?.questionText || "").trim();
    const options = Array.isArray(q?.options) ? q.options : [];
    const correctIndex = Number(q?.correctIndex);

    if (qText.length < 8) {
      errors.push(`Q${idx}: Question text is too short.`);
      continue;
    }
    if (options.length !== 4) {
      errors.push(`Q${idx}: Must have exactly 4 options.`);
      continue;
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      errors.push(`Q${idx}: Correct answer index is invalid.`);
    }

    const normalizedOptions = options.map((o) => normalizeCompareText(o));
    if (normalizedOptions.some((o) => !o)) {
      errors.push(`Q${idx}: One or more options are empty.`);
    }

    const uniqueCount = new Set(normalizedOptions).size;
    if (uniqueCount !== normalizedOptions.length) {
      errors.push(`Q${idx}: Duplicate options found.`);
    }

    if (Number.isInteger(correctIndex)) {
      const correctText = String(options[correctIndex] || "").trim();
      if (!correctText) {
        errors.push(`Q${idx}: Correct option text is empty.`);
      }
    }

    const qTextNorm = normalizeCompareText(qText);
    if (normalizedOptions.some((o) => o && o === qTextNorm)) {
      errors.push(`Q${idx}: Option text should not be identical to question text.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function makeAngleSvg(angleLabel, degrees) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="180" viewBox="0 0 280 180">
  <rect x="0" y="0" width="280" height="180" fill="white"/>
  <line x1="60" y1="140" x2="220" y2="140" stroke="#111827" stroke-width="2"/>
  <line x1="60" y1="140" x2="170" y2="60" stroke="#2563eb" stroke-width="2"/>
  <path d="M95,140 A35,35 0 0,1 90,120" fill="none" stroke="#ef4444" stroke-width="2"/>
  <circle cx="60" cy="140" r="3" fill="#111827"/>
  <text x="75" y="124" font-size="13" fill="#ef4444">${angleLabel}</text>
  <text x="60" y="160" font-size="12" fill="#374151">${degrees} deg</text>
</svg>`.trim();
}

async function callOpenAIForQuiz({ topic, difficulty, numQuestions }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const prompt = buildPrompt({ topic, difficulty, numQuestions });
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You generate high quality MCQ quizzes for students." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed (${response.status}) ${err}`.slice(0, 500));
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const parsed = parseGeneratedJson(text);
  return normalizeQuestions(parsed, numQuestions);
}

async function callGeminiForQuiz({ topic, difficulty, numQuestions }) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const configuredModel = String(process.env.GEMINI_MODEL || "gemini-flash-latest").trim();
  const model = configuredModel.replace(/^models\//i, "");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const prompt = buildPrompt({ topic, difficulty, numQuestions });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(
      `Gemini request failed (${response.status}) ${err}. Try GEMINI_MODEL=gemini-flash-latest or GEMINI_MODEL=gemini-2.5-flash`
        .slice(0, 700)
    );
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseGeneratedJson(text);
  return normalizeQuestions(parsed, numQuestions);
}

function callLocalFallbackQuiz({ topic, difficulty, numQuestions }) {
  const t = topic || "General";
  const d = difficulty || "Medium";
  const hasAngleTopic = /trig|trigonometry|angle|geometry/i.test(t);
  const questions = [];

  for (let i = 0; i < numQuestions; i++) {
    const n = i + 1;
    questions.push({
      questionText: `${t}: Question ${n} (${d})`,
      explanation: `Auto-generated local fallback question ${n} for topic ${t}.`,
      diagramType: hasAngleTopic && i < 2 ? "svg" : "none",
      diagramData: hasAngleTopic && i < 2 ? makeAngleSvg(`theta${n}`, 30 + i * 15) : null,
      options: [
        `${t} concept A${n}`,
        `${t} concept B${n}`,
        `${t} concept C${n}`,
        `${t} concept D${n}`,
      ],
      correctIndex: i % 4,
    });
  }

  return questions;
}

async function generateQuestionsWithConfiguredProvider({ topic, difficulty, numQuestions }) {
  const config = detectProvider();
  const forced = normalizeProviderName(process.env.AI_PROVIDER);
  const isAuto = !forced || forced === "auto";

  if (config.provider === "openai") {
    try {
      return {
        provider: "openai",
        questions: await callOpenAIForQuiz({ topic, difficulty, numQuestions }),
      };
    } catch (err) {
      if (!isAuto) throw err;
      const hasGemini = !!String(process.env.GEMINI_API_KEY || "").trim();
      if (hasGemini) {
        try {
          return {
            provider: "gemini",
            questions: await callGeminiForQuiz({ topic, difficulty, numQuestions }),
          };
        } catch {
          return {
            provider: "local",
            questions: callLocalFallbackQuiz({ topic, difficulty, numQuestions }),
          };
        }
      }
      return {
        provider: "local",
        questions: callLocalFallbackQuiz({ topic, difficulty, numQuestions }),
      };
    }
  }

  if (config.provider === "gemini") {
    try {
      return {
        provider: "gemini",
        questions: await callGeminiForQuiz({ topic, difficulty, numQuestions }),
      };
    } catch (err) {
      if (!isAuto) throw err;
      return {
        provider: "local",
        questions: callLocalFallbackQuiz({ topic, difficulty, numQuestions }),
      };
    }
  }

  return {
    provider: "local",
    questions: callLocalFallbackQuiz({ topic, difficulty, numQuestions }),
  };
}

async function processAIGenerationJob(jobId) {
  const jobRes = await execQuery(
    `SELECT JobId, StudentId, ClassId, Topic, NumQuestions, Difficulty, TeacherId
     FROM dbo.AIGenerationJob
     WHERE JobId = @jobId`,
    [{ name: "jobId", type: TYPES.Int, value: jobId }]
  );
  const job = jobRes.rows[0];
  if (!job) return;

  await execQuery(
    "UPDATE dbo.AIGenerationJob SET Status = 'Processing' WHERE JobId = @jobId",
    [{ name: "jobId", type: TYPES.Int, value: jobId }]
  );

  try {
    const numQuestions = clamp(toInt(job.NumQuestions, 5), 1, 20);
    const difficulty = job.Difficulty || "Medium";
    const topic = job.Topic || "General";

    const generated = await generateQuestionsWithConfiguredProvider({ topic, difficulty, numQuestions });
    const questions = generated.questions;
    const verification = validateGeneratedQuestions(questions);
    if (!verification.ok) {
      throw new Error(
        `Generated quiz failed validation: ${verification.errors.slice(0, 6).join(" | ")}`
      );
    }

    const createdQuiz = await execQuery(
      `INSERT INTO dbo.Quiz (TeacherId, ClassId, Title, Topic, Difficulty, SourceType, Status)
       OUTPUT INSERTED.QuizId
       VALUES (@managerId, @classId, @title, @topic, @difficulty, @sourceType, 'Ready')`,
      [
        { name: "managerId", type: TYPES.Int, value: job.TeacherId ?? null },
        { name: "classId", type: TYPES.Int, value: job.ClassId },
        { name: "title", type: TYPES.NVarChar, value: `${topic} - AI Quiz` },
        { name: "topic", type: TYPES.NVarChar, value: topic },
        { name: "difficulty", type: TYPES.NVarChar, value: difficulty },
        { name: "sourceType", type: TYPES.NVarChar, value: generated.provider === "local" ? "Manual" : "AI_Topic" },
      ]
    );

    const quizId = createdQuiz.rows[0]?.QuizId;
    if (!quizId) throw new Error("Failed to create AI quiz");

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qInsert = await execQuery(
        `INSERT INTO dbo.QuizQuestion (TeacherId, QuizId, QuestionText, Explanation, DiagramType, DiagramData, DisplayOrder)
         OUTPUT INSERTED.QuestionId
         VALUES (@managerId, @quizId, @text, @explanation, @diagramType, @diagramData, @orderNo)`,
        [
          { name: "managerId", type: TYPES.Int, value: job.TeacherId ?? null },
          { name: "quizId", type: TYPES.Int, value: quizId },
          { name: "text", type: TYPES.NVarChar, value: q.questionText },
          { name: "explanation", type: TYPES.NVarChar, value: q.explanation || null },
          { name: "diagramType", type: TYPES.NVarChar, value: q.diagramType || "none" },
          { name: "diagramData", type: TYPES.NVarChar, value: q.diagramData || null },
          { name: "orderNo", type: TYPES.Int, value: i + 1 },
        ]
      );
      const questionId = qInsert.rows[0]?.QuestionId;
      if (!questionId) throw new Error("Failed to create AI question");

      for (let j = 0; j < 4; j++) {
        await execQuery(
          `INSERT INTO dbo.QuizChoice (TeacherId, QuestionId, ChoiceText, IsCorrect, DisplayOrder)
           VALUES (@managerId, @questionId, @choiceText, @isCorrect, @orderNo)`,
          [
            { name: "managerId", type: TYPES.Int, value: job.TeacherId ?? null },
            { name: "questionId", type: TYPES.Int, value: questionId },
            { name: "choiceText", type: TYPES.NVarChar, value: q.options[j] },
            { name: "isCorrect", type: TYPES.Bit, value: j === q.correctIndex ? 1 : 0 },
            { name: "orderNo", type: TYPES.Int, value: j + 1 },
          ]
        );
      }
    }

    await execQuery(
      `UPDATE dbo.AIGenerationJob
       SET Status = 'Completed', ResultQuizId = @quizId, CompletedAtUtc = SYSUTCDATETIME(), ErrorMessage = NULL
       WHERE JobId = @jobId`,
      [
        { name: "quizId", type: TYPES.Int, value: quizId },
        { name: "jobId", type: TYPES.Int, value: jobId },
      ]
    );
  } catch (err) {
    await execQuery(
      `UPDATE dbo.AIGenerationJob
       SET Status = 'Failed', ErrorMessage = @errorMessage, CompletedAtUtc = SYSUTCDATETIME()
       WHERE JobId = @jobId`,
      [
        { name: "errorMessage", type: TYPES.NVarChar, value: String(err.message || err).slice(0, 1900) },
        { name: "jobId", type: TYPES.Int, value: jobId },
      ]
    );
  }
}

module.exports = {
  getAIProviderInfo,
  getAICapability,
  processAIGenerationJob,
};

