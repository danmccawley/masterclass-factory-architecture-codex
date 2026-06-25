/* eslint-disable no-console */
// test/curriculum-build.test.js — fan-out orchestration (api/curriculum-build.js). Deterministic.
const assert = require("assert");
const B = require("../api/curriculum-build.js")._internal;
const S = require("../api/curriculum-store.js")._internal;

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

function setStatus(m, slug, status) { return S.setClassStatus(m, slug, status); }

group("buildOrder (dependency-respecting)");
test("prerequisites are ordered before dependents even against array order", function () {
  // Declared so that the dependent appears first by order, but depends on a later class.
  const m = S.makeManifest({ classes: [
    { title: "Advanced", order: 1, terminal: ["adv"], prerequisites: ["foundations"] },
    { title: "Foundations", order: 2, terminal: ["found"], prerequisites: [] }
  ] });
  const order = B.buildOrder(m);
  assert.ok(order.indexOf("foundations") < order.indexOf("advanced"));
});
test("independent classes keep their order", function () {
  const m = S.makeManifest({ classes: [
    { title: "One", order: 1, terminal: ["a"], prerequisites: [] },
    { title: "Two", order: 2, terminal: ["b"], prerequisites: [] },
    { title: "Three", order: 3, terminal: ["c"], prerequisites: [] }
  ] });
  assert.deepStrictEqual(B.buildOrder(m), ["one", "two", "three"]);
});
test("a cycle still yields a complete order (no dead-end, no throw)", function () {
  const m = S.makeManifest({ classes: [
    { title: "A", order: 1, terminal: ["a"], prerequisites: ["b"] },
    { title: "B", order: 2, terminal: ["b"], prerequisites: ["a"] }
  ] });
  const order = B.buildOrder(m);
  assert.strictEqual(order.length, 2);
  assert.ok(order.indexOf("a") >= 0 && order.indexOf("b") >= 0);
});

group("nextBuildable");
test("returns the first planned class with all prerequisites built", function () {
  let m = S.makeManifest({ classes: [
    { title: "Foundations", order: 1, terminal: ["f"], prerequisites: [] },
    { title: "Advanced", order: 2, terminal: ["a"], prerequisites: ["foundations"] }
  ] });
  assert.strictEqual(B.nextBuildable(m), "foundations");
  m = setStatus(m, "foundations", "built");
  assert.strictEqual(B.nextBuildable(m), "advanced");
});
test("skips a class whose prerequisite isn't built yet (returns null if it's the only option)", function () {
  let m = S.makeManifest({ classes: [
    { title: "Foundations", order: 1, terminal: ["f"], prerequisites: [] },
    { title: "Advanced", order: 2, terminal: ["a"], prerequisites: ["foundations"] }
  ] });
  m = setStatus(m, "foundations", "building"); // not built yet
  // foundations is no longer planned/failed; advanced is blocked -> nothing buildable
  assert.strictEqual(B.nextBuildable(m), null);
});
test("returns null when every class is built", function () {
  let m = S.makeManifest({ classes: [
    { title: "One", order: 1, terminal: ["a"], prerequisites: [] },
    { title: "Two", order: 2, terminal: ["b"], prerequisites: [] }
  ] });
  m = setStatus(m, "one", "built");
  m = setStatus(m, "two", "built");
  assert.strictEqual(B.nextBuildable(m), null);
});
test("a failed class is buildable again (retry)", function () {
  let m = S.makeManifest({ classes: [
    { title: "One", order: 1, terminal: ["a"], prerequisites: [] }
  ] });
  m = setStatus(m, "one", "failed");
  assert.strictEqual(B.nextBuildable(m), "one");
});
test("a dependent stays blocked while its prerequisite is failed", function () {
  let m = S.makeManifest({ classes: [
    { title: "Foundations", order: 1, terminal: ["f"], prerequisites: [] },
    { title: "Advanced", order: 2, terminal: ["a"], prerequisites: ["foundations"] }
  ] });
  m = setStatus(m, "foundations", "failed");
  // foundations (failed) is itself buildable first; it's returned before advanced
  assert.strictEqual(B.nextBuildable(m), "foundations");
});

group("briefForClass (full brief synthesis)");
test("synthesizes a contract-valid brief from a class", function () {
  var BV = require("../brief-validator.js");
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject:"Org Chem", audience:"undergrads", level:"advanced", classes:[
    { title:"Topic One", terminal:["Explain one"], enabling:["Define a"], suggested_minutes:60 }
  ] });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(BV.validateBrief(brief, template).ok, true);
  assert.strictEqual(brief.meta.title, "Topic One");
  assert.deepStrictEqual(brief.objectives.terminal, ["Explain one"]);
  assert.strictEqual(brief.length.minutes, 60);
  assert.strictEqual(brief.class_tier.level, "professional"); // advanced -> professional
  assert.strictEqual(brief.audience.average.background, "undergrads");
  assert.strictEqual(brief.knowledge_base.research.owner, "ai"); // AI builds the KB as a first-class step
  assert.strictEqual(brief.knowledge_base.research.allow_web, true);
});
test("applies shared setup (tier, KB ownership, demographics) and stays contract-valid", function () {
  var BV = require("../brief-validator.js");
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject: "Org Chem", audience: "undergrads", level: "introductory", classes: [
    { title: "Topic One", terminal: ["Explain one"], enabling: ["Define a"], suggested_minutes: 60 }
  ] });
  m.setup = S.normalizeSetup({
    tier: "professional",
    research_owner: "assisted",
    audience: { education: "graduate", technical: "technical", role: "research chemists", tone: "academic", reading_grade_cap: 14 }
  });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(BV.validateBrief(brief, template).ok, true);
  assert.strictEqual(brief.class_tier.level, "professional");           // shared tier wins over level mapping
  assert.strictEqual(brief.knowledge_base.research.owner, "assisted");  // human+AI ownership
  assert.strictEqual(brief.audience.average.technical, "technical");
  assert.strictEqual(brief.audience.average.role, "research chemists");
  assert.strictEqual(brief.audience.tone, "academic");
  assert.strictEqual(brief.audience.accessibility.reading_grade_cap, 14);
});
test("creator ownership seeds the human sources and turns off auto web research", function () {
  var BV = require("../brief-validator.js");
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ research_owner: "creator", sources: [{ url: "https://a.org/1", title: "One" }, { url: "https://a.org/2" }] });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(BV.validateBrief(brief, template).ok, true);
  assert.strictEqual(brief.knowledge_base.research.owner, "creator");
  assert.strictEqual(brief.knowledge_base.research.allow_web, false);   // build only on provided sources
  assert.strictEqual(brief.knowledge_base.uploads.length, 2);
  assert.strictEqual(brief.knowledge_base.uploads[0].path, "https://a.org/1");
});
test("assisted ownership seeds sources but keeps web research on", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ research_owner: "assisted", sources: [{ url: "https://a.org/1" }] });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.knowledge_base.research.owner, "assisted");
  assert.strictEqual(brief.knowledge_base.research.allow_web, true);
  assert.strictEqual(brief.knowledge_base.uploads.length, 1);
});
test("returns null for an unknown class slug", function () {
  var m = S.makeManifest({ classes:[ { title:"A", terminal:["x"] } ] });
  assert.strictEqual(B.briefForClass(m, "nope"), null);
});

console.log("\n" + "=".repeat(60));
console.log("CURRICULUM-BUILD RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
