const llm = require("./llm.js");
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const FALLBACK_OPENAI_MODELS = ["gpt-5.4", "gpt-4.1-mini"];
const KEY_PREFIX = ["s", "k"].join("") + "-";
const KEY_PATTERN = new RegExp("^" + KEY_PREFIX + "[A-Za-z0-9_-]+$");
const PROJECT_KEY_PATTERN = new RegExp(KEY_PREFIX + "proj-[A-Za-z0-9_-]+", "g");
const ANY_KEY_PATTERN = new RegExp(KEY_PREFIX + "[A-Za-z0-9_-]+", "g");

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch (error) {
      return Promise.reject(new Error("Request body is not valid JSON."));
    }
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function openAIKey() {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function validateOpenAIKey(key) {
  if (!key) return "AI assistance is not connected. Set OPENAI_API_KEY in Vercel, then redeploy.";
  if (!key.startsWith(KEY_PREFIX)) return "OPENAI_API_KEY does not look like an OpenAI key (should start with 'sk-'). Replace it with only the key, then redeploy.";
  if (/\s/.test(key)) return "OPENAI_API_KEY has spaces or line breaks in it. Paste only the key, then redeploy.";
  if (key.length < 20) return "OPENAI_API_KEY looks too short. Re-copy the full key, then redeploy.";
  return "";
}

function configuredModels() {
  const configured = String(process.env.OPENAI_MODEL || "").trim();
  return Array.from(new Set([DEFAULT_OPENAI_MODEL, configured].concat(FALLBACK_OPENAI_MODELS).filter(Boolean)));
}

function safeErrorMessage(message) {
  const text = String(message || "OpenAI API request failed.");
  if (/headers\.append|invalid header value/i.test(text)) {
    return "OPENAI_API_KEY in Vercel has extra text or invalid characters. Replace it with only the OpenAI key, then redeploy.";
  }
  return text
    .replace(PROJECT_KEY_PATTERN, "[redacted OpenAI key]")
    .replace(ANY_KEY_PATTERN, "[redacted API key]")
    .replace(/Bearer\s+[^"'`]+/g, "Bearer [redacted]");
}

function shouldTryNextModel(status, message) {
  if (status === 401) return false;
  return status === 400 || status === 403 || status === 404 ||
    (/model/i.test(message) && /not found|does not exist|unsupported|invalid|access/i.test(message));
}

function openAIError(openaiPayload) {
  const message = openaiPayload && openaiPayload.error && openaiPayload.error.message
    ? openaiPayload.error.message
    : "OpenAI API request failed.";
  return safeErrorMessage(message);
}

function trimBrief(brief) {
  return {
    title: brief && brief.meta && brief.meta.title,
    class_tier: brief && brief.class_tier,
    sources: brief && brief.knowledge_base && brief.knowledge_base.uploads,
    research: brief && brief.knowledge_base && brief.knowledge_base.research,
    credibility: brief && brief.knowledge_base && brief.knowledge_base.credibility,
    objectives: brief && brief.objectives,
    mastery: brief && brief.mastery,
    audience: brief && brief.audience,
    length: brief && brief.length,
    language: brief && brief.language
  };
}

function buildPrompt(body) {
  const payload = body.payload || {};
  return JSON.stringify({
    current_step: body.step_label || body.step,
    request_type: payload.type || "chat",
    question: payload.question || "",
    brief: trimBrief(body.brief || {}),
    rules: [
      "You are Bernard, a plain-language assistant for nontechnical class creators.",
      "Use only the provided class setup. Do not invent sources, dates, URLs, statistics, or claims.",
      "Treat the selected class tier as the knowledge-base standard. If the source list is thin for that tier, say exactly what is missing.",
      "Terminal and enabling learning objectives should come after knowledge-base research and analysis.",
      "If asked for final objectives before the knowledge base is ready, frame them as candidates that need verification.",
      "If recommending length, choose minutes and slide_budget in increments of 10.",
      "Never shorten a class because the learners are technical or familiar with the subject. Use that background to add more depth, examples, edge cases, practice, source analysis, and transfer.",
      "Keep answers concise and practical."
    ],
    required_json_shape: {
      answer: "string",
      recommendation: {
        minutes: "number",
        slide_budget: "number",
        polls: "number",
        word_clouds: "number",
        quizzes: "number",
        final_test: "boolean",
        reason: "string"
      }
    }
  }, null, 2);
}

function normalizeRecommendation(value, brief) {
  const current = brief && brief.length ? brief.length : {};
  const budget = current.interaction_budget || {};
  const currentMinutes = current.minutes || 60;
  const currentSlides = current.slide_budget || 90;
  const recommendedMinutes = clampNumber(value && value.minutes, currentMinutes, 10, 480, true);
  const recommendedSlides = clampNumber(value && value.slide_budget, currentSlides, 30, 400, true);
  return {
    minutes: recommendedMinutes,
    slide_budget: recommendedSlides,
    polls: clampNumber(value && value.polls, budget.polls || 2, 0, 50, false),
    word_clouds: clampNumber(value && value.word_clouds, budget.word_clouds || 4, 0, 50, false),
    quizzes: clampNumber(value && value.quizzes, budget.quizzes || 1, 0, 50, false),
    final_test: value && typeof value.final_test === "boolean" ? value.final_test : true,
    reason: String(value && value.reason ? value.reason : "Never shortened for experienced learners; technical familiarity adds depth, edge cases, and practice.").trim()
  };
}

function clampNumber(value, fallback, min, max, roundToTen) {
  const number = Number(value);
  const usable = Number.isFinite(number) ? Math.trunc(number) : fallback;
  const rounded = roundToTen ? Math.round(usable / 10) * 10 : usable;
  return Math.max(min, Math.min(max, rounded));
}

function engineFromBody(body) {
  const e = body && body.brief && body.brief.engine;
  return (e && typeof e === "object") ? { provider: e.provider, model: e.model } : { provider: "openai" };
}

async function requestGenie(body) {
  const engine = engineFromBody(body);
  const provider = llm.resolveProvider(engine.provider);
  const opts = {
    provider: provider,
    stage: "Bernard",
    temperature: 0.2,
    jsonMode: true,
    system: "You are Bernard for the Masterclass Factory. Output only valid JSON with answer and recommendation keys. Keep advice practical for nontechnical users. Never recommend shortening a class because learners are technical or familiar; add depth instead.",
    user: buildPrompt(body)
  };
  // Preserve the OpenAI model ladder; other providers use their chosen/default model.
  if (provider === "openai") opts.models = configuredModels();
  else if (engine.model) opts.model = engine.model;

  const result = await llm.completeJson(opts);
  const parsed = result.data || {};
  return {
    provider: result.provider,
    model: result.model,
    answer: String(parsed.answer || "Bernard reviewed this step.").trim(),
    recommendation: normalizeRecommendation(parsed.recommendation || {}, body.brief || {})
  };
}

module.exports = async function genieHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { ok: false, errors: ["Use POST with a class setup body."] });
    return;
  }

  try {
    let body;
    try {
      body = await readBody(req);
    } catch (bodyError) {
      send(res, 400, { ok: false, errors: [safeErrorMessage(bodyError.message)] });
      return;
    }

    // Provider-aware gate: 503 only if the CHOSEN provider isn't configured.
    // Default is OpenAI, so the original behavior and message are preserved.
    const engine = engineFromBody(body);
    const provider = llm.resolveProvider(engine.provider);
    if (!llm.isAvailable(provider)) {
      const msg = provider === "openai"
        ? validateOpenAIKey(openAIKey())
        : "AI assistance is not connected for the selected provider. Set its API key in Vercel, then redeploy.";
      send(res, 503, { ok: false, errors: [msg || "The selected AI provider is not configured."] });
      return;
    }

    const result = await requestGenie(body);
    send(res, 200, {
      ok: true,
      model: result.model,
      answer: result.answer,
      recommendation: result.recommendation
    });
  } catch (error) {
    send(res, 502, { ok: false, errors: [safeErrorMessage(error.message)] });
  }
};
