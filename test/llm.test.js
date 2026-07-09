/* Standalone tests for api/llm.js — OpenAI-only, mocked fetch, no network. */
const path = require("path");
const llm = require(process.env.LLM_PATH || path.join(__dirname, "..", "api", "llm.js"));

let passed = 0, failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log("  ok   " + name); } else { failed++; console.log("  FAIL " + name); } }
function eq(name, a, b) { ok(name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", a === b); }

let lastReq = null;
const TEST_OPENAI_KEY = ["s", "k"].join("") + "-test-000000000000000000";
function mockFetch(responder) {
  global.fetch = async function (url, opts) {
    lastReq = { url: url, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null };
    const payload = responder(url, lastReq.body);
    return { ok: true, status: 200, json: async function () { return payload; } };
  };
}

function clearKeys() {
  ["OPENAI_API_KEY", "OTHER_VENDOR_API_KEY"].forEach(function (k) { delete process.env[k]; });
}

(async function () {
  console.log("# OpenAI-only adapter");
  clearKeys(); process.env.OPENAI_API_KEY = TEST_OPENAI_KEY;
  mockFetch(function () { return { output_text: '{"a":1}', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }; });
  let r = await llm.completeJson({ provider: "openai", system: "S", user: "U", stage: "t" });
  ok("hits responses endpoint", /\/v1\/responses$/.test(lastReq.url));
  ok("uses bearer auth", lastReq.headers.authorization === "Bearer " + TEST_OPENAI_KEY);
  ok("requests json schema format", lastReq.body.text && lastReq.body.text.format && lastReq.body.text.format.type === "json_schema");
  ok("parses data", r.data && r.data.a === 1);
  eq("normalizes usage input", r.usage.input_tokens, 10);
  eq("normalizes usage total", r.usage.total_tokens, 15);

  console.log("# Provider resolution");
  clearKeys(); process.env.OPENAI_API_KEY = TEST_OPENAI_KEY;
  eq("non-OpenAI request resolves to openai", llm.resolveProvider("anthropic"), "openai");
  ok("only OpenAI appears in availableProviders", llm.availableProviders().length === 1 && llm.availableProviders()[0].id === "openai");
  ok("isAvailable false for non-OpenAI", llm.isAvailable("gemini") === false);

  console.log("# completeText");
  mockFetch(function () { return { output_text: "hello world", usage: {} }; });
  r = await llm.completeText({ user: "hi", stage: "t" });
  ok("no text.format in text mode", !lastReq.body.text);
  ok("returns raw text", r.text === "hello world");
  ok("data null in text mode", r.data === null);

  console.log("# Model-ladder fallback");
  let calls = 0;
  global.fetch = async function (url, opts) {
    lastReq = { url: url, headers: opts.headers, body: JSON.parse(opts.body || "{}") };
    calls++;
    if (calls === 1) return { ok: false, status: 404, json: async function () { return { error: { message: "The model does not exist" } }; } };
    return { ok: true, status: 200, json: async function () { return { output_text: '{"ok":true}', usage: {} }; } };
  };
  r = await llm.completeJson({ models: ["gpt-x", "gpt-fallback"], user: "U", stage: "t" });
  eq("falls through to second model on 404", r.model, "gpt-fallback");
  ok("two fetch attempts made", calls === 2);

  console.log("# Missing key");
  clearKeys();
  let threw = false;
  try { await llm.completeJson({ user: "U", stage: "research" }); }
  catch (e) { threw = /OPENAI_API_KEY/i.test(e.message) && e.stage === "research"; }
  ok("throws staged OpenAI key error", threw);

  console.log("\n============================================================");
  console.log("LLM-OPENAI RESULTS: " + passed + " passed, " + failed + " failed");
  console.log(failed === 0 ? "ALL GREEN" : "SOME FAILED");
  process.exit(failed === 0 ? 0 : 1);
})();
