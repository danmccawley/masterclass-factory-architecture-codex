/* Standalone tests for api/llm.js — mocks global.fetch, no network, no deps. */
const path = require("path");
const llm = require(process.env.LLM_PATH || path.join(__dirname, "..", "api", "llm.js"));

let passed = 0, failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log("  ok   " + name); } else { failed++; console.log("  FAIL " + name); } }
function eq(name, a, b) { ok(name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", a === b); }

// Capture the last request and return a canned, provider-shaped payload.
let lastReq = null;
function mockFetch(responder) {
  global.fetch = async function (url, opts) {
    lastReq = { url: url, headers: opts.headers, body: JSON.parse(opts.body || "{}") };
    const payload = responder(url, lastReq.body);
    return { ok: true, status: 200, json: async function () { return payload; } };
  };
}

function clearKeys() {
  ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY", "GROK_API_KEY"].forEach(function (k) { delete process.env[k]; });
}

(async function () {
  console.log("# OpenAI adapter");
  clearKeys(); process.env.OPENAI_API_KEY = "sk-test";
  mockFetch(function () { return { choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }; });
  let r = await llm.completeJson({ provider: "openai", system: "S", user: "U", stage: "t" });
  ok("hits chat/completions", /\/v1\/chat\/completions$/.test(lastReq.url));
  ok("uses bearer auth", lastReq.headers.authorization === "Bearer sk-test");
  ok("requests json_object", lastReq.body.response_format && lastReq.body.response_format.type === "json_object");
  ok("parses data", r.data && r.data.a === 1);
  eq("normalizes usage input", r.usage.input_tokens, 10);
  eq("normalizes usage total", r.usage.total_tokens, 15);

  console.log("# Anthropic adapter");
  clearKeys(); process.env.ANTHROPIC_API_KEY = "ant-test";
  mockFetch(function () { return { content: [{ type: "text", text: '{"b":2}' }], usage: { input_tokens: 7, output_tokens: 3 } }; });
  r = await llm.completeJson({ provider: "anthropic", system: "Base", user: "U", stage: "t" });
  ok("hits /v1/messages", /\/v1\/messages$/.test(lastReq.url));
  ok("uses x-api-key", lastReq.headers["x-api-key"] === "ant-test");
  ok("sends anthropic-version", lastReq.headers["anthropic-version"] === "2023-06-01");
  ok("injects JSON instruction into system", /ONLY a single valid JSON/.test(lastReq.body.system) && /Base/.test(lastReq.body.system));
  ok("user goes in messages", lastReq.body.messages[0].content === "U");
  ok("parses content[].text", r.data && r.data.b === 2);
  eq("usage total = in+out", r.usage.total_tokens, 10);

  console.log("# Gemini adapter");
  clearKeys(); process.env.GEMINI_API_KEY = "gem-test";
  mockFetch(function () { return { candidates: [{ content: { parts: [{ text: '{"c":3}' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, totalTokenCount: 10 } }; });
  r = await llm.completeJson({ provider: "gemini", system: "S", user: "U", stage: "t" });
  ok("hits generateContent with key", /:generateContent\?key=gem-test$/.test(lastReq.url));
  ok("sets responseMimeType json", lastReq.body.generationConfig.responseMimeType === "application/json");
  ok("parses candidates[].parts", r.data && r.data.c === 3);
  eq("usage from usageMetadata", r.usage.input_tokens, 4);

  console.log("# xAI (Grok) adapter");
  clearKeys(); process.env.XAI_API_KEY = "xai-test";
  mockFetch(function () { return { choices: [{ message: { content: '{"d":4}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; });
  r = await llm.completeJson({ provider: "xai", system: "S", user: "U", stage: "t" });
  ok("hits api.x.ai", /^https:\/\/api\.x\.ai\/v1\/chat\/completions$/.test(lastReq.url));
  ok("parses data", r.data && r.data.d === 4);

  console.log("# Provider resolution / availability");
  clearKeys(); process.env.OPENAI_API_KEY = "sk-test";
  eq("requested-but-unconfigured falls back to openai", llm.resolveProvider("anthropic"), "openai");
  eq("configured request honored", llm.resolveProvider("openai"), "openai");
  ok("isAvailable true with key", llm.isAvailable("openai") === true);
  ok("isAvailable false without key", llm.isAvailable("gemini") === false);
  const avail = llm.availableProviders();
  ok("availableProviders lists all four", avail.length === 4);
  ok("openai marked available", avail.filter(function (p) { return p.id === "openai"; })[0].available === true);

  console.log("# completeText (non-JSON)");
  clearKeys(); process.env.OPENAI_API_KEY = "sk-test";
  mockFetch(function () { return { choices: [{ message: { content: "hello world" } }], usage: {} }; });
  r = await llm.completeText({ provider: "openai", user: "hi", stage: "t" });
  ok("no json_object in text mode", !lastReq.body.response_format);
  ok("returns raw text", r.text === "hello world");
  ok("data null in text mode", r.data === null);

  console.log("# Missing key surfaces a clear error");
  clearKeys();
  let threw = false;
  try { await llm.completeJson({ provider: "anthropic", user: "U", stage: "research" }); }
  catch (e) { threw = /not configured/i.test(e.message) && e.stage === "research"; }
  ok("throws staged 'not configured' when no keys", threw);

  console.log("\n============================================================");
  console.log("LLM-PROVIDER RESULTS: " + passed + " passed, " + failed + " failed");
  console.log(failed === 0 ? "ALL GREEN" : "SOME FAILED");
  process.exit(failed === 0 ? 0 : 1);
})();
