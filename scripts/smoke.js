/* eslint-disable no-console */
/* ============================================================================
   scripts/smoke.js — endpoint smoke harness (Sprint 0).
   ----------------------------------------------------------------------------
   Imports each api/ HTTP handler, invokes it in-process with a realistic mock
   request, and prints { endpoint, method, ok, status, ms } for each.

   Every external dependency is STUBBED — global.fetch is replaced with a
   canned router (no real OpenAI / Anthropic / Tavily / GitHub / Vercel-KV
   calls leave the process) and env vars are set to dummy values so provider-
   gated handlers proceed past their 503 checks. Nothing is published; no class
   is written to GitHub. This is a liveness/loads-and-responds check, not a
   correctness check.

   Run:  node scripts/smoke.js
   Exit: 0 if every endpoint responded without throwing, 1 otherwise.
============================================================================ */

// --- 1. Dummy env so provider/datastore gates pass (set BEFORE requiring) ----
const ENV_STUBS = {
  ANTHROPIC_API_KEY: "sk-ant-smoke-0000000000000000000000000000",
  OPENAI_API_KEY: "sk-proj-smoke0000000000000000000000000000000000000000",
  TAVILY_API_KEY: "tvly-smoke-000000000000000000000000",
  GITHUB_TOKEN: "ghp_smoke0000000000000000000000000000000000",
  GITHUB_OWNER: "areos",
  GITHUB_REPO: "masterclass-factory",
  GITHUB_BRANCH: "main",
  KV_REST_API_URL: "https://smoke.kv.local",
  KV_REST_API_TOKEN: "kv-smoke-token",
  POLL_ADMIN_KEY: "smoke-admin-key"
};
for (const [k, v] of Object.entries(ENV_STUBS)) {
  if (!process.env[k]) process.env[k] = v;
}

// --- 2. Stub global.fetch with a canned router ------------------------------
const realFetch = global.fetch;
let fetchCalls = 0;
let tavilyStubCall = 0; // seeds unique stubbed Tavily URLs across calls

function jsonResponse(obj, status) {
  const body = JSON.stringify(obj);
  return {
    ok: status ? status < 400 : true,
    status: status || 200,
    headers: { get: () => "application/json" },
    json: async () => obj,
    text: async () => body,
    arrayBuffer: async () => Buffer.from(body)
  };
}

function routeFetch(url, options) {
  const u = String(url);
  const method = (options && options.method) || "GET";
  // --- LLM providers ---------------------------------------------------------
  if (u.includes("api.openai.com/v1/responses")) {
    return jsonResponse({ output: [], output_text: "{}", usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u.includes("api.openai.com/v1/chat/completions")) {
    return jsonResponse({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    });
  }
  if (u.includes("api.openai.com/v1/audio/speech")) {
    return jsonResponse({ note: "stub-audio" });
  }
  if (u.includes("api.anthropic.com")) {
    return jsonResponse({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u.includes("generativelanguage.googleapis.com") || u.includes("api.x.ai")) {
    return jsonResponse({ choices: [{ message: { content: "{}" } }], candidates: [{ content: { parts: [{ text: "{}" }] } }], usage: {} });
  }
  // --- Tavily ----------------------------------------------------------------
  if (u.includes("api.tavily.com")) {
    let query = "";
    try { query = String(JSON.parse(options && options.body).query || ""); } catch (_e) { /* ignore */ }
    // A designated subject simulates a TRANSIENT provider outage so the
    // resilience path (retry → degrade → evidence-limited checkpoint, never a
    // bare 15) is exercised end-to-end.
    if (/evidence limited demo/i.test(query)) {
      return jsonResponse({ error: "upstream temporarily unavailable" }, 503);
    }
    // Otherwise return a healthy, varied batch: unique URLs per call (seeded by
    // a counter) with a primary/secondary mix, enough across the 3 queries to
    // clear the professional floor (12 total / 3 primary).
    tavilyStubCall += 1;
    const base = tavilyStubCall * 8;
    const results = [];
    for (let i = 1; i <= 8; i += 1) {
      const n = base + i;
      const primary = i % 2 === 0; // half primary
      const host = primary ? (i % 4 === 0 ? "www.loc.gov" : "agency.gov") : (i % 3 === 0 ? "example.edu" : "reference.org");
      results.push({ url: `https://${host}/smoke/${n}`, title: `Smoke source ${n}`, content: "stub source body" });
    }
    return jsonResponse({ results });
  }
  // --- GitHub Git Data API (publish + manifest read/write) -------------------
  if (u.includes("api.github.com")) {
    // A GET on a contents path = "does this manifest/file exist?". Return 404 so
    // readManifest sees "no such curriculum" and the handler takes its clean
    // not-found path instead of choking on a bogus stub manifest.
    if (method === "GET" && u.includes("/contents/")) {
      return jsonResponse({ message: "Not Found" }, 404);
    }
    // Cover the shapes generate.js / curriculum-store.js read back.
    return jsonResponse({
      sha: "smokesha0000000000000000000000000000",
      object: { sha: "smokesha0000000000000000000000000000" },
      tree: { sha: "smoketree000000000000000000000000000" },
      commit: { sha: "smokecommit00000000000000000000000" },
      content: { sha: "smokecontent0000000000000000000000", content: Buffer.from("{}").toString("base64") }
    });
  }
  // --- Vercel KV / Upstash pipeline ------------------------------------------
  if (u.includes(".kv.local") || u.includes("/pipeline")) {
    return jsonResponse([{ result: null }, { result: null }, { result: null }]);
  }
  // --- Source-verify URL fetches (any other http) ----------------------------
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    json: async () => ({}),
    text: async () => "<html><body>Smoke source body for verification.</body></html>",
    arrayBuffer: async () => Buffer.from("<html></html>")
  };
}

global.fetch = async function stubFetch(url, options) {
  fetchCalls += 1;
  return routeFetch(url, options);
};

// --- 3. Mock req/res (mirrors test/harness.js) ------------------------------
function mockReq(method, opts) {
  opts = opts || {};
  const query = opts.query || {};
  const qs = Object.keys(query).map((k) => k + "=" + encodeURIComponent(query[k])).join("&");
  // Some handlers read req.body directly (Vercel-style); others read the raw
  // stream via req.on('data'/'end'). Support both: expose req.body AND replay
  // the serialized body through the event emitter so stream readers don't hang.
  const payload = opts.body === undefined ? "" : (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
  return {
    method,
    url: (opts.path || "/") + (qs ? "?" + qs : ""),
    query,
    body: opts.body,
    headers: Object.assign({ host: "smoke.local" }, opts.headers || {}),
    on(event, cb) {
      if (event === "data" && payload) cb(Buffer.from(payload));
      if (event === "end") setImmediate(cb);
      return this;
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; }, // Express-style chainable
    writeHead(code, hdrs) { this.statusCode = code; if (hdrs) Object.assign(this.headers, hdrs); return this; },
    write(chunk) { this.body = (this.body || "") + (chunk == null ? "" : chunk); },
    json(obj) { this.body = JSON.stringify(obj); this.ended = true; if (!this.statusCode) this.statusCode = 200; },
    send(payload) { this.body = payload; this.ended = true; if (!this.statusCode) this.statusCode = 200; },
    end(payload) { if (payload != null) this.body = (this.body || "") + payload; this.ended = true; }
  };
}

// --- 4. A valid brief from the template -------------------------------------
const validator = require("../brief-validator.js");
function baseBrief() {
  const b = JSON.parse(JSON.stringify(validator.DEFAULT_TEMPLATE));
  b.meta.title = "Smoke Test Class";
  b.meta.slug = "smoke-test-class";
  return b;
}

// --- 5. Endpoint table ------------------------------------------------------
// Each entry: { name, module, method, opts }. Methods/bodies are representative.
function endpoints() {
  const brief = baseBrief();
  return [
    { name: "/api/providers", mod: "../api/providers.js", method: "GET" },
    { name: "/api/brief", mod: "../api/brief.js", method: "POST", opts: { body: { brief } } },
    { name: "/api/theme (GET catalog)", mod: "../api/theme.js", method: "GET" },
    { name: "/api/theme (POST)", mod: "../api/theme.js", method: "POST", opts: { body: { description: "calm academic blues" } } },
    { name: "/api/genie", mod: "../api/genie.js", method: "POST", opts: { body: { step: "create", payload: {}, brief } } },
    { name: "/api/objectives", mod: "../api/objectives.js", method: "POST", opts: { body: { brief } } },
    { name: "/api/knowledge-base (review)", mod: "../api/knowledge-base.js", method: "POST", opts: { body: { brief, mode: "review" } } },
    { name: "/api/remediate", mod: "../api/remediate.js", method: "POST", opts: { body: { brief } } },
    { name: "/api/curriculum", mod: "../api/curriculum.js", method: "POST", opts: { body: { subject: "Intro to Smoke Testing", classes: 3 } } },
    { name: "/api/curriculum-build (GET)", mod: "../api/curriculum-build.js", method: "GET", opts: { query: { slug: "smoke-curric" } } },
    { name: "/api/generate", mod: "../api/generate.js", method: "POST", opts: { body: { brief } } },
    { name: "/api/admin", mod: "../api/admin.js", method: "GET", opts: { headers: { "x-admin-key": process.env.POLL_ADMIN_KEY } } },
    { name: "/api/librarian", mod: "../api/librarian.js", method: "GET" },
    { name: "/api/qr", mod: "../api/qr.js", method: "GET", opts: { query: { url: "https://smoke.local/class" } } },
    { name: "/api/chat", mod: "../api/chat.js", method: "POST", opts: { body: { message: "hi", slide: 1, slideTitle: "Intro", history: [] } } },
    { name: "/api/grade", mod: "../api/grade.js", method: "POST", opts: { body: { question: "Q", rubric: "R", answer: "A", level: 3, levelName: "pro" } } },
    { name: "/api/poll (GET)", mod: "../api/poll.js", method: "GET", opts: { query: { qid: "smoke" } } },
    { name: "/api/words (GET)", mod: "../api/words.js", method: "GET", opts: { query: { qid: "smoke" } } },
    { name: "/api/feedback", mod: "../api/feedback.js", method: "POST", opts: { body: { slide: 1, slideNum: 1, context: "x", text: "great" } } },
    { name: "/api/quality", mod: "../api/quality.js", method: "POST", opts: { body: { slug: "smoke-test-class" } } },
    { name: "/api/tts", mod: "../api/tts.js", method: "POST", opts: { body: { text: "hello", voice: "fable" } } }
  ];
}

const PER_ENDPOINT_TIMEOUT_MS = 30000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("smoke timeout after " + ms + "ms (" + label + ")")), ms))
  ]);
}

async function run() {
  const rows = [];
  for (const ep of endpoints()) {
    const started = Date.now();
    let status = 0;
    let ok = false;
    let note = "";
    try {
      const handler = require(ep.mod);
      const req = mockReq(ep.method, ep.opts);
      const res = mockRes();
      await withTimeout(Promise.resolve(handler(req, res)), PER_ENDPOINT_TIMEOUT_MS, ep.name);
      status = res.statusCode || (res.ended ? 200 : 0);
      // Liveness check: "ok" = the handler RESPONDED without throwing or hanging.
      // A handled 4xx/5xx still counts as ok — under fully stubbed externals an
      // unparseable canned-model reply legitimately degrades to a 502, which is
      // the never-dead-end behavior we WANT, not a crash. The status column
      // carries that nuance.
      ok = status > 0;
      let parsed = null;
      try { parsed = JSON.parse(res.body); } catch (_e) { /* non-json (svg/audio) */ }
      if (parsed && typeof parsed.ok === "boolean") note = "body.ok=" + parsed.ok;
      else if (res.body != null) note = "non-json body (" + (res.headers["Content-Type"] || res.headers["content-type"] || "?") + ")";
      if (status >= 500) note += " [graceful 5xx: stubbed model reply unparseable]";
    } catch (error) {
      ok = false;
      status = 0;
      note = "THREW: " + String(error && error.message ? error.message : error).slice(0, 120);
    }
    rows.push({ endpoint: ep.name, method: ep.method, ok, status, ms: Date.now() - started, note });
  }
  return rows;
}

function printTable(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n=== SMOKE: api/ endpoints (all externals stubbed) ===\n");
  console.log(pad("endpoint", 34) + pad("method", 8) + pad("ok", 6) + pad("status", 8) + pad("ms", 7) + "note");
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(pad(r.endpoint, 34) + pad(r.method, 8) + pad(r.ok ? "yes" : "NO", 6) + pad(r.status, 8) + pad(r.ms, 7) + r.note);
  }
  const failed = rows.filter((r) => !r.ok);
  console.log("\n" + rows.length + " endpoints, " + (rows.length - failed.length) + " ok, " + failed.length + " failed. (" + fetchCalls + " stubbed fetch calls)");
  if (failed.length) console.log("FAILED: " + failed.map((r) => r.endpoint).join(", "));
}

// --- 6. KB resilience (Sprint 1 / B1): 5 subjects through /api/knowledge-base
// review with externals stubbed. Four subjects get a healthy stubbed Tavily
// (clear the floor, score > 70); one subject's provider returns a transient 503
// so the retry → degrade → evidence-limited path is exercised. We assert no
// subject throws and none returns a bare aborted/15 — discovery always resolves
// to a scored "ready" or an actionable "knowledge_base_review" checkpoint.
function kbBrief(title) {
  const b = baseBrief();
  b.meta.title = title;
  b.meta.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  b.knowledge_base.research.owner = "ai";
  b.knowledge_base.research.allow_web = true;
  return b;
}

const KB_SUBJECTS = [
  "Fiber optic cable installation in data centers",
  "The Texas War of Independence",
  "OSHA fall protection for residential roofing",
  "Municipal drinking water treatment fundamentals",
  "Evidence Limited Demo Topic (transient provider outage)" // triggers stub 503
];

async function runKbResilience() {
  const kb = require("../api/knowledge-base.js");
  const rows = [];
  for (const subject of KB_SUBJECTS) {
    const started = Date.now();
    let row = { subject, status: "?", score: null, sources: null, primary: null, options: 0, ok: false, note: "" };
    try {
      const req = mockReq("POST", { body: { brief: kbBrief(subject), mode: "review" } });
      const res = mockRes();
      await withTimeout(Promise.resolve(kb(req, res)), PER_ENDPOINT_TIMEOUT_MS, "kb:" + subject);
      const body = JSON.parse(res.body || "{}");
      const counts = body.knowledge_standard && body.knowledge_standard.counts;
      row.status = body.status || (body.ok ? "ready" : "?");
      const rawScore = body.score != null ? body.score : (body.knowledge_standard && body.knowledge_standard.score);
      row.score = (rawScore && typeof rawScore === "object") ? (rawScore.score != null ? rawScore.score : null) : rawScore;
      row.sources = counts ? counts.total : null;
      row.primary = counts ? counts.primary : null;
      row.options = Array.isArray(body.options) ? body.options.length : 0;
      // PASS = responded, didn't throw, and resolved to a real state (ready or a
      // review checkpoint) — never a bare error and never a sub-floor "15" with
      // no way forward. A review checkpoint must carry actionable options.
      const resolvedCleanly = res.statusCode === 200 && (row.status === "ready" || row.status === "knowledge_base_review");
      const checkpointActionable = row.status !== "knowledge_base_review" || row.options > 0;
      // Acceptance: a healthy subject that reaches the floor must score > 70.
      const scoreOk = row.status !== "ready" || (typeof row.score === "number" && row.score > 70);
      row.ok = resolvedCleanly && checkpointActionable && scoreOk;
      row.note = "KBDIAG status=" + row.status + " score=" + row.score + " sources=" + row.sources + "/" + row.primary + "(primary) options=" + row.options;
    } catch (error) {
      row.note = "THREW: " + String(error && error.message ? error.message : error).slice(0, 120);
    }
    row.ms = Date.now() - started;
    rows.push(row);
  }
  return rows;
}

function printKbTable(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n=== SMOKE: KB resilience — 5 subjects via /api/knowledge-base review (B1) ===\n");
  console.log(pad("subject", 52) + pad("ok", 5) + pad("status", 22) + pad("score", 7) + pad("src/prim", 10) + "opts");
  console.log("-".repeat(110));
  for (const r of rows) {
    console.log(pad(r.subject.slice(0, 50), 52) + pad(r.ok ? "yes" : "NO", 5) + pad(r.status, 22) + pad(r.score, 7) + pad(r.sources + "/" + r.primary, 10) + r.options);
  }
  const bad = rows.filter((r) => !r.ok);
  console.log("\n" + rows.length + " subjects, " + (rows.length - bad.length) + " resolved cleanly (ready or actionable checkpoint), " + bad.length + " problematic.");
  if (bad.length) console.log("PROBLEM: " + bad.map((r) => r.subject + " [" + r.note + "]").join("; "));
}

run()
  .then(async (rows) => {
    printTable(rows);
    const kbRows = await runKbResilience();
    printKbTable(kbRows);
    global.fetch = realFetch;
    const anyFail = rows.some((r) => !r.ok) || kbRows.some((r) => !r.ok);
    process.exit(anyFail ? 1 : 0);
  })
  .catch((error) => {
    console.error("smoke harness crashed:", error);
    global.fetch = realFetch;
    process.exit(1);
  });
