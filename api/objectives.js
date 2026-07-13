const { validateBrief } = require("../brief-validator.js");
const template = require("../brief.template.json");
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

function cleanArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeObjectives(value) {
  return {
    terminal: cleanArray(value && value.terminal, 5),
    enabling: cleanArray(value && value.enabling, 12),
    out_of_scope: cleanArray(value && value.out_of_scope, 8)
  };
}

// The wizard carries runtime-only authoring preferences alongside the strict
// Course Brief contract. Validate a copy without those transport fields, while
// preserving the original payload so model selection can still read `engine`.
function sanitizeBriefForValidation(brief) {
  const clone = JSON.parse(JSON.stringify(brief || {}));
  delete clone.engine;
  delete clone.theme;
  delete clone.budget_usd;
  return clone;
}

function buildPrompt(payload) {
  const brief = payload.brief;
  return JSON.stringify(
    {
      requested_mode: payload.mode,
      requested_action: payload.action,
      class_title: brief.meta.title,
      sources: brief.knowledge_base.uploads,
      research_prompts: brief.knowledge_base.research.seed_prompts,
      audience: brief.audience,
      mastery: brief.mastery,
      current_objectives: brief.objectives,
      instructions: [
        "Draft provisional learning-target ideas for a masterclass.",
        "Do not present these as final terminal or enabling learning objectives.",
        "Final TLOs and ELOs must be confirmed after source research, knowledge-base analysis, and learner-profile review.",
        "Terminal objective ideas should describe likely final learner capabilities.",
        "Enabling objective ideas should describe likely prerequisite or supporting skills.",
        "Out of scope lists topics that should be excluded.",
        "Use only the provided brief details. Do not invent sources, dates, URLs, statistics, or factual claims.",
        "Return compact plain-language bullets suitable for nontechnical class creators."
      ],
      required_json_shape: {
        terminal: ["string"],
        enabling: ["string"],
        out_of_scope: ["string"]
      }
    },
    null,
    2
  );
}

function configuredModels() {
  const configured = String(process.env.OPENAI_MODEL || "").trim();
  return Array.from(new Set([DEFAULT_OPENAI_MODEL, configured].concat(FALLBACK_OPENAI_MODELS).filter(Boolean)));
}

function openAIError(openaiPayload) {
  const message = openaiPayload && openaiPayload.error && openaiPayload.error.message
    ? openaiPayload.error.message
    : "OpenAI API request failed.";
  return safeErrorMessage(message);
}

function shouldTryNextModel(status, message) {
  if (status === 401) return false;
  return (
    status === 400 ||
    status === 403 ||
    status === 404 ||
    (/model/i.test(message) && /not found|does not exist|unsupported|invalid|access/i.test(message))
  );
}

function openAIKey() {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function validateOpenAIKey(key) {
  if (!key) {
    return "AI assistance is not connected. Set OPENAI_API_KEY in Vercel, then redeploy.";
  }
  if (!key.startsWith(KEY_PREFIX)) {
    return "OPENAI_API_KEY does not look like an OpenAI key (should start with 'sk-'). Replace it with only the key, then redeploy.";
  }
  if (/\s/.test(key)) {
    return "OPENAI_API_KEY has spaces or line breaks in it. Paste only the key, then redeploy.";
  }
  if (key.length < 20) {
    return "OPENAI_API_KEY looks too short. Re-copy the full key, then redeploy.";
  }
  return "";
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

function engineFromPayload(payload) {
  const e = payload && payload.brief && payload.brief.engine;
  return (e && typeof e === "object") ? { provider: e.provider, model: e.model } : { provider: "openai" };
}

async function requestObjectiveDraft(payload) {
  const engine = engineFromPayload(payload);
  const provider = llm.resolveProvider(engine.provider);
  const opts = {
    provider: provider,
    stage: "objectives",
    temperature: 0.2,
    jsonMode: true,
    system: "You are Bernard, the Masterclass Factory curriculum specialist. Output only valid JSON with terminal, enabling, and out_of_scope arrays. Treat them as provisional learning-target ideas until source research and knowledge-base analysis are complete. Never invent unverifiable facts.",
    user: buildPrompt(payload)
  };
  if (provider === "openai") opts.models = configuredModels();
  else if (engine.model) opts.model = engine.model;

  const result = await llm.completeJson(opts);
  return {
    provider: result.provider,
    model: result.model,
    objectives: normalizeObjectives(result.data || {})
  };
}

module.exports = async function objectivesHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { ok: false, errors: ["Use POST with a class brief body."] });
    return;
  }

  try {
    let payload;
    try {
      payload = await readBody(req);
    } catch (bodyError) {
      send(res, 400, { ok: false, errors: [safeErrorMessage(bodyError.message)] });
      return;
    }

    const valid = validateBrief(sanitizeBriefForValidation(payload.brief), template);
    if (!valid.ok) {
      send(res, 422, { ok: false, errors: valid.errors });
      return;
    }

    // Provider-aware gate: 503 only if the CHOSEN provider isn't configured.
    const engine = engineFromPayload(payload);
    const provider = llm.resolveProvider(engine.provider);
    if (!llm.isAvailable(provider)) {
      const msg = provider === "openai"
        ? validateOpenAIKey(openAIKey())
        : "AI assistance is not connected for the selected provider. Set its API key in Vercel, then redeploy.";
      send(res, 503, { ok: false, errors: [msg || "The selected AI provider is not configured."] });
      return;
    }

    const draft = await requestObjectiveDraft(payload);
    send(res, 200, {
      ok: true,
      message: "Bernard drafted provisional learning-target ideas. Final TLOs and ELOs should be confirmed after research.",
      model: draft.model,
      objectives: draft.objectives
    });
  } catch (error) {
    send(res, 502, { ok: false, errors: [safeErrorMessage(error.message)] });
  }
};
