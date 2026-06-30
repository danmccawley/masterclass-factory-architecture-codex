// lib/core/openai.js
//
// OpenAI client plumbing, extracted from api/generate.js (Sprint 3, module 5 —
// foundation step 2 of 3, behavior-preserving). This is the key/model layer the
// research engine (lib/core/research-engine.js) and the authoring path both sit
// on: env-key access + validation, the model-fallback ladder, error extraction,
// the next-model retry policy, and lenient JSON parsing of model output.
//
// Dependency direction: this module requires ONLY lib/core/diagnostics.js
// (KEY_PREFIX for the key-shape check, safeErrorMessage for error sanitizing).
// It requires NOTHING back from generate.js, so the core graph stays acyclic:
//   diagnostics  ->  openai  ->  research-engine  ->  generate
//
// The OpenAI model constants live here (this is their natural home); the search
// model is consumed by the research engine's configuredSearchModels() and is
// imported from here. STRICTLY behavior-preserving: bodies moved verbatim.
"use strict";

const { KEY_PREFIX, safeErrorMessage } = require("./diagnostics.js");

const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const FALLBACK_OPENAI_MODELS = ["gpt-5.4", "gpt-4.1-mini"];
const DEFAULT_OPENAI_SEARCH_MODEL = "gpt-5-search-api";

function openAIKey() {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function validateOpenAIKey(key) {
  if (!key) return "OPENAI_API_KEY is not set, so the generator used the conservative deterministic path.";
  // Accept any current OpenAI key shape: must start with "sk-", be reasonably
  // long, and contain no whitespace. We deliberately do NOT restrict the body to
  // a narrow character class — newer keys (sk-proj-..., service keys, etc.) use a
  // wider alphabet, and an over-strict pattern was rejecting valid keys and
  // forcing the deterministic/no-research path.
  if (!key.startsWith(KEY_PREFIX)) return "OPENAI_API_KEY does not look like an OpenAI key (it should start with 'sk-'). Replace it with only the key, then redeploy.";
  if (/\s/.test(key)) return "OPENAI_API_KEY has spaces or line breaks in it. Paste only the key with no surrounding quotes or spaces, then redeploy.";
  if (key.length < 20) return "OPENAI_API_KEY looks too short to be valid. Re-copy the full key, then redeploy.";
  return "";
}

// True when a usable OpenAI key is configured. validateOpenAIKey returns an
// empty string ("") on success and a non-empty message on failure, so the
// correct success test is `=== ""`, NOT `=== null`. (An earlier `=== null`
// comparison was always false, which silently skipped AI research even when a
// perfectly valid key was present.)
function openAIKeyUsable() {
  return validateOpenAIKey(openAIKey()) === "";
}

function configuredModels() {
  const configured = String(process.env.OPENAI_MODEL || "").trim();
  const models = [DEFAULT_OPENAI_MODEL, configured].concat(FALLBACK_OPENAI_MODELS).filter(Boolean);
  return Array.from(new Set(models));
}

function openAIError(payload) {
  const message = payload && payload.error && payload.error.message
    ? payload.error.message
    : "OpenAI API request failed.";
  return safeErrorMessage(message);
}

function shouldTryNextModel(status, message) {
  if (status === 401) return false;
  return status === 400 || status === 403 || status === 404 ||
    (/model/i.test(message) && /not found|does not exist|unsupported|invalid|access/i.test(message));
}

function parseJsonPayload(content) {
  const textValue = String(content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(textValue);
  } catch (error) {
    const match = textValue.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

module.exports = {
  DEFAULT_OPENAI_MODEL: DEFAULT_OPENAI_MODEL,
  FALLBACK_OPENAI_MODELS: FALLBACK_OPENAI_MODELS,
  DEFAULT_OPENAI_SEARCH_MODEL: DEFAULT_OPENAI_SEARCH_MODEL,
  openAIKey: openAIKey,
  validateOpenAIKey: validateOpenAIKey,
  openAIKeyUsable: openAIKeyUsable,
  configuredModels: configuredModels,
  openAIError: openAIError,
  shouldTryNextModel: shouldTryNextModel,
  parseJsonPayload: parseJsonPayload
};
