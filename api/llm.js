"use strict";

const { createOpenAIClient } = require("../src/util/config/openai-client.js");
const { modelLadder, modelFor } = require("../src/util/config/models.js");
const { openAIKey, validateOpenAIKey, redactSecrets } = require("../src/util/config/env.js");

function stripFences(text) {
  return String(text == null ? "" : text).replace(/```json/gi, "").replace(/```/g, "").trim();
}

function parseJson(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_e2) { /* fall through */ }
    }
    return null;
  }
}

function legacyJsonSchema() {
  return {
    type: "object",
    additionalProperties: true,
    properties: {}
  };
}

function isAvailable(id) {
  return (!id || id === "openai") && validateOpenAIKey(openAIKey()) === "";
}

function availableProviders() {
  return [{
    id: "openai",
    label: "OpenAI",
    available: isAvailable("openai"),
    default_model: modelFor("reasoning")
  }];
}

function resolveProvider(requested) {
  if (requested && String(requested).trim().toLowerCase() !== "openai") return "openai";
  return "openai";
}

function resolveCall(req) {
  req = req || {};
  const key = req.apiKey ? String(req.apiKey).trim() : openAIKey();
  return { providerId: "openai", key: key, useByok: Boolean(req.apiKey && String(req.apiKey).trim()) };
}

async function completeJson(req) {
  req = req || {};
  const decided = resolveCall(req);
  const problem = validateOpenAIKey(decided.key);
  if (problem) {
    const error = new Error((req.stage || "OpenAI") + " failed: " + problem);
    error.stage = req.stage || "OpenAI";
    throw error;
  }
  const client = createOpenAIClient({
    keyProvider: function () { return decided.key; }
  });
  try {
    const result = await client.generateStructured({
      stage: req.stage || "reasoning",
      models: req.models || [req.model || modelFor("reasoning")].concat(modelLadder("reasoning")).filter(Boolean),
      instructions: req.system || "",
      input: req.user || "",
      schemaName: "legacy_json",
      schema: legacyJsonSchema(),
      maxOutputTokens: req.maxTokens || 1800,
      timeoutMs: req.timeoutMs || 60000
    });
    return {
      provider: "openai",
      model: result.model,
      text: result.text,
      data: result.data || parseJson(result.text),
      usage: normalizeUsage(result.usage)
    };
  } catch (error) {
    error.message = redactSecrets(error.message);
    error.stage = error.stage || req.stage;
    throw error;
  }
}

async function completeText(req) {
  req = req || {};
  const decided = resolveCall(req);
  const problem = validateOpenAIKey(decided.key);
  if (problem) {
    const error = new Error((req.stage || "OpenAI") + " failed: " + problem);
    error.stage = req.stage || "OpenAI";
    throw error;
  }
  const client = createOpenAIClient({
    keyProvider: function () { return decided.key; }
  });
  const result = await client.generateText({
    stage: req.stage || "rendering",
    models: req.models || [req.model || modelFor("rendering")].concat(modelLadder("rendering")).filter(Boolean),
    instructions: req.system || "",
    input: req.user || "",
    maxOutputTokens: req.maxTokens || 1800,
    timeoutMs: req.timeoutMs || 60000
  });
  return {
    provider: "openai",
    model: result.model,
    text: result.text,
    data: null,
    usage: normalizeUsage(result.usage)
  };
}

function normalizeUsage(usage) {
  usage = usage || {};
  const input = Number(usage.input_tokens || usage.prompt_tokens) || 0;
  const output = Number(usage.output_tokens || usage.completion_tokens) || 0;
  return { input_tokens: input, output_tokens: output, total_tokens: Number(usage.total_tokens) || input + output };
}

module.exports = {
  completeJson: completeJson,
  completeText: completeText,
  availableProviders: availableProviders,
  resolveProvider: resolveProvider,
  isAvailable: isAvailable,
  DEFAULT_PROVIDER: "openai",
  _internal: { parseJson: parseJson, stripFences: stripFences, resolveCall: resolveCall }
};
