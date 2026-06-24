/* ============================================================================
   llm.js — Provider abstraction for all model calls.
   ----------------------------------------------------------------------------
   One chokepoint so every endpoint (generate, genie, theme, curriculum) can
   call a model without knowing which provider is behind it. Adding a provider
   is one registry entry + an API key — no call-site changes.

   Common request shape:
     completeJson({ provider, model, system, user, maxTokens, temperature, jsonMode })
   Normalized response:
     { provider, model, text, data, usage:{ input_tokens, output_tokens, total_tokens } }

   Default provider is OpenAI, so existing behavior is preserved until a caller
   explicitly asks for another. If a requested provider has no key configured,
   we degrade to the default rather than dead-ending (never dead-end the job).
============================================================================ */

const DEFAULT_TIMEOUT_MS = 60000;

function envFirst(/* ...names */) {
  for (let i = 0; i < arguments.length; i++) {
    const v = String(process.env[arguments[i]] || "").trim();
    if (v) return v;
  }
  return "";
}

function stripFences(text) {
  return String(text == null ? "" : text).replace(/```json/gi, "").replace(/```/g, "").trim();
}

function parseJson(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    // Tolerate prose-wrapped JSON: grab the outermost object/array.
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_e2) { /* fall through */ }
    }
    return null;
  }
}

function jsonInstruction(system) {
  const note = "Return ONLY a single valid JSON value. No prose, no explanation, no code fences.";
  return system ? (system + "\n\n" + note) : note;
}

/* ---------------------------------------------------------------------------
   Provider registry. Each adapter:
     keyEnv:    env var names (first non-empty wins)
     defaultModelEnv / defaultModel: model resolution
     build(req, key): -> { url, headers, body }
     extract(payload): -> text
     usage(payload): -> { input_tokens, output_tokens, total_tokens }
--------------------------------------------------------------------------- */

function openAICompatible(label, baseUrl, keyEnvNames, modelEnvNames, fallbackModel) {
  return {
    label: label,
    keyEnv: keyEnvNames,
    defaultModel: function () { return envFirst.apply(null, modelEnvNames) || fallbackModel; },
    build: function (req, key) {
      const body = {
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system || "" },
          { role: "user", content: req.user || "" }
        ]
      };
      if (req.jsonMode) body.response_format = { type: "json_object" };
      return {
        url: baseUrl + "/chat/completions",
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: body
      };
    },
    extract: function (payload) {
      return payload && payload.choices && payload.choices[0] && payload.choices[0].message
        ? payload.choices[0].message.content : "";
    },
    usage: function (payload) {
      const u = (payload && payload.usage) || {};
      const input = Number(u.prompt_tokens) || 0;
      const output = Number(u.completion_tokens) || 0;
      return { input_tokens: input, output_tokens: output, total_tokens: Number(u.total_tokens) || input + output };
    }
  };
}

const PROVIDERS = {
  openai: openAICompatible(
    "OpenAI",
    "https://api.openai.com/v1",
    ["OPENAI_API_KEY"],
    ["OPENAI_MODEL"],
    "gpt-5.5"
  ),

  xai: openAICompatible(
    "xAI (Grok)",
    "https://api.x.ai/v1",
    ["XAI_API_KEY", "GROK_API_KEY"],
    ["XAI_MODEL", "GROK_MODEL"],
    "grok-4"
  ),

  anthropic: {
    label: "Anthropic (Claude)",
    keyEnv: ["ANTHROPIC_API_KEY"],
    defaultModel: function () { return envFirst("ANTHROPIC_MODEL") || "claude-sonnet-4-6"; },
    build: function (req, key) {
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: {
          model: req.model,
          max_tokens: req.maxTokens || 1800,
          temperature: req.temperature,
          system: req.jsonMode ? jsonInstruction(req.system) : (req.system || ""),
          messages: [{ role: "user", content: req.user || "" }]
        }
      };
    },
    extract: function (payload) {
      if (!payload || !Array.isArray(payload.content)) return "";
      return payload.content.map(function (b) { return b && b.type === "text" ? b.text : ""; }).join("");
    },
    usage: function (payload) {
      const u = (payload && payload.usage) || {};
      const input = Number(u.input_tokens) || 0;
      const output = Number(u.output_tokens) || 0;
      return { input_tokens: input, output_tokens: output, total_tokens: input + output };
    }
  },

  gemini: {
    label: "Google (Gemini)",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    defaultModel: function () { return envFirst("GEMINI_MODEL") || "gemini-2.5-pro"; },
    build: function (req, key) {
      const gen = { temperature: req.temperature, maxOutputTokens: req.maxTokens || 1800 };
      if (req.jsonMode) gen.responseMimeType = "application/json";
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(req.model) + ":generateContent?key=" + encodeURIComponent(key),
        headers: { "content-type": "application/json" },
        body: {
          systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
          contents: [{ role: "user", parts: [{ text: req.user || "" }] }],
          generationConfig: gen
        }
      };
    },
    extract: function (payload) {
      const cand = payload && payload.candidates && payload.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      return Array.isArray(parts) ? parts.map(function (p) { return p && p.text ? p.text : ""; }).join("") : "";
    },
    usage: function (payload) {
      const u = (payload && payload.usageMetadata) || {};
      const input = Number(u.promptTokenCount) || 0;
      const output = Number(u.candidatesTokenCount) || 0;
      return { input_tokens: input, output_tokens: output, total_tokens: Number(u.totalTokenCount) || input + output };
    }
  }
};

const DEFAULT_PROVIDER = "openai";

function providerKey(id) {
  const p = PROVIDERS[id];
  if (!p) return "";
  return envFirst.apply(null, p.keyEnv);
}

function isAvailable(id) {
  return Boolean(PROVIDERS[id]) && Boolean(providerKey(id));
}

/* Public: list providers and whether each has a key configured. Drives the UI. */
function availableProviders() {
  return Object.keys(PROVIDERS).map(function (id) {
    return {
      id: id,
      label: PROVIDERS[id].label,
      available: isAvailable(id),
      default_model: PROVIDERS[id].defaultModel()
    };
  });
}

/* Resolve the provider actually used: requested -> default -> first available.
   Never throws here; throws only if literally nothing is configured. */
function resolveProvider(requested) {
  const want = String(requested || "").trim().toLowerCase();
  if (want && isAvailable(want)) return want;
  if (isAvailable(DEFAULT_PROVIDER)) return DEFAULT_PROVIDER;
  const firstAvailable = Object.keys(PROVIDERS).filter(isAvailable)[0];
  if (firstAvailable) return firstAvailable;
  return want && PROVIDERS[want] ? want : DEFAULT_PROVIDER; // let the call surface a clear key error
}

function shouldRetry(status) {
  return status === 429 || (status >= 500 && status < 600) || status === 0;
}

/* Core call. Behavior-preserving for OpenAI JSON authoring (temp/json/usage). */
async function completeJson(req) {
  req = req || {};
  const jsonMode = req.jsonMode !== false; // default true
  const providerId = resolveProvider(req.provider);
  const provider = PROVIDERS[providerId];
  const key = providerKey(providerId);
  const stage = req.stage || "model call";

  if (!provider) throw stageError(stage, "Unknown provider \"" + req.provider + "\".");
  if (!key) {
    throw stageError(stage, provider.label + " is not configured. Set " + provider.keyEnv.join(" or ") + " in the environment.");
  }

  const models = (Array.isArray(req.models) && req.models.length)
    ? req.models
    : [req.model || provider.defaultModel()].filter(Boolean);
  const temperature = typeof req.temperature === "number" ? req.temperature : 0.18;
  const maxTokens = req.maxTokens || 1800;
  const timeoutMs = req.timeoutMs || DEFAULT_TIMEOUT_MS;

  let failed;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const built = provider.build({
      model: model, system: req.system, user: req.user,
      maxTokens: maxTokens, temperature: temperature, jsonMode: jsonMode
    }, key);

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      const response = await fetch(built.url, {
        method: "POST",
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: controller.signal
      });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        const message = errorMessage(payload, response.status);
        failed = { status: response.status, message: message, model: model };
        if (shouldRetry(response.status) && i < models.length - 1) continue;
        throw stageError(stage, message);
      }
      const text = provider.extract(payload) || "";
      const usage = provider.usage(payload);
      return {
        provider: providerId,
        model: model,
        text: text,
        data: jsonMode ? parseJson(text) : null,
        usage: usage
      };
    } catch (error) {
      if (error && error.stage) throw error; // already a stage error from !ok
      failed = { status: 0, message: safeMessage(error), model: model };
      if (i >= models.length - 1) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw stageError(stage, failed ? failed.message : (provider.label + " request failed."));
}

/* Convenience: plain-text completion (e.g., chat). */
async function completeText(req) {
  const out = await completeJson(Object.assign({}, req, { jsonMode: false }));
  return out;
}

function errorMessage(payload, status) {
  if (payload && payload.error) {
    if (typeof payload.error === "string") return payload.error;
    if (payload.error.message) return payload.error.message;
  }
  if (payload && payload.message) return payload.message;
  return "Provider error (HTTP " + status + ").";
}

function safeMessage(error) {
  const m = error && (error.message || error.toString && error.toString());
  if (!m) return "Request failed.";
  if (/abort/i.test(m)) return "The model call timed out.";
  return String(m).slice(0, 300);
}

function stageError(stage, message) {
  const error = new Error(stage + " failed: " + message);
  error.stage = stage;
  return error;
}

module.exports = {
  completeJson: completeJson,
  completeText: completeText,
  availableProviders: availableProviders,
  resolveProvider: resolveProvider,
  isAvailable: isAvailable,
  DEFAULT_PROVIDER: DEFAULT_PROVIDER,
  _internal: { PROVIDERS: PROVIDERS, parseJson: parseJson, stripFences: stripFences, providerKey: providerKey }
};
