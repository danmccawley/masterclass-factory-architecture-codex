/* eslint-disable no-console */
// test/kb-objectives.test.js
// Per-objective saturation backbone (api/kb-objectives.js). Deterministic, no
// network. Tests identity, the weakest-gates-the-class rollup, corroboration by
// independent domain, structural-vs-closeable when rounds saturate, and that an
// injected mapper overrides the default proxy.

const assert = require("assert");
const O = require("../api/kb-objectives.js");

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

group("Objective identity");
test("id is stable across whitespace/case", function () {
  assert.strictEqual(O.objectiveId("Install single-mode fiber"), O.objectiveId("  install   SINGLE-mode fiber "));
});
test("different objectives get different ids", function () {
  assert.notStrictEqual(O.objectiveId("Terminate a connector"), O.objectiveId("Test an OTDR trace"));
});

group("Domain independence");
test("domain strips www and subdomains to eTLD+1-ish", function () {
  assert.strictEqual(O.domainOf("https://www.ieee.org/standards/x"), "ieee.org");
  assert.strictEqual(O.domainOf("https://docs.fiber.example.com/y"), "example.com");
});

group("Per-objective read + corroboration");
const objs = {
  terminal: ["Terminate and test a single-mode fiber connector"],
  enabling: ["Interpret an OTDR trace anomaly", "Select connector polish type"]
};
// Sources: two independent domains clearly about OTDR; one about connectors;
// nothing about polish type -> that objective is uncovered.
const sources = [
  { path: "https://viavi.com/otdr-trace-guide", title: "OTDR trace anomaly interpretation", trust: "primary" },
  { path: "https://exfo.com/otdr-basics", title: "Interpret OTDR trace events", trust: "secondary" },
  { path: "https://corning.com/single-mode-connector-termination", title: "single-mode fiber connector termination and test", trust: "primary" }
];
const sat = O.buildObjectiveSaturation(objs, sources, {});
function find(text) { return sat.objectives.find(function (r) { return r.text === text; }); }

test("OTDR objective is corroborated (2 independent domains)", function () {
  const r = find("Interpret an OTDR trace anomaly");
  assert.strictEqual(r.independent_domains, 2);
  assert.strictEqual(r.status, "corroborated");
});
test("connector objective is supported (single domain) -> thin", function () {
  const r = find("Terminate and test a single-mode fiber connector");
  assert.ok(r.supporting_sources >= 1);
  assert.strictEqual(r.status, "thin");
});
test("polish-type objective has no matching source -> uncovered", function () {
  const r = find("Select connector polish type");
  assert.strictEqual(r.status, "uncovered");
  assert.strictEqual(r.supporting_sources, 0);
});

group("Weakest objective gates the class");
test("rollup class_status = uncovered (the weakest), not an average", function () {
  assert.strictEqual(sat.rollup.class_status, "uncovered");
  assert.strictEqual(sat.rollup.gated_by.text, "Select connector polish type");
});
test("counts reflect the mix", function () {
  assert.strictEqual(sat.rollup.counts.total, 3);
  assert.strictEqual(sat.rollup.counts.corroborated, 1);
  assert.strictEqual(sat.rollup.counts.uncovered, 1);
});

group("Structural vs closeable under saturation");
test("uncovered objective is CLOSEABLE while rounds still finding", function () {
  const s = O.buildObjectiveSaturation(objs, sources, { saturated: false });
  assert.strictEqual(find2(s, "Select connector polish type").gap_kind, "closeable");
});
test("uncovered objective becomes STRUCTURAL once rounds saturate", function () {
  const s = O.buildObjectiveSaturation(objs, sources, { saturated: true });
  assert.strictEqual(find2(s, "Select connector polish type").gap_kind, "structural");
});
function find2(s, text) { return s.objectives.find(function (r) { return r.text === text; }); }

group("Injected mapper overrides the proxy");
test("a custom mapper changes coverage and mapper_kind", function () {
  const everything = function () { return 1; }; // every source maps to every objective
  const s = O.buildObjectiveSaturation(objs, sources, { mapper: everything });
  assert.strictEqual(s.mapper_kind, "injected");
  // polish-type now 'supported' by all 3 sources across 3 domains -> corroborated
  assert.strictEqual(find2(s, "Select connector polish type").status, "corroborated");
});
test("default proxy is labeled as a proxy in the caveat", function () {
  assert.ok(/PROXY/.test(sat.caveat));
  assert.strictEqual(sat.mapper_kind, "keyword-overlap-proxy");
});

console.log("\n" + "=".repeat(60));
console.log("OBJECTIVE-SATURATION RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
