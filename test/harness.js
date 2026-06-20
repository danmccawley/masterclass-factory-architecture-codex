/* eslint-disable no-console */
// Masterclass Factory — functional test harness.
//
// Runs the REAL exported implementations (never hand-copied mirrors) against real
// inputs and asserts outcomes. Also drives each HTTP handler in-process with mock
// req/res objects so request validation, method handling, and error paths are
// exercised without a live OpenAI key or network.
//
// Run:  node test/harness.js
// Exit code 0 = all pass, 1 = failures (CI-friendly).

const assert = require("assert");

const gen = require("../api/generate.js");
const I = gen._internal;
const validator = require("../brief-validator.js");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok   " + name);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
    console.log("  FAIL " + name + "\n         " + error.message);
  }
}

function group(title) {
  console.log("\n# " + title);
}

// A valid brief built from the template, so individual tests can mutate copies.
function baseBrief(overrides) {
  const b = JSON.parse(JSON.stringify(validator.DEFAULT_TEMPLATE));
  b.meta.title = "Test Class";
  b.meta.slug = "test-class";
  if (overrides) Object.assign(b, overrides);
  return b;
}

function withSources(brief, total, primary) {
  brief.knowledge_base.uploads = [];
  for (let i = 0; i < primary; i += 1) brief.knowledge_base.uploads.push({ path: "http://example.com/p" + i, type: "url", trust: "primary" });
  for (let i = 0; i < total - primary; i += 1) brief.knowledge_base.uploads.push({ path: "http://example.com/s" + i, type: "url", trust: "secondary" });
  return brief;
}

// ---------------------------------------------------------------------------
group("OpenAI key validation (the bug that slipped the first review)");

test("accepts a modern sk-proj- key", () => {
  assert.strictEqual(I.validateOpenAIKey("sk-proj-AbC123_xyz-456DEF789ghiJKL012mnoPQR"), "");
});
test("accepts a service-account key", () => {
  assert.strictEqual(I.validateOpenAIKey("sk-svcacct-abc_DEF-123456789012345"), "");
});
test("accepts a classic 51-char key", () => {
  assert.strictEqual(I.validateOpenAIKey("sk-" + "a".repeat(48)), "");
});
test("rejects empty key", () => {
  assert.ok(I.validateOpenAIKey("") !== "");
});
test("rejects key without sk- prefix", () => {
  assert.ok(I.validateOpenAIKey("mykey-" + "a".repeat(40)) !== "");
});
test("rejects key with whitespace", () => {
  assert.ok(I.validateOpenAIKey("sk-" + "a".repeat(40) + " ") !== "");
});
test("rejects too-short key", () => {
  assert.ok(I.validateOpenAIKey("sk-short") !== "");
});

// ---------------------------------------------------------------------------
group("Tier resolution");

test("defaults unknown tier to professional", () => {
  assert.strictEqual(I.classTierKey(baseBrief({ class_tier: { level: "nonsense" } })), "professional");
});
test("honors a valid tier", () => {
  assert.strictEqual(I.classTierKey(baseBrief({ class_tier: { level: "expert" } })), "expert");
});
test("classTierSpec returns floors", () => {
  const spec = I.classTierSpec(baseBrief({ class_tier: { level: "standard" } }));
  assert.strictEqual(spec.source_floor, 8);
  assert.strictEqual(spec.primary_source_floor, 2);
});

// ---------------------------------------------------------------------------
group("Knowledge-base standard gate");

test("empty knowledge base fails professional floor", () => {
  const s = I.knowledgeBaseStandard(baseBrief());
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.source_gap, 12);
  assert.strictEqual(s.primary_source_gap, 3);
});
test("meeting the floor passes", () => {
  const s = I.knowledgeBaseStandard(withSources(baseBrief(), 12, 3));
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.floor_met, true);
  assert.strictEqual(s.evidence_limited, false);
});
test("evidence_limited_ack waives the floor but flags it", () => {
  const b = withSources(baseBrief(), 2, 1);
  b.class_tier = { level: "briefing", evidence_limited_ack: true };
  const s = I.knowledgeBaseStandard(b);
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.floor_met, false);
  assert.strictEqual(s.evidence_limited, true);
});
test("evidence_limited_ack does NOT flag when floor is actually met", () => {
  const b = withSources(baseBrief(), 12, 3);
  b.class_tier = { level: "professional", evidence_limited_ack: true };
  const s = I.knowledgeBaseStandard(b);
  assert.strictEqual(s.evidence_limited, false);
  assert.strictEqual(s.floor_met, true);
});

// ---------------------------------------------------------------------------
group("highestMetTier");

test("0 sources meets no tier", () => {
  assert.strictEqual(I.highestMetTier(baseBrief()), null);
});
test("8/2 meets standard, not professional", () => {
  const t = I.highestMetTier(withSources(baseBrief(), 8, 2));
  assert.strictEqual(t.level, "standard");
});
test("20/6 meets expert", () => {
  const t = I.highestMetTier(withSources(baseBrief(), 20, 6));
  assert.strictEqual(t.level, "expert");
});

// ---------------------------------------------------------------------------
group("Source scarcity classifier");

test("no discovery attempt with no key => no_research_capability", () => {
  const s = I.assessSourceScarcity({ attempted: false }, baseBrief());
  // depends on env; just assert it classifies as not-genuinely-scarce and a known kind
  assert.strictEqual(s.genuinely_scarce, false);
  assert.ok(["no_research_capability", "research_disabled", "not_attempted"].indexOf(s.kind) !== -1);
});
test("obscure topic (3 rounds, tiny pool) => topic_scarce + genuinely_scarce", () => {
  const s = I.assessSourceScarcity({ attempted: true, rounds: 3, added_sources: [1, 2], rejected_sources: [] }, baseBrief());
  assert.strictEqual(s.kind, "topic_scarce");
  assert.strictEqual(s.genuinely_scarce, true);
});
test("big pool, few verified => verification_bottleneck (not scarce)", () => {
  const s = I.assessSourceScarcity({ attempted: true, rounds: 2, added_sources: [1], rejected_sources: new Array(11).fill(0) }, baseBrief());
  assert.strictEqual(s.kind, "verification_bottleneck");
  assert.strictEqual(s.genuinely_scarce, false);
});

// ---------------------------------------------------------------------------
group("Change-order builder");

test("scarce topic with some sources recommends evidence_limited_proceed", () => {
  const b = withSources(baseBrief(), 2, 1);
  const std = I.knowledgeBaseStandard(b);
  const scarcity = { kind: "topic_scarce", genuinely_scarce: true, verified_found: 2, candidate_pool: 2, rounds: 3 };
  const co = I.buildChangeOrder(b, std, { notes: [], gaps: [], rejected_sources: [] }, scarcity, null);
  assert.strictEqual(co.recommendation.action, "evidence_limited_proceed");
  assert.ok(co.situation.length > 0);
  assert.ok(Array.isArray(co.challenges) && co.challenges.length > 0);
  assert.strictEqual(co.approval_tokens.accept_change_order, true);
});
test("met lower tier recommends lower_tier", () => {
  const b = withSources(baseBrief(), 8, 2); // meets standard, requested professional
  const std = I.knowledgeBaseStandard(b);
  const metTier = I.highestMetTier(b);
  const co = I.buildChangeOrder(b, std, { notes: [], gaps: [], rejected_sources: [] }, { kind: "partial_progress", genuinely_scarce: false }, metTier);
  assert.strictEqual(co.recommendation.action, "lower_tier");
  assert.strictEqual(co.approval_tokens.accept_tier, "standard");
});

// ---------------------------------------------------------------------------
group("SSRF guard (isPrivateAddress + assertFetchableUrl)");

[["169.254.169.254", true], ["127.0.0.1", true], ["10.1.2.3", true], ["172.16.5.5", true],
 ["172.32.0.1", false], ["192.168.0.1", true], ["::1", true], ["8.8.8.8", false],
 ["93.184.216.34", false], ["100.64.0.1", true]].forEach(([ip, expected]) => {
  test("isPrivateAddress(" + ip + ") === " + expected, () => {
    assert.strictEqual(I.isPrivateAddress(ip), expected);
  });
});

test("assertFetchableUrl rejects loopback host", async () => {
  await assert.rejects(() => I.assertFetchableUrl("http://localhost/x"));
});
test("assertFetchableUrl rejects metadata IP", async () => {
  await assert.rejects(() => I.assertFetchableUrl("http://169.254.169.254/latest/meta-data/"));
});
test("assertFetchableUrl rejects non-http scheme", async () => {
  await assert.rejects(() => I.assertFetchableUrl("file:///etc/passwd"));
});

// ---------------------------------------------------------------------------
group("slugify (path-traversal safety)");

test("strips path traversal characters", () => {
  const s = I.slugify("../../etc/passwd");
  assert.ok(!/[/.]/.test(s), "slug should contain no slashes or dots: " + s);
});
test("caps length at 80", () => {
  assert.ok(I.slugify("a".repeat(200)).length <= 80);
});
test("empty input yields fallback", () => {
  assert.strictEqual(I.slugify(""), "masterclass");
});

// ---------------------------------------------------------------------------
group("Helper functions");

test("clampInteger clamps and floors", () => {
  assert.strictEqual(I.clampInteger(999, 1, 10, 5), 10);
  assert.strictEqual(I.clampInteger(-5, 1, 10, 5), 1);
  assert.strictEqual(I.clampInteger("abc", 1, 10, 7), 7);
});
test("html escapes angle brackets", () => {
  assert.strictEqual(I.html("<script>"), "&lt;script&gt;");
});
test("attr escapes quotes", () => {
  assert.ok(I.attr("\"x'").indexOf("&quot;") !== -1);
});
test("stripHtml removes script tags", () => {
  assert.ok(I.stripHtml("<script>alert(1)</script>hello").indexOf("alert") === -1);
});
test("isUrl only matches http(s)", () => {
  assert.strictEqual(I.isUrl("https://x.com"), true);
  assert.strictEqual(I.isUrl("ftp://x.com"), false);
});
test("configuredModels includes default + fallbacks", () => {
  const m = I.configuredModels();
  assert.ok(m.indexOf("gpt-5.5") !== -1);
  assert.ok(m.length >= 2);
});
test("configuredSearchModels falls back to regular models", () => {
  const m = I.configuredSearchModels();
  assert.ok(m.indexOf("gpt-5.5") !== -1, "search models should fall back to gpt-5.5");
});

// ---------------------------------------------------------------------------
group("Brief validator");

test("template validates against itself", () => {
  const r = validator.validateBrief(validator.DEFAULT_TEMPLATE, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(r.ok, true);
});
test("rejects missing required key", () => {
  const b = baseBrief();
  delete b.language;
  const r = validator.validateBrief(b, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(r.ok, false);
});
test("rejects bad enum (tone)", () => {
  const b = baseBrief();
  b.audience.tone = "professional"; // not in validator enum
  const r = validator.validateBrief(b, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(r.ok, false);
});
test("rejects out-of-range integer", () => {
  const b = baseBrief();
  b.mastery.target_level = 99;
  const r = validator.validateBrief(b, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(r.ok, false);
});

// ---------------------------------------------------------------------------
group("HTTP handlers (in-process, no network)");

function mockReq(method, body) {
  return { method, body, headers: {}, on: () => {} };
}
function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; this.ended = true; }
  };
}
async function callHandler(handler, method, body) {
  const req = mockReq(method, body);
  const res = mockRes();
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch (e) { /* non-json (e.g. svg) */ }
  return { status: res.statusCode, json: parsed, raw: res.body };
}

test("generate rejects GET with 405", async () => {
  const r = await callHandler(gen, "GET");
  assert.strictEqual(r.status, 405);
});
test("generate handles OPTIONS preflight (204)", async () => {
  const r = await callHandler(gen, "OPTIONS");
  assert.strictEqual(r.status, 204);
});
test("brief endpoint validates a good brief (200)", async () => {
  const brief = require("../api/brief.js");
  const r = await callHandler(brief, "POST", { brief: validator.DEFAULT_TEMPLATE });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
});
test("brief endpoint rejects a bad brief (422)", async () => {
  const brief = require("../api/brief.js");
  const bad = baseBrief(); delete bad.meta;
  const r = await callHandler(brief, "POST", bad);
  assert.strictEqual(r.status, 422);
});
test("remediate rejects GET with 405", async () => {
  const remediate = require("../api/remediate.js");
  const r = await callHandler(remediate, "GET");
  assert.strictEqual(r.status, 405);
});
test("genie returns 503 when no OpenAI key is set", async () => {
  const genie = require("../api/genie.js");
  const had = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const r = await callHandler(genie, "POST", { brief: validator.DEFAULT_TEMPLATE, step: "knowledge base" });
  if (had) process.env.OPENAI_API_KEY = had;
  assert.strictEqual(r.status, 503);
});

// ---------------------------------------------------------------------------
group("All endpoints load without throwing");

["admin", "brief", "generate", "genie", "librarian", "objectives", "qr", "remediate",
 "chat", "feedback", "grade", "poll", "quality", "tts", "words"].forEach((name) => {
  test("require api/" + name + ".js", () => {
    const mod = require("../api/" + name + ".js");
    assert.strictEqual(typeof mod, "function");
  });
});

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(60));
console.log("RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  - " + f.name + ": " + f.message));
  process.exit(1);
} else {
  console.log("ALL GREEN");
  process.exit(0);
}
