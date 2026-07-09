"use strict";

const { requireOpenAIKey, validateOpenAIKey, openAIKey, redactSecrets } = require("./env.js");
const { modelLadder } = require("./models.js");

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 90000;

function jsonSchemaFormat(name, schema) {
  return {
    type: "json_schema",
    name: name,
    strict: true,
    schema: toOpenAIJsonSchema(schema)
  };
}

function toOpenAIJsonSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  Object.keys(schema).forEach(function (key) {
    if (key === "required") return;
    if (key === "properties") {
      out.properties = {};
      const required = [];
      Object.keys(schema.properties || {}).forEach(function (prop) {
        const child = schema.properties[prop];
        out.properties[prop] = toOpenAIJsonSchema(child);
        if (child && child.required === true) required.push(prop);
      });
      if (required.length) out.required = required;
      return;
    }
    if (key === "items") {
      out.items = toOpenAIJsonSchema(schema.items);
      return;
    }
    out[key] = schema[key];
  });
  if (out.type === "object" && !out.additionalProperties) out.additionalProperties = false;
  return out;
}

function extractResponseText(payload) {
  if (payload && typeof payload.output_text === "string") return payload.output_text;
  const output = payload && Array.isArray(payload.output) ? payload.output : [];
  return output.map(function (item) {
    const content = Array.isArray(item.content) ? item.content : [];
    return content.map(function (part) {
      if (part && typeof part.text === "string") return part.text;
      if (part && typeof part.value === "string") return part.value;
      return "";
    }).join("");
  }).join("");
}

function parseJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function createOpenAIClient(options) {
  options = options || {};
  const fetchImpl = options.fetch || global.fetch;
  if (!fetchImpl) throw new Error("fetch is not available in this runtime.");
  const keyProvider = options.keyProvider || requireOpenAIKey;

  async function requestJson(url, body, timeoutMs) {
    const key = keyProvider();
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        const message = payload && payload.error && payload.error.message ? payload.error.message : "OpenAI request failed.";
        const error = new Error(redactSecrets(message));
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async function generateStructured(args) {
    args = args || {};
    const stage = args.stage || "reasoning";
    const models = args.models || modelLadder(stage);
    let lastError = null;
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      try {
        const payload = await requestJson(OPENAI_BASE_URL + "/responses", {
          model: model,
          instructions: args.instructions || "",
          input: args.input || "",
          tools: args.tools || [],
          text: { format: jsonSchemaFormat(args.schemaName || "structured_output", args.schema) },
          max_output_tokens: args.maxOutputTokens || 4000
        }, args.timeoutMs);
        const text = extractResponseText(payload);
        return {
          model: model,
          text: text,
          data: parseJson(text),
          usage: payload.usage || {}
        };
      } catch (error) {
        lastError = error;
        if (!(error.status === 400 || error.status === 403 || error.status === 404 || error.status === 429 || error.status >= 500)) throw error;
      }
    }
    throw lastError || new Error("OpenAI structured generation failed.");
  }

  async function generateText(args) {
    args = args || {};
    const stage = args.stage || "rendering";
    const models = args.models || modelLadder(stage);
    let lastError = null;
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      try {
        const payload = await requestJson(OPENAI_BASE_URL + "/responses", {
          model: model,
          instructions: args.instructions || "",
          input: args.input || "",
          max_output_tokens: args.maxOutputTokens || 1800
        }, args.timeoutMs);
        return {
          model: model,
          text: extractResponseText(payload),
          usage: payload.usage || {}
        };
      } catch (error) {
        lastError = error;
        if (!(error.status === 400 || error.status === 403 || error.status === 404 || error.status === 429 || error.status >= 500)) throw error;
      }
    }
    throw lastError || new Error("OpenAI text generation failed.");
  }

  async function verifyLiveKey() {
    const key = openAIKey();
    const problem = validateOpenAIKey(key);
    if (problem) return { ok: false, problem: problem };
    const response = await fetchImpl(OPENAI_BASE_URL + "/models", {
      method: "GET",
      headers: { authorization: "Bearer " + key }
    });
    if (!response.ok) return { ok: false, problem: "OpenAI key was rejected by /v1/models.", status: response.status };
    return { ok: true };
  }

  return {
    generateStructured: generateStructured,
    generateText: generateText,
    verifyLiveKey: verifyLiveKey
  };
}

module.exports = {
  createOpenAIClient: createOpenAIClient,
  extractResponseText: extractResponseText,
  parseJson: parseJson,
  toOpenAIJsonSchema: toOpenAIJsonSchema,
  jsonSchemaFormat: jsonSchemaFormat
};
