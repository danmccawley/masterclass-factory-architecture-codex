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

// Tests and group headers are ENQUEUED at definition time, then drained
// sequentially by runQueue() at the bottom. This is what makes async tests
// actually gate: each test fn (sync OR async) is awaited to completion before
// the next starts, and the process does not exit until every test has settled
// and reported. Sequential (never concurrent) execution also preserves the
// save/restore process.env discipline some tests rely on. Output order, the
// ok/FAIL format, and the pass/fail counting are unchanged from before.
const queue = [];

function test(name, fn) {
  queue.push({ type: "test", name, fn });
}

function group(title) {
  queue.push({ type: "group", title });
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
test("human can ALWAYS override when sources exist (even if NOT genuinely scarce)", () => {
  // Middle case: professional requested, found 6/2 — short of floor, not a met
  // tier, and NOT genuinely scarce. Previously this withheld the override. The
  // human must still get a 'proceed evidence-limited' option.
  const b = withSources(baseBrief(), 6, 2);
  const std = I.knowledgeBaseStandard(b);
  const co = I.buildChangeOrder(b, std, { notes: [], gaps: [], rejected_sources: [] }, { kind: "verification_bottleneck", genuinely_scarce: false }, null);
  assert.strictEqual(co.approval_tokens.accept_change_order, true, "override must be offered whenever sources exist");
});
test("legacy accept_change_order token still requires sources; proceed_anyway does not", () => {
  const b = baseBrief(); // zero sources
  const std = I.knowledgeBaseStandard(b);
  const co = I.buildChangeOrder(b, std, { notes: [], gaps: [], rejected_sources: [] }, { kind: "no_research_capability", genuinely_scarce: false }, null);
  // The legacy evidence-limited token needs at least one source...
  assert.strictEqual(co.approval_tokens.accept_change_order, false);
  // ...but build-anyway is still offered as the primary option (the factory
  // never blocks; the human is the only off-switch).
  assert.strictEqual(co.options[0].id, "proceed_anyway");
  assert.strictEqual(co.options[0].primary, true);
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
  // POST the BARE brief.json (what a real HTTP client sends and what brief.js
  // validates) — not a { brief: ... } wrapper. The wrapper was a false-pass
  // masked by the old non-awaiting runner (B13).
  const r = await callHandler(brief, "POST", validator.DEFAULT_TEMPLATE);
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
 "chat", "feedback", "grade", "poll", "quality", "tts", "words", "theme", "curriculum", "providers", "curriculum-build"].forEach((name) => {
  test("require api/" + name + ".js", () => {
    const mod = require("../api/" + name + ".js");
    assert.strictEqual(typeof mod, "function");
  });
});

// ---------------------------------------------------------------------------
group("AI research trigger (regression: === null vs === '' bug)");

test("openAIKeyUsable() is TRUE when a valid key is set", () => {
  const had = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-proj-" + "a".repeat(80);
  try {
    assert.strictEqual(I.openAIKeyUsable(), true);
  } finally {
    if (had === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = had;
  }
});
test("openAIKeyUsable() is FALSE when no key is set", () => {
  const had = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.strictEqual(I.openAIKeyUsable(), false);
  } finally {
    if (had !== undefined) process.env.OPENAI_API_KEY = had;
  }
});
test("validateOpenAIKey returns '' (not null) on success — the root cause", () => {
  // This is the exact assertion whose absence let the bug ship: code compared
  // the result to null, but success is an empty string.
  const r = I.validateOpenAIKey("sk-proj-" + "a".repeat(80));
  assert.strictEqual(r, "");
  assert.notStrictEqual(r, null);
});
test("the research-gate condition is truthy for a valid key (guards === null regression)", () => {
  // Root cause: production gated research on `validateOpenAIKey(key) === null`,
  // but success is "" so that was always false -> research always skipped.
  // These assertions fail if anyone reintroduces a null comparison.
  const validKey = "sk-proj-" + "a".repeat(80);
  const result = I.validateOpenAIKey(validKey);
  assert.strictEqual(result === null, false, "success is '' not null; '=== null' gate would always be false");
  assert.strictEqual(result === "", true, "success must be an empty string");
  // And the helper the gate now uses must be true for a valid key:
  const had = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = validKey;
  try {
    assert.strictEqual(I.openAIKeyUsable(), true, "openAIKeyUsable() must be true for a valid key");
  } finally {
    if (had === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = had;
  }
});
test("recovery ladder does NOT skip discovery when a valid key is present", async () => {
  const had = process.env.OPENAI_API_KEY;
  const fakeKey = "sk-proj-" + "a".repeat(80);
  process.env.OPENAI_API_KEY = fakeKey;
  try {
    // Hard precondition: the env var MUST be our fake key and MUST read usable.
    // If suite ordering polluted it, fail loudly rather than pass vacuously.
    assert.strictEqual(process.env.OPENAI_API_KEY, fakeKey, "env precondition not set");
    assert.strictEqual(I.openAIKeyUsable(), true, "key must read as usable");
    assert.strictEqual(I.openAIKey(), fakeKey, "openAIKey() must return the fake key");
    const brief = baseBrief();
    let ladder = null;
    try {
      const result = await I.resolveKnowledgeBase(brief);
      ladder = result && result.ladder;
    } catch (e) {
      ladder = (e && e.ladder) || null;
    }
    assert.ok(Array.isArray(ladder) && ladder.length > 0, "ladder should be recorded; got: " + JSON.stringify(ladder));
    const skipped = ladder.some((s) => String(s).indexOf("discovery-skipped-no-openai-key") !== -1);
    assert.strictEqual(skipped, false, "must not skip discovery with a valid key; ladder=" + JSON.stringify(ladder));
    const attempted = ladder.some((s) => String(s).indexOf("forced-ai-research-for-recovery") !== -1 || String(s).indexOf("discovery-rounds") !== -1);
    assert.ok(attempted, "ladder must record a discovery attempt; ladder=" + JSON.stringify(ladder));
  } finally {
    if (had === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = had;
  }
});

// ---------------------------------------------------------------------------
group("Knowledge-base scoring (blended: coverage/authority/recency)");

test("empty KB scores low (thin)", () => {
  const s = I.scoreKnowledgeBase(baseBrief());
  assert.ok(s.score < 55, "empty should be thin, got " + s.score);
  assert.strictEqual(s.band, "thin");
});
test("full floor scores high (excellent)", () => {
  const b = withSources(baseBrief(), 12, 3);
  b.knowledge_base.uploads.forEach((u) => { u.fetched = true; u.published = "2025"; });
  const s = I.scoreKnowledgeBase(b);
  assert.ok(s.score >= 85, "full should be excellent, got " + s.score);
});
test("all-primary scores higher than mixed at same count (authority works)", () => {
  const mixed = withSources(baseBrief(), 6, 2);
  const allP = withSources(baseBrief(), 6, 6);
  assert.ok(I.scoreKnowledgeBase(allP).score > I.scoreKnowledgeBase(mixed).score);
});
test("stale sources score lower than fresh (recency works)", () => {
  const fresh = withSources(baseBrief(), 6, 2);
  fresh.knowledge_base.research = { recency_floor: "2024-01-01" };
  fresh.knowledge_base.uploads.forEach((u) => { u.published = "2025"; });
  const stale = withSources(baseBrief(), 6, 2);
  stale.knowledge_base.research = { recency_floor: "2024-01-01" };
  stale.knowledge_base.uploads.forEach((u) => { u.published = "2019"; });
  assert.ok(I.scoreKnowledgeBase(fresh).score > I.scoreKnowledgeBase(stale).score);
});
test("score has component breakdown and summary", () => {
  const s = I.scoreKnowledgeBase(withSources(baseBrief(), 6, 2));
  assert.ok(typeof s.components.coverage === "number");
  assert.ok(typeof s.components.authority === "number");
  assert.ok(typeof s.components.recency === "number");
  assert.ok(s.summary && s.summary.length > 0);
});

group("Resolution options menu (never empty, always actionable)");

test("change order includes score and options", () => {
  const b = withSources(baseBrief(), 6, 2);
  const std = I.knowledgeBaseStandard(b);
  const co = I.buildChangeOrder(b, std, { notes: [], gaps: [], rejected_sources: [] }, { kind: "verification_bottleneck", genuinely_scarce: false }, null);
  assert.ok(co.score && typeof co.score.score === "number");
  assert.ok(Array.isArray(co.options) && co.options.length >= 3);
});
test("options always include search_again, add_source, ask_bernard", () => {
  const b = baseBrief(); // zero sources
  const std = I.knowledgeBaseStandard(b);
  const co = I.buildChangeOrder(b, std, { notes: [], gaps: [], rejected_sources: [] }, { kind: "no_research_capability", genuinely_scarce: false }, null);
  const ids = co.options.map((o) => o.id);
  assert.ok(ids.indexOf("search_again") !== -1);
  assert.ok(ids.indexOf("add_source") !== -1);
  assert.ok(ids.indexOf("ask_bernard") !== -1);
});
test("build-anyway is offered even with ZERO sources (human is the only off-switch)", () => {
  const withSrc = I.buildChangeOrder(withSources(baseBrief(), 3, 1), I.knowledgeBaseStandard(withSources(baseBrief(), 3, 1)), { notes: [] }, { kind: "topic_scarce", genuinely_scarce: true }, null);
  const zero = I.buildChangeOrder(baseBrief(), I.knowledgeBaseStandard(baseBrief()), { notes: [] }, { kind: "no_research_capability", genuinely_scarce: false }, null);
  // proceed_anyway must be present and PRIMARY in BOTH cases
  assert.strictEqual(withSrc.options[0].id, "proceed_anyway");
  assert.strictEqual(withSrc.options[0].primary, true);
  assert.strictEqual(zero.options[0].id, "proceed_anyway");
  assert.strictEqual(zero.options[0].primary, true);
});
test("options always include a decline (the only thing that prevents a build)", () => {
  const co = I.buildChangeOrder(baseBrief(), I.knowledgeBaseStandard(baseBrief()), { notes: [] }, { kind: "no_research_capability", genuinely_scarce: false }, null);
  assert.ok(co.options.some((o) => o.id === "decline_build"));
});
test("proceed_anyway token waives the floor even at zero sources", () => {
  const b = baseBrief(); // zero sources, professional
  b.class_tier = { level: "professional", evidence_limited_ack: true };
  const std = I.knowledgeBaseStandard(b);
  assert.strictEqual(std.ok, true, "must be buildable with consent even at zero sources");
  assert.strictEqual(std.evidence_limited, true, "must be flagged evidence-limited");
});

group("QA gate (structural block vs. graded quality decision — no dead-end)");

test("structural failure => structural_block, not shippable", () => {
  const o = I.resolveQaOutcome(
    { ok: false, issues: ["Slide x cites missing source section S9."] },
    { ok: true, issues: [] },
    { ok: false, score: 55, status: "needs revision", knowledge_standard: {} }
  );
  assert.strictEqual(o.kind, "structural_block");
  assert.strictEqual(o.shippable, false);
  assert.ok(o.options.some((x) => x.id === "regenerate"));
});
test("schema failure also blocks structurally", () => {
  const o = I.resolveQaOutcome(
    { ok: true, issues: [] },
    { ok: false, issues: ["content.js missing window.SLIDES."] },
    { ok: false, score: 80, status: "strong", knowledge_standard: {} }
  );
  assert.strictEqual(o.kind, "structural_block");
});
test("quality-only shortfall => graded decision, shippable with options", () => {
  const o = I.resolveQaOutcome(
    { ok: true, issues: [] },
    { ok: true, issues: [] },
    { ok: false, score: 64, status: "needs revision", recommendations: ["Deepen deep dives"], knowledge_standard: {} }
  );
  assert.strictEqual(o.kind, "quality_decision");
  assert.strictEqual(o.shippable, true);
  assert.strictEqual(o.quality_score, 64);
  const ids = o.options.map((x) => x.id);
  assert.ok(ids.indexOf("ship_anyway") !== -1);
  assert.ok(ids.indexOf("auto_improve") !== -1);
  assert.ok(ids.indexOf("ask_bernard") !== -1);
});
test("ship_anyway option carries accept_quality token", () => {
  const o = I.resolveQaOutcome({ ok: true, issues: [] }, { ok: true, issues: [] }, { ok: false, score: 64, status: "needs revision", recommendations: [], knowledge_standard: {} });
  const ship = o.options.find((x) => x.id === "ship_anyway");
  assert.ok(ship.token && ship.token.accept_quality === true);
});
test("all gates pass => pass outcome", () => {
  const o = I.resolveQaOutcome({ ok: true, issues: [] }, { ok: true, issues: [] }, { ok: true, score: 88, status: "strong" });
  assert.strictEqual(o.kind, "pass");
  assert.strictEqual(o.shippable, true);
});
test("structural block takes precedence over quality shortfall", () => {
  // Both structural AND low quality: must block structurally (the worse problem)
  const o = I.resolveQaOutcome(
    { ok: false, issues: ["citation gap"] },
    { ok: true, issues: [] },
    { ok: false, score: 50, status: "needs revision", knowledge_standard: {} }
  );
  assert.strictEqual(o.kind, "structural_block");
});

test("qaGate: thin slide/deep-dive is NOT a structural block (it's a quality judgment)", () => {
  // A structurally VALID deck whose content is deliberately thin. Thinness must
  // NOT make it structurally unshippable — quality scoring handles thinness.
  const files = {
    "content.js": "window.SLIDES=[];window.POLLS={};window.WORDS={};",
    "glossary.js": "window.GLOSSARY={};",
    "source.js": "window.SOURCE_PAPER={};"
  };
  const sourcePaper = { sections: [{ id: "s1", h: "S", body: "b" }] };
  const generated = {
    slides: [
      { id: "slide-1", eyebrow: "E", num: "01", deck: "tiny.", // far under 70 words
        paper: { secnum: "1", h: "H", body: "short deep dive." } }, // far under 120 words
      { id: "knowledge-base-works-cited", eyebrow: "E", num: "02", deck: "cited" }
    ],
    polls: {}, words: {}, glossary: {}, quizzes: []
  };
  const brief = { mastery: { deep_dive_density: "low" }, length: {} };
  const out = I.qaGate(files, generated, sourcePaper, brief);
  // No structural issue should mention "thin": thinness left the structural gate.
  assert.ok(!out.issues.some((i) => /thin/i.test(i)), "thinness must not appear as a structural issue");
});

test("qaGate: genuine structural problems still block", () => {
  const files = { "content.js": "window.POLLS={};", "glossary.js": "x", "source.js": "y" }; // missing window.SLIDES, GLOSSARY, SOURCE_PAPER
  const generated = { slides: [{ id: "", deck: "x" }], polls: {}, words: {}, glossary: {}, quizzes: [] };
  const out = I.qaGate(files, { ...generated }, { sections: [] }, { mastery: {}, length: {} });
  assert.strictEqual(out.ok, false);
  assert.ok(out.issues.some((i) => /window\.SLIDES/.test(i)), "missing globals must still be flagged structurally");
});

group("Sealed-brief validation (seal metadata lives outside the strict contract)");
test("a sealed brief FAILS raw validation (documents the bug)", () => {
  const sealed = JSON.parse(JSON.stringify(validator.DEFAULT_TEMPLATE));
  sealed.knowledge_base.sealed = true;
  sealed.knowledge_base.seal = { at: "now", by: "human", note: "", floor_met: true };
  sealed.knowledge_base._class_tier = { level: "professional" };
  const raw = validator.validateBrief(sealed, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(raw.ok, false); // strict exactKeys rejects the seal fields
});
test("sanitizeBriefForValidation strips seal metadata so it validates", () => {
  const sealed = JSON.parse(JSON.stringify(validator.DEFAULT_TEMPLATE));
  sealed.knowledge_base.sealed = true;
  sealed.knowledge_base.seal = { at: "now", by: "human" };
  sealed.knowledge_base._class_tier = { level: "professional" };
  sealed.budget_usd = 25;
  const cleaned = I.sanitizeBriefForValidation(sealed);
  const out = validator.validateBrief(cleaned, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(out.ok, true, out.errors && out.errors.join("; "));
});
test("sanitizer does not mutate the original sealed brief", () => {
  const sealed = JSON.parse(JSON.stringify(validator.DEFAULT_TEMPLATE));
  sealed.knowledge_base.sealed = true;
  I.sanitizeBriefForValidation(sealed);
  assert.strictEqual(sealed.knowledge_base.sealed, true); // original keeps sealed for the seal short-circuit
});
test("sanitizer whitelists round-engine upload metadata (fetched/reachable_only) so sealed sources validate", () => {
  const sealed = JSON.parse(JSON.stringify(validator.DEFAULT_TEMPLATE));
  sealed.knowledge_base.sealed = true;
  // A source as the round engine folds it in on Accept & seal:
  sealed.knowledge_base.uploads = [
    { path: "https://ieee.org/x", type: "standard", trust: "primary", fetched: true, reachable_only: false, title: "X" }
  ];
  const rawErrors = validator.validateBrief(sealed, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(rawErrors.ok, false); // fetched/reachable_only/title rejected by exactKeys
  const cleaned = I.sanitizeBriefForValidation(sealed);
  const out = validator.validateBrief(cleaned, validator.DEFAULT_TEMPLATE);
  assert.strictEqual(out.ok, true, out.errors && out.errors.join("; "));
  // and the cleaned upload kept exactly the contract keys
  assert.deepStrictEqual(Object.keys(cleaned.knowledge_base.uploads[0]).sort(), ["path", "trust", "type"]);
});
test("sanitizer strips optional theme + budget_usd so a themed brief validates", () => {
  const b = JSON.parse(JSON.stringify(validator.DEFAULT_TEMPLATE));
  b.theme = { mode: "named", named: "dune" };
  b.budget_usd = 12;
  assert.strictEqual(validator.validateBrief(b, validator.DEFAULT_TEMPLATE).ok, false); // strict contract rejects them
  const cleaned = I.sanitizeBriefForValidation(b);
  assert.strictEqual(validator.validateBrief(cleaned, validator.DEFAULT_TEMPLATE).ok, true);
  assert.strictEqual(b.theme.named, "dune"); // original untouched (generator still reads it)
});

group("Slide budget (honor explicit low counts; floor is only a default)");

function briefWithBudget(budget) {
  const b = baseBrief();
  b.length = b.length || {};
  if (budget === undefined) delete b.length.slide_budget; else b.length.slide_budget = budget;
  return b;
}

test("explicit budget of 1 yields 1 slide", () => {
  assert.strictEqual(I.totalSlideTarget(briefWithBudget(1)), 1);
});
test("explicit budget of 3 yields 3 slides", () => {
  assert.strictEqual(I.totalSlideTarget(briefWithBudget(3)), 3);
});
test("explicit budget of 10 yields 10 (below old 30 floor)", () => {
  assert.strictEqual(I.totalSlideTarget(briefWithBudget(10)), 10);
});
test("explicit budget caps at 400 max", () => {
  assert.strictEqual(I.totalSlideTarget(briefWithBudget(5000)), 400);
});
test("unset budget falls back to a sensible default (>= floor)", () => {
  const t = I.totalSlideTarget(briefWithBudget(undefined));
  assert.ok(t >= I.slideBudgetFloor(briefWithBudget(undefined)));
});
test("deep-dive requirement never exceeds teaching slides", () => {
  const b = baseBrief();
  b.mastery = b.mastery || {}; b.mastery.deep_dive_density = "med";
  [1, 2, 3].forEach((ts) => {
    assert.ok(I.requiredDeepDiveCount(b, ts) <= ts, "deep dives must not exceed " + ts + " teaching slides");
  });
});
test("zero teaching slides requires zero deep dives", () => {
  assert.strictEqual(I.requiredDeepDiveCount(baseBrief(), 0), 0);
});

group("Knowledge base never blocks (resolves to review pause, not failure)");

test("floor-not-met resolves to knowledge_base_review (never needs_human/change_order block)", async () => {
  const had = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // no research → definitely short of floor
  try {
    const r = await I.resolveKnowledgeBase(baseBrief());
    assert.strictEqual(r.resolution, "knowledge_base_review", "must pause for review, not block");
    assert.ok(r.change_order, "review carries the analysis/change_order");
    assert.ok(r.standard && r.standard.score, "review carries the score");
  } finally {
    if (had !== undefined) process.env.OPENAI_API_KEY = had;
  }
});
test("floor met resolves straight to ready", async () => {
  const b = withSources(baseBrief(), 12, 3);
  const r = await I.resolveKnowledgeBase(b);
  assert.strictEqual(r.resolution, "ready");
});

// ---------------------------------------------------------------------------
group("Knowledge base directive (interactive-and-sealed; never re-litigated)");

test("a sealed KB short-circuits to ready and is never re-litigated", async () => {
  const b = baseBrief(); // zero sources
  b.knowledge_base.sealed = true;
  const r = await I.resolveKnowledgeBase(b);
  assert.strictEqual(r.resolution, "ready", "sealed KB must resolve ready, never review");
  assert.strictEqual(r.sealed, true, "resolution carries the sealed flag");
  assert.ok(r.ladder.indexOf("knowledge-base-sealed-by-human") !== -1, "ladder records the seal short-circuit");
});

test("a sealed KB builds even with ZERO sources (human already decided)", async () => {
  const b = baseBrief();
  b.knowledge_base.uploads = [];
  b.knowledge_base.sealed = true;
  const r = await I.resolveKnowledgeBase(b);
  assert.strictEqual(r.resolution, "ready", "zero-source sealed KB still proceeds to build");
  assert.ok(r.standard, "carries a standard snapshot");
});

test("sealed flag is preserved when the floor IS met", async () => {
  const b = withSources(baseBrief(), 12, 3);
  b.knowledge_base.sealed = true;
  const r = await I.resolveKnowledgeBase(b);
  assert.strictEqual(r.resolution, "ready");
  assert.strictEqual(r.sealed, true);
});

test("detectAdvancementOpportunity is non-blocking: returns null without a key", async () => {
  const had = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const b = baseBrief();
    b.knowledge_base.sealed = true;
    const op = await I.detectAdvancementOpportunity(b);
    assert.strictEqual(op, null, "no key → no probe → null, never throws");
  } finally {
    if (had !== undefined) process.env.OPENAI_API_KEY = had;
  }
});

test("detectAdvancementOpportunity returns null when web research is disabled", async () => {
  const b = baseBrief();
  b.knowledge_base.sealed = true;
  b.knowledge_base.research = b.knowledge_base.research || {};
  b.knowledge_base.research.allow_web = false;
  const op = await I.detectAdvancementOpportunity(b);
  assert.strictEqual(op, null, "web disabled → no probe → null");
});

// ---------------------------------------------------------------------------
// Drain the queue in definition order, awaiting each test to full settlement.
async function runQueue() {
  for (const item of queue) {
    if (item.type === "group") {
      console.log("\n# " + item.title);
      continue;
    }
    try {
      await item.fn();
      passed += 1;
      console.log("  ok   " + item.name);
    } catch (error) {
      failed += 1;
      const message = error && error.message ? error.message : String(error);
      failures.push({ name: item.name, message });
      console.log("  FAIL " + item.name + "\n         " + message);
    }
  }

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
}

runQueue().catch((error) => {
  // A throw in the runner itself (not a test assertion) must never pass silently.
  console.error("HARNESS RUNNER CRASHED:", error);
  process.exit(1);
});
