"use strict";

const KEY_PREFIX = ["s", "k"].join("") + "-";
const ANY_KEY_PATTERN = new RegExp(KEY_PREFIX + "[A-Za-z0-9_-]+", "g");

function openAIKey() {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function validateOpenAIKey(key) {
  if (!key) return "OPENAI_API_KEY is not set.";
  if (!key.startsWith(KEY_PREFIX)) return "OPENAI_API_KEY must start with sk-.";
  if (/\s/.test(key)) return "OPENAI_API_KEY has spaces or line breaks.";
  if (key.length < 20) return "OPENAI_API_KEY is too short.";
  return "";
}

function requireOpenAIKey() {
  const key = openAIKey();
  const problem = validateOpenAIKey(key);
  if (problem) {
    const error = new Error(problem);
    error.code = "OPENAI_KEY_UNAVAILABLE";
    throw error;
  }
  return key;
}

function redactSecrets(text) {
  return String(text || "").replace(ANY_KEY_PATTERN, "[redacted OpenAI key]");
}

module.exports = {
  KEY_PREFIX: KEY_PREFIX,
  openAIKey: openAIKey,
  validateOpenAIKey: validateOpenAIKey,
  requireOpenAIKey: requireOpenAIKey,
  redactSecrets: redactSecrets
};
