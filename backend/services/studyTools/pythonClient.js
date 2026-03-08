const { StudyToolError } = require("./common");
const { getAIProviderInfo } = require("../aiGenerator");

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function topicWords(topic) {
  return Array.from(
    new Set(
      String(topic || "")
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g) || []
    )
  );
}

function containsAny(text, list) {
  const low = String(text || "").toLowerCase();
  return list.some((item) => low.includes(String(item).toLowerCase()));
}

function detectEducationRelated(text) {
  const low = String(text || "").toLowerCase();
  const signals = [
    "assignment",
    "deadline",
    "due date",
    "submission",
    "rubric",
    "marks",
    "question",
    "solve",
    "calculate",
    "determine",
    "prove",
    "definition",
    "concept",
    "example",
    "because",
    "therefore",
    "diagram",
    "formula",
    "equation",
    "explains",
    "steps",
    "database",
    "essay",
    "analysis",
    "chapter",
    "lesson",
    "unit",
  ];
  let hits = 0;
  for (const signal of signals) {
    if (low.includes(signal)) hits += 1;
  }
  return hits >= 2;
}

function detectMixedSubject(text, subject, topic) {
  const low = String(text || "").toLowerCase();
  const clusters = {
    english: ["essay", "grammar", "thesis", "writing", "literature"],
    math: ["algebra", "geometry", "equation", "trigonometry", "calculus"],
    science: ["biology", "chemistry", "physics", "cell", "molecule"],
    computing: ["database", "sql", "requirement", "uml", "software", "algorithm"],
  };
  const scores = Object.entries(clusters)
    .map(([name, terms]) => ({ name, score: terms.reduce((sum, term) => sum + (low.includes(term) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scores.length < 2) return false;
  const query = `${subject} ${topic}`.toLowerCase();
  return scores[1].score >= Math.max(2, scores[0].score - 1) && !query.includes(scores[0].name);
}

async function validateStudyInput({ subject, topic, text }) {
  const normalized = normalizeText(text);
  const words = topicWords(`${subject} ${topic}`);
  const low = normalized.toLowerCase();
  const hits = words.filter((word) => low.includes(word)).length;
  const topicMatchesDoc = words.length === 0 ? true : hits >= Math.max(1, Math.min(2, words.length));
  const isMixedSubject = detectMixedSubject(normalized, subject, topic);
  const isEducationRelated = detectEducationRelated(normalized);

  return {
    isEducationRelated,
    topicMatchesDoc,
    isCourseOutline: false,
    isMixedSubject,
    reason: isMixedSubject
      ? "Document appears to contain multiple unrelated subjects."
      : !isEducationRelated
        ? "Text does not appear to be education-focused."
        : !topicMatchesDoc
          ? "Topic does not strongly match document text."
          : "Validation completed.",
  };
}

async function validateImageStudyInput() {
  return {
    isEducationRelated: true,
    topicMatchesDoc: true,
    isCourseOutline: false,
    isMixedSubject: false,
    reason: "Image source will be processed during generation.",
  };
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
}

function localKeywords(text, limit = 12) {
  const stop = new Set(["this", "that", "with", "from", "have", "will", "into", "their", "about", "there", "which", "using", "these", "those", "were", "been", "being", "your", "each", "because", "where", "when", "what"]);
  const counts = new Map();
  for (const word of String(text || "").toLowerCase().match(/[a-z][a-z0-9\-]{2,}/g) || []) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word.slice(0, 40));
}

function localStudyOutput({ subject, topic, text, outputs, options, sourceClass }) {
  const sentences = splitSentences(text);
  const keywords = localKeywords(text, 12);
  const summary = sentences.slice(0, 5).join(" ").slice(0, 1200);
  const keyConcepts = (sentences.length ? sentences : [normalizeText(text).slice(0, 220)])
    .slice(0, 8)
    .map((line) => `- ${line.slice(0, 220)}`)
    .join("\n");
  const definitionLines = (keywords.length ? keywords.slice(0, 4) : [topic])
    .map((item) => `- ${item}`)
    .join("\n");
  const exampleLines = sentences.slice(2, 6).map((line) => `- ${line.slice(0, 220)}`).join("\n") || "- Add an example from your class notes.";

  const result = { title: `${subject} - ${topic}`.slice(0, 200) };
  if (outputs.includes("summary")) result.summary = summary;
  if (outputs.includes("keywords")) result.keywords = keywords.slice(0, 30);
  if (outputs.includes("notes")) {
    const parts = [
      `# ${result.title}`,
      "## Overview",
      summary || normalizeText(text).slice(0, 500),
      "## Key Concepts",
      keyConcepts || "- Review the strongest recurring ideas from the document.",
    ];
    if (options?.includeDefinitions) parts.push("## Definitions", definitionLines);
    if (options?.includeExamples) parts.push("## Examples", exampleLines);
    parts.push("## Quick Review", `- Focus on ${topic} and the main supporting concepts listed above.`);
    result.notesMarkdown = parts.join("\n\n");
  }
  if (outputs.includes("flashcards")) {
    const count = Math.max(5, Math.min(50, Number(options?.flashcardCount || 15)));
    const cards = [];
    for (let i = 0; i < count; i += 1) {
      const source = sentences[i] || sentences[i % Math.max(1, sentences.length)] || `Review the concept ${i + 1}.`;
      cards.push({
        front: (sourceClass === "assignment" ? `How would you solve: ${source}` : `${topic}: key point ${i + 1}`).slice(0, 180),
        back: (sourceClass === "assignment" ? `Worked solution idea: ${sentences[i + 1] || source}` : source).slice(0, 400),
        tags: keywords.slice(0, 3),
        difficulty: options?.difficulty === "Easy" || options?.difficulty === "Hard" ? options.difficulty : "Medium",
      });
    }
    result.flashcards = cards;
  }
  if (outputs.includes("assignments")) {
    const count = Math.max(3, Math.min(20, Number(options?.assignmentCount || 8)));
    result.assignments = Array.from({ length: count }).map((_, index) => {
      const source = sentences[index] || sentences[index % Math.max(1, sentences.length)] || `Review ${topic}.`;
      return {
        question: `Question ${index + 1}: ${source.slice(0, 220)}`,
        example: options?.includeExamples ? `Worked example: ${sentences[index + 1] || source}`.slice(0, 2000) : "",
        explanation: `Explanation: ${sentences[index + 2] || source}`.slice(0, 3000),
        difficulty: options?.difficulty === "Easy" || options?.difficulty === "Hard" ? options.difficulty : "Medium",
      };
    });
  }
  return result;
}

function extractJsonText(rawText) {
  const text = String(rawText || "");
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  return firstBrace >= 0 && lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : text;
}

function parseStudyJson(rawText) {
  const jsonText = extractJsonText(rawText);
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new StudyToolError("AI response was not valid JSON.", 500, "PROCESSING_FAILED");
  }
}

function getStudyPromptTextLimit(outputs = []) {
  const requested = Array.isArray(outputs) ? outputs : [];
  let fallback = 40000;
  if (requested.includes("assignments")) fallback = 18000;
  else if (requested.includes("notes") && requested.includes("flashcards")) fallback = 22000;
  else if (requested.includes("flashcards")) fallback = 16000;
  else if (requested.includes("notes")) fallback = 28000;
  const configured = Number(process.env.STUDY_PROMPT_TEXT_LIMIT || 0);
  return Math.max(8000, Number.isFinite(configured) && configured > 0 ? configured : fallback);
}

function studyPrompt({ subject, topic, text, outputs, options, sourceClass }) {
  const requested = outputs.join(", ");
  const textLimit = getStudyPromptTextLimit(outputs);
  const lines = [
    "Return strict JSON only.",
    `Subject: ${subject}`,
    `Topic: ${topic}`,
    `Requested outputs: ${requested}`,
    "JSON shape:",
    '{"title":"...","summary":"...","keywords":["..."],"notesMarkdown":"# Title\\n\\n## Overview\\n...\\n\\n## Key Concepts\\n- ...\\n\\n## Quick Review\\n- ...","flashcards":[{"front":"...","back":"...","tags":["..."],"difficulty":"Easy|Medium|Hard"}],"assignments":[{"question":"...","example":"...","explanation":"...","difficulty":"Easy|Medium|Hard"}]}',
    "Rules:",
    "- notesMarkdown must include # Title, ## Overview, ## Key Concepts, and ## Quick Review",
    "- Use bullet points under Key Concepts",
    "- If includeDefinitions is true, add ## Definitions",
    "- If includeExamples is true, add ## Examples",
    "- summary <= 1200 chars",
    "- keywords max 30 items",
    "- flashcards between 5 and 50",
    `- assignments target count: ${Math.max(3, Math.min(20, Number(options?.assignmentCount || 8)))}`,
    `- flashcard target count: ${Math.max(5, Math.min(50, Number(options?.flashcardCount || 15)))}`,
    `- difficulty: ${options?.difficulty || "Mixed"}`,
    `- notes length preference: ${options?.notesLength || "Medium"}`,
  ];
  if (String(sourceClass || "") === "assignment") {
    lines.push(
      "Assignment mode:",
      "- The source is an assessment such as an assignment, quiz, exam, or test.",
      "- Solve the questions internally before writing the output.",
      "- If flashcards are requested, turn the solved answers, methods, formulas, and common mistakes into revision flashcards.",
      "- Do not just restate unanswered questions without solutions."
    );
  }
  lines.push("Source text:", String(text || "").slice(0, textLimit));
  return lines.join("\n");
}

function getProviderModel(provider) {
  if (provider === "openai") return String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  if (provider === "gemini") return String(process.env.GEMINI_MODEL || "gemini-flash-latest").trim().replace(/^models\//i, "");
  if (provider === "groq") return String(process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim();
  if (provider === "openrouter") return String(process.env.OPENROUTER_MODEL || "mistralai/mistral-7b-instruct:free").trim();
  if (provider === "local") return "local-fallback";
  return "";
}

function attachProviderMeta(result, provider, chain, extra = {}) {
  return {
    ...result,
    _meta: {
      provider,
      model: getProviderModel(provider),
      chain,
      ...extra,
    },
  };
}

function studyImagePrompt({ subject, topic, outputs, options }) {
  const requested = outputs.join(", ");
  const lines = [
    "Return strict JSON only.",
    `Subject: ${subject}`,
    `Topic: ${topic}`,
    `Requested outputs: ${requested}`,
    "You are reading study content from an uploaded image. Extract the educational content from the image and generate structured study materials.",
    "JSON shape:",
    '{"title":"...","summary":"...","keywords":["..."],"notesMarkdown":"# Title\\n\\n## Overview\\n...\\n\\n## Key Concepts\\n- ...\\n\\n## Quick Review\\n- ...","flashcards":[{"front":"...","back":"...","tags":["..."],"difficulty":"Easy|Medium|Hard"}],"assignments":[{"question":"...","example":"...","explanation":"...","difficulty":"Easy|Medium|Hard"}]}',
    "Rules:",
    "- notesMarkdown must include # Title, ## Overview, ## Key Concepts, and ## Quick Review",
    "- Use bullet points under Key Concepts",
    "- If includeDefinitions is true, add ## Definitions",
    "- If includeExamples is true, add ## Examples",
    "- summary <= 1200 chars",
    "- keywords max 30 items",
    "- flashcards between 5 and 50",
    `- assignments target count: ${Math.max(3, Math.min(20, Number(options?.assignmentCount || 8)))}`,
    `- flashcard target count: ${Math.max(5, Math.min(50, Number(options?.flashcardCount || 15)))}`,
    `- difficulty: ${options?.difficulty || "Mixed"}`,
    `- notes length preference: ${options?.notesLength || "Medium"}`,
  ];
  return lines.join("\n");
}

async function callOpenAI(payload) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const model = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You generate structured study materials as strict JSON." },
        { role: "user", content: studyPrompt(payload) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const data = await response.json();
  return parseStudyJson(data?.choices?.[0]?.message?.content || "");
}

async function callGemini(payload) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = String(process.env.GEMINI_MODEL || "gemini-flash-latest").trim().replace(/^models\//i, "");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      contents: [{ role: "user", parts: [{ text: studyPrompt(payload) }] }],
    }),
  });
  if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
  const data = await response.json();
  return parseStudyJson(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

async function callOpenAIImage(payload) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const model = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You generate structured study materials as strict JSON from educational images." },
        {
          role: "user",
          content: [
            { type: "text", text: studyImagePrompt(payload) },
            { type: "image_url", image_url: { url: payload.imageDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI image request failed (${response.status})`);
  const data = await response.json();
  return parseStudyJson(data?.choices?.[0]?.message?.content || "");
}

async function callGeminiImage(payload) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = String(process.env.GEMINI_MODEL || "gemini-flash-latest").trim().replace(/^models\//i, "");
  const base64 = String(payload.imageDataUrl || "").split(",")[1] || "";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      contents: [
        {
          role: "user",
          parts: [
            { text: studyImagePrompt(payload) },
            { inline_data: { mime_type: payload.imageMimeType, data: base64 } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Gemini image request failed (${response.status})`);
  const data = await response.json();
  return parseStudyJson(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

async function callGroq(payload) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");
  const model = String(process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim();
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You generate structured study materials as strict JSON." },
        { role: "user", content: studyPrompt(payload) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Groq request failed (${response.status})`);
  const data = await response.json();
  return parseStudyJson(data?.choices?.[0]?.message?.content || "");
}

async function callOpenRouter(payload) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const model = String(process.env.OPENROUTER_MODEL || "mistralai/mistral-7b-instruct:free").trim();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You generate structured study materials as strict JSON." },
        { role: "user", content: studyPrompt(payload) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`);
  const data = await response.json();
  return parseStudyJson(data?.choices?.[0]?.message?.content || "");
}

async function generateStudyOutput({ subject, topic, text, outputs, options, sourceClass = "" }) {
  const payload = { subject, topic, text: normalizeText(text), outputs, options, sourceClass };
  const { chain = ["local"] } = getAIProviderInfo() || {};
  const errors = [];

  for (const provider of chain) {
    try {
      if (provider === "openai") return attachProviderMeta(await callOpenAI(payload), provider, chain, { sourceKind: "text" });
      if (provider === "gemini") return attachProviderMeta(await callGemini(payload), provider, chain, { sourceKind: "text" });
      if (provider === "groq") return attachProviderMeta(await callGroq(payload), provider, chain, { sourceKind: "text" });
      if (provider === "openrouter") return attachProviderMeta(await callOpenRouter(payload), provider, chain, { sourceKind: "text" });
      if (provider === "local") return attachProviderMeta(localStudyOutput(payload), provider, chain, { sourceKind: "text" });
    } catch (err) {
      errors.push(`${provider}: ${String(err.message || err)}`);
    }
  }

  if (errors.length) {
    throw new StudyToolError(`All study tool providers failed. ${errors.join(" | ").slice(0, 500)}`, 500, "PROCESSING_FAILED");
  }
  return attachProviderMeta(localStudyOutput(payload), "local", chain, { sourceKind: "text", fallbackAfterErrors: true });
}

async function generateStudyOutputFromImage({ subject, topic, imageDataUrl, imageMimeType, outputs, options }) {
  const payload = { subject, topic, imageDataUrl, imageMimeType, outputs, options };
  const { chain = ["local"] } = getAIProviderInfo() || {};
  const errors = [];

  for (const provider of chain) {
    try {
      if (provider === "openai") return attachProviderMeta(await callOpenAIImage(payload), provider, chain, { sourceKind: "image" });
      if (provider === "gemini") return attachProviderMeta(await callGeminiImage(payload), provider, chain, { sourceKind: "image" });
      if (provider === "local") {
        throw new Error("Local provider does not support image study generation");
      }
    } catch (err) {
      errors.push(`${provider}: ${String(err.message || err)}`);
    }
  }

  throw new StudyToolError(`All study image providers failed. ${errors.join(" | ").slice(0, 500)}`, 500, "PROCESSING_FAILED");
}

module.exports = {
  validateStudyInput,
  validateImageStudyInput,
  generateStudyOutput,
  generateStudyOutputFromImage,
};
