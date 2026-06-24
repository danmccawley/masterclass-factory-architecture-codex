/* eslint-disable no-console */
// test/curriculum-coherence.test.js — deterministic coherence engine (api/curriculum-coherence.js).
const assert = require("assert");
const H = require("../api/curriculum-coherence.js")._internal;
const S = require("../api/curriculum-store.js")._internal;

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

// Build a manifest from raw classes, then patch prerequisites by slug since
// normalize keeps prerequisites verbatim and re-sequences order.
function manifest(over) {
  return S.makeManifest(over);
}
function codes(result) { return result.findings.map(function (f) { return f.code; }); }

group("Tokenizer + objective normalization");
test("tokenize drops stopwords and objective verbs, keeps topic words", function () {
  const t = H.tokenize("Explain the Calvin cycle and photosynthesis");
  assert.ok(t.calvin && t.cycle && t.photosynthesis);
  assert.ok(!t.explain && !t.the && !t.and);
});
test("normObjective lowercases, trims, strips trailing punctuation", function () {
  assert.strictEqual(H.normObjective("  Explain Light Reactions.  "), "explain light reactions");
});

group("Clean DAG");
test("a well-ordered curriculum with valid prerequisites passes with no errors", function () {
  const m = manifest({ subject: "Photosynthesis", program_outcome: "Explain photosynthesis light reactions and calvin cycle", classes: [
    { title: "Light reactions", terminal: ["Explain light reactions"], prerequisites: [] },
    { title: "Calvin cycle", terminal: ["Explain the calvin cycle"], prerequisites: ["light-reactions"] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.summary.errors, 0);
  assert.strictEqual(r.graph.edges.length, 1);
});

group("Gap detection");
test("a prerequisite that isn't a class is an unresolved_prerequisite error", function () {
  const m = manifest({ classes: [
    { title: "Advanced", terminal: ["Do advanced"], prerequisites: ["intro-basics"] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.strictEqual(r.ok, false);
  assert.ok(codes(r).indexOf("unresolved_prerequisite") >= 0);
});
test("a prerequisite taught later (forward dependency) is an error", function () {
  // Class order 1 requires a class at order 2.
  const m = manifest({ classes: [
    { title: "First", order: 1, terminal: ["Use the basics"], prerequisites: ["basics"] },
    { title: "Basics", order: 2, terminal: ["Explain basics"], prerequisites: [] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.strictEqual(r.ok, false);
  assert.ok(codes(r).indexOf("forward_prerequisite") >= 0);
});

group("Cycle detection");
test("a prerequisite cycle is a structural error", function () {
  const m = manifest({ classes: [
    { title: "A", order: 1, terminal: ["a"], prerequisites: ["b"] },
    { title: "B", order: 2, terminal: ["b"], prerequisites: ["a"] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.strictEqual(r.ok, false);
  assert.ok(codes(r).indexOf("prerequisite_cycle") >= 0);
});

group("Redundancy");
test("the same terminal objective in two classes is a warning, not an error", function () {
  const m = manifest({ program_outcome: "teach photosynthesis", classes: [
    { title: "One", terminal: ["Explain photosynthesis"], prerequisites: [] },
    { title: "Two", terminal: ["Explain photosynthesis"], prerequisites: [] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.ok(codes(r).indexOf("duplicate_objective") >= 0);
  assert.strictEqual(r.summary.errors, 0); // warnings never block
  assert.strictEqual(r.ok, true);
});

group("Outcome rollup");
test("a missing program outcome is a warning", function () {
  const m = manifest({ program_outcome: "", classes: [
    { title: "One", terminal: ["Explain x"], prerequisites: [] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.ok(codes(r).indexOf("no_program_outcome") >= 0);
  assert.strictEqual(r.ok, true);
});
test("a program outcome whose concepts aren't covered is flagged", function () {
  const m = manifest({ program_outcome: "Master quantum entanglement and superposition", classes: [
    { title: "Cooking", terminal: ["Explain braising techniques"], prerequisites: [] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.ok(codes(r).indexOf("weak_outcome_coverage") >= 0);
});
test("a covered program outcome is NOT flagged", function () {
  const m = manifest({ program_outcome: "Explain braising techniques", classes: [
    { title: "Braising", terminal: ["Explain braising techniques"], prerequisites: [] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.ok(codes(r).indexOf("weak_outcome_coverage") < 0);
});

group("Edge cases");
test("an empty curriculum reports empty_curriculum error", function () {
  const r = H.analyzeCoherence({ classes: [] });
  assert.strictEqual(r.ok, false);
  assert.ok(codes(r).indexOf("empty_curriculum") >= 0);
});
test("a single self-contained class is coherent", function () {
  const m = manifest({ program_outcome: "Explain one thing", classes: [
    { title: "One", terminal: ["Explain one thing"], prerequisites: [] }
  ] });
  const r = H.analyzeCoherence(m);
  assert.strictEqual(r.ok, true);
});

console.log("\n" + "=".repeat(60));
console.log("CURRICULUM-COHERENCE RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
