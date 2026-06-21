/* eslint-disable no-console */
// test/kb-rounds.test.js
//
// Tests the incremental knowledge-base round engine (api/kb-rounds.js). It uses
// the REAL scoring/standard/counts primitives from generate.js and fakes ONLY
// the two network primitives (findSourceCandidates, fetchUrlText), so it is
// deterministic and runs with no network or API key. Asserts the honest signals:
// dedup across rounds, new-sources-per-round, floor detection, and the
// continue/narrow/stop recommendation. Run: node test/kb-rounds.test.js

const assert = require("assert");
const gen = require("../api/generate.js");
const { runKnowledgeBaseRound, recommendationFor } = require("../api/kb-rounds.js");
const I = gen._internal;

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed += 1; console.log("  ok   " + name); },
    (e) => { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
  );
}
function group(t) { console.log("\n# " + t); }

// Real scoring; fake network. Batches are scripted so we control discovery.
function makePrimitives(batches) {
  let call = 0;
  return {
    knowledgeBaseStandard: I.knowledgeBaseStandard,
    scoreKnowledgeBase: I.scoreKnowledgeBase,
    sourceCounts: I.sourceCounts,
    classTierSpec: I.classTierSpec,
    normalizeDiscoveredSources: I.normalizeDiscoveredSources,
    fetchUrlText: async (u) => (/dead/.test(u) ? { ok: false, error: "HTTP 404" } : { ok: true, text: "content" }),
    findSourceCandidates: async () => ({ model: "fake", data: { source_candidates: batches[Math.min(call++, batches.length - 1)], gaps: ["edge cases", "recent practice"] } })
  };
}
function brief() {
  return { meta: { title: "Test topic" }, class_tier: { level: "professional" }, knowledge_base: { uploads: [], research: { allow_web: true, owner: "ai", recency_floor: "2020" } } };
}
const SRC = (n, trust) => ({ url: "https://src/" + n, trust: trust || "secondary" });

(async function () {
  group("Incremental rounds: dedup, decay, floor detection");

  // Round 1: 12 candidates (3 primary) -> meets professional floor (12/3).
  // Round 2: 3 repeats of round 1 + 3 fresh -> only 3 NEW counted.
  // Round 3: all repeats -> 0 new (saturation).
  const r1set = [];
  for (let i = 1; i <= 12; i += 1) r1set.push(SRC(i, i <= 3 ? "primary" : "secondary"));
  const r2set = [SRC(1), SRC(2), SRC(3), SRC(13), SRC(14), SRC(15)];
  const P = makePrimitives([r1set, r2set, r2set]);
  const b = brief();

  const r1 = await runKnowledgeBaseRound({ brief: b, state: null, primitives: P });
  await test("round 1 index is 1", () => assert.strictEqual(r1.checkpoint.round, 1));
  await test("round 1 counts 12 new verified sources", () => assert.strictEqual(r1.checkpoint.new_claims, 12));
  await test("round 1 meets the floor (12/12, 3/3 primary)", () => assert.strictEqual(r1.checkpoint.floor_met, true));
  await test("round 1 score uses real scorer (has coverage/authority/recency)", () => {
    assert.ok(r1.checkpoint.components && typeof r1.checkpoint.components.coverage === "number");
    assert.ok(typeof r1.checkpoint.overall_score === "number");
  });
  await test("round 1 recommends narrow (floor met, lots still new)", () => assert.strictEqual(r1.checkpoint.recommendation, "narrow"));

  const r2 = await runKnowledgeBaseRound({ brief: b, state: r1.state, primitives: P });
  await test("round 2 dedups repeats -> only 3 new", () => assert.strictEqual(r2.checkpoint.new_claims, 3));
  await test("round 2 cumulative is 15", () => assert.strictEqual(r2.checkpoint.cumulative_sources, 15));
  await test("curve decays [12,3]", () => assert.strictEqual(JSON.stringify(r2.checkpoint.new_per_round), "[12,3]"));

  const r3 = await runKnowledgeBaseRound({ brief: b, state: r2.state, primitives: P });
  await test("round 3 finds nothing new (saturated)", () => assert.strictEqual(r3.checkpoint.new_claims, 0));
  await test("round 3 recommends stop", () => assert.strictEqual(r3.checkpoint.recommendation, "stop"));
  await test("round 3 cumulative unchanged at 15", () => assert.strictEqual(r3.checkpoint.cumulative_sources, 15));

  group("Floor-not-met path: structural vs closeable");
  // Tiny pool: round 1 finds 2, round 2 finds 0 -> floor never met, saturated.
  const P2 = makePrimitives([[SRC(1, "primary"), SRC(2)], []]);
  const b2 = brief();
  const s1 = await runKnowledgeBaseRound({ brief: b2, state: null, primitives: P2 });
  await test("floor unmet but still finding -> continue", () => {
    assert.strictEqual(s1.checkpoint.floor_met, false);
    assert.strictEqual(s1.checkpoint.recommendation, "continue");
  });
  await test("open gaps tagged closeable while still finding", () => {
    assert.ok(s1.checkpoint.threads.length >= 1);
    assert.strictEqual(s1.checkpoint.threads[0].type, "closeable");
  });
  const s2 = await runKnowledgeBaseRound({ brief: b2, state: s1.state, primitives: P2 });
  await test("floor unmet + saturated -> stop (structural)", () => {
    assert.strictEqual(s2.checkpoint.new_claims, 0);
    assert.strictEqual(s2.checkpoint.recommendation, "stop");
  });
  await test("gaps tagged structural once saturated below floor", () => assert.strictEqual(s2.checkpoint.threads[0].type, "structural"));

  group("Dead URLs and recommendation logic");
  const P3 = makePrimitives([[{ url: "https://dead/1" }, SRC(99, "primary")]]);
  const d1 = await runKnowledgeBaseRound({ brief: brief(), state: null, primitives: P3 });
  await test("dead URL rejected, only reachable counted", () => assert.strictEqual(d1.checkpoint.new_claims, 1));
  await test("dead URL recorded in state", () => assert.ok(d1.state.dead.indexOf("https://dead/1") !== -1));
  await test("recommendationFor: unmet+finding=continue", () => assert.strictEqual(recommendationFor(false, false, 3), "continue"));
  await test("recommendationFor: unmet+saturated=stop", () => assert.strictEqual(recommendationFor(false, true, 0), "stop"));
  await test("recommendationFor: met+new=narrow", () => assert.strictEqual(recommendationFor(true, false, 5), "narrow"));
  await test("recommendationFor: met+dry=stop", () => assert.strictEqual(recommendationFor(true, true, 1), "stop"));

  group("Composition ledger (tier 1: line-by-line, auditable)");
  const { buildCompositionLedger } = require("../api/kb-rounds.js");
  const ledP = makePrimitives([[SRC(1, "primary"), { url: "https://dead/x" }, SRC(2, "secondary"), SRC(3)]]);
  const lb = brief();
  const lr = await runKnowledgeBaseRound({ brief: lb, state: null, primitives: ledP });
  const ledger = buildCompositionLedger(lr.state, lb, ledP);
  await test("ledger lists one row per accepted source", () => assert.strictEqual(ledger.sources.length, 3));
  await test("ledger records the rejected source WITH a reason", () => {
    assert.strictEqual(ledger.rejected.length, 1);
    assert.ok(ledger.rejected[0].path.indexOf("dead") !== -1);
    assert.ok(ledger.rejected[0].reason && ledger.rejected[0].reason.length > 0);
  });
  await test("ledger totals count primary vs secondary", () => {
    assert.strictEqual(ledger.totals.primary, 1);
    assert.ok(ledger.totals.total === 3);
  });
  await test("verified sources carry full-text status", () => {
    assert.ok(ledger.sources.every(s => /full text|reachable|verified|declared/.test(s.verification)));
  });
  await test("every row carries the honest tier-2 caveat", () => {
    assert.ok(ledger.sources.every(s => /credibility/.test(s.reliability_note)));
    assert.ok(/reliability ledger/.test(ledger.caveat));
  });
  await test("class-maker uploads are tagged origin, not 'found by Bernard'", () => {
    const b3 = brief();
    b3.knowledge_base.uploads = [{ path: "https://mine/1", type: "url", trust: "primary" }];
    const led2 = buildCompositionLedger({ accepted: [], dead: [], rejected: [], rounds_run: 0, new_per_round: [] }, b3, ledP);
    assert.strictEqual(led2.sources[0].origin, "added by class maker");
  });

  console.log("\n" + "=".repeat(60));
  console.log("ROUND-ENGINE RESULTS: " + passed + " passed, " + failed + " failed");
  if (failed) {
    console.log("\nFAILURES:");
    failures.forEach((f) => console.log("  - " + f.name + ": " + f.message));
    process.exit(1);
  } else {
    console.log("ALL GREEN");
    process.exit(0);
  }
})();
