// lib/core/diagnostics.js
//
// Failure-handling and logging primitives, extracted from api/generate.js
// (Sprint 3, module 5 — foundation step 1 of 3, behavior-preserving). This is a
// LEAF module: it requires nothing (not util, not generate.js), so it sits at
// the very bottom of the dependency graph. The OpenAI client (lib/core/openai.js)
// and the research engine (lib/core/research-engine.js) build on top of it.
//
// What lives here:
//   - safeErrorMessage  — sanitize an error string, redacting any OpenAI key
//                         material so it can never reach a log or a response.
//   - isTimeoutMessage / isTransientFailure — classify a failure as retryable.
//   - kbdiag            — KBDIAG marker logger for the external-call path.
//   - safeHost          — best-effort hostname for a URL (never throws).
//   - discoveryDelay    — promisified setTimeout for retry backoff.
//
// The key-shape constants (KEY_PREFIX + the redaction patterns) live here because
// safeErrorMessage's redaction needs them; lib/core/openai.js imports KEY_PREFIX
// from here for validateOpenAIKey rather than redefining it, which keeps the
// single obfuscated definition AND avoids a cycle between the two core modules.
//
// STRICTLY behavior-preserving: every body and constant is moved verbatim.
"use strict";

// One retry per external provider on a TRANSIENT failure (abort/timeout/5xx/429),
// with a short backoff. Bounded so retries can never blow the function budget.
// Pairs with discoveryDelay(); shared by the research engine and withStageRetry.
const DISCOVERY_RETRY_BACKOFF_MS = 400;

// Obfuscated so the literal key prefix never appears in source (secret scanners).
const KEY_PREFIX = ["s", "k"].join("") + "-";
const PROJECT_KEY_PATTERN = new RegExp(KEY_PREFIX + "proj-[A-Za-z0-9_-]+", "g");
const ANY_KEY_PATTERN = new RegExp(KEY_PREFIX + "[A-Za-z0-9_-]+", "g");

function safeErrorMessage(message) {
  const raw = String(message || "OpenAI API request failed.");
  if (/headers\.append|invalid header value/i.test(raw)) {
    return "OPENAI_API_KEY has extra text or invalid characters. Replace it with only the OpenAI key, then redeploy.";
  }
  return raw
    .replace(PROJECT_KEY_PATTERN, "[redacted OpenAI key]")
    .replace(ANY_KEY_PATTERN, "[redacted API key]")
    .replace(/Bearer\s+[^"'`]+/g, "Bearer [redacted]");
}

function isTimeoutMessage(message) {
  return /abort|aborted|timeout|timed out/i.test(String(message || ""));
}

// A TRANSIENT failure is worth exactly one retry: an HTTP 429 or 5xx, or a
// status-0 abort/timeout/network blip. A 4xx (other than 429) is a hard answer
// from the server and must NOT be retried. Used to gate retry + degrade across
// every external discovery call (Tavily, OpenAI web search, source fetch).
function isTransientFailure(status, message) {
  const s = Number(status) || 0;
  if (s === 429 || (s >= 500 && s < 600)) return true;
  if (s >= 400 && s < 500) return false; // hard client answer (404/403/etc.)
  return isTimeoutMessage(message) || /network|fetch failed|socket|econn|etimedout|eai_again/i.test(String(message || ""));
}

// Consistent KBDIAG marker for every external discovery call, so the runtime
// logs show exactly which provider degraded and how it was handled. Never logs
// key material. Mirrors the handler's KBDIAG so one grep covers the whole path.
function kbdiag(obj) {
  try { console.log("KBDIAG " + JSON.stringify(obj)); } catch (e) { /* logging must never throw */ }
}

function discoveryDelay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch (e) { return ""; }
}

module.exports = {
  DISCOVERY_RETRY_BACKOFF_MS: DISCOVERY_RETRY_BACKOFF_MS,
  KEY_PREFIX: KEY_PREFIX,
  PROJECT_KEY_PATTERN: PROJECT_KEY_PATTERN,
  ANY_KEY_PATTERN: ANY_KEY_PATTERN,
  safeErrorMessage: safeErrorMessage,
  isTimeoutMessage: isTimeoutMessage,
  isTransientFailure: isTransientFailure,
  kbdiag: kbdiag,
  discoveryDelay: discoveryDelay,
  safeHost: safeHost
};
