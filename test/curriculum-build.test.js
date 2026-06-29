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

group("readyBuildable (parallel-build superset of nextBuildable)");
test("readyBuildable[0] always equals nextBuildable (invariant)", function () {
  // diamond: foundations -> (a, b) -> capstone
  let m = S.makeManifest({ classes: [
    { title: "Foundations", order: 1, terminal: ["f"], prerequisites: [] },
    { title: "Track A", order: 2, terminal: ["a"], prerequisites: ["foundations"] },
    { title: "Track B", order: 3, terminal: ["b"], prerequisites: ["foundations"] },
    { title: "Capstone", order: 4, terminal: ["c"], prerequisites: ["track-a", "track-b"] }
  ] });
  // walk the whole build, asserting the invariant at each step
  for (let guard = 0; guard < 20; guard++) {
    const ready = B.readyBuildable(m);
    const next = B.nextBuildable(m);
    if (next === null) { assert.strictEqual(ready.length, 0); break; }
    assert.strictEqual(ready[0], next);
    m = setStatus(m, next, "built");
  }
});
test("multiple independent roots are all ready at once, in order", function () {
  const m = S.makeManifest({ classes: [
    { title: "One", order: 1, terminal: ["a"], prerequisites: [] },
    { title: "Two", order: 2, terminal: ["b"], prerequisites: [] },
    { title: "Three", order: 3, terminal: ["c"], prerequisites: [] }
  ] });
  assert.deepStrictEqual(B.readyBuildable(m), ["one", "two", "three"]);
});
test("a diamond exposes both middle tracks together once the root is built", function () {
  let m = S.makeManifest({ classes: [
    { title: "Foundations", order: 1, terminal: ["f"], prerequisites: [] },
    { title: "Track A", order: 2, terminal: ["a"], prerequisites: ["foundations"] },
    { title: "Track B", order: 3, terminal: ["b"], prerequisites: ["foundations"] },
    { title: "Capstone", order: 4, terminal: ["c"], prerequisites: ["track-a", "track-b"] }
  ] });
  assert.deepStrictEqual(B.readyBuildable(m), ["foundations"]); // only the root at first
  m = setStatus(m, "foundations", "built");
  assert.deepStrictEqual(B.readyBuildable(m), ["track-a", "track-b"]); // both middles now parallel
  assert.strictEqual(B.readyBuildable(m).indexOf("capstone"), -1);     // capstone still blocked
  m = setStatus(m, "track-a", "built");
  assert.deepStrictEqual(B.readyBuildable(m), ["track-b"]);            // capstone still needs track-b
  m = setStatus(m, "track-b", "built");
  assert.deepStrictEqual(B.readyBuildable(m), ["capstone"]);
});
test("a class in flight (building) does not appear as ready", function () {
  let m = S.makeManifest({ classes: [
    { title: "One", order: 1, terminal: ["a"], prerequisites: [] },
    { title: "Two", order: 2, terminal: ["b"], prerequisites: [] }
  ] });
  m = setStatus(m, "one", "building"); // a worker already owns it
  assert.deepStrictEqual(B.readyBuildable(m), ["two"]); // only the un-started one is offered
});
test("empty when everything is built (matches nextBuildable === null)", function () {
  let m = S.makeManifest({ classes: [
    { title: "One", order: 1, terminal: ["a"], prerequisites: [] },
    { title: "Two", order: 2, terminal: ["b"], prerequisites: [] }
  ] });
  m = setStatus(m, "one", "built");
  m = setStatus(m, "two", "built");
  assert.deepStrictEqual(B.readyBuildable(m), []);
  assert.strictEqual(B.nextBuildable(m), null);
});
test("failed classes are offered again (retry) alongside other ready ones", function () {
  let m = S.makeManifest({ classes: [
    { title: "One", order: 1, terminal: ["a"], prerequisites: [] },
    { title: "Two", order: 2, terminal: ["b"], prerequisites: [] }
  ] });
  m = setStatus(m, "one", "failed");
  assert.deepStrictEqual(B.readyBuildable(m), ["one", "two"]);
});
test("a cycle never appears as ready (blocked, surfaced to the human — no dead-end loop)", function () {
  const m = S.makeManifest({ classes: [
    { title: "A", order: 1, terminal: ["a"], prerequisites: ["b"] },
    { title: "B", order: 2, terminal: ["b"], prerequisites: ["a"] }
  ] });
  // neither can be built (each needs the other); readyBuildable is empty
  assert.deepStrictEqual(B.readyBuildable(m), []);
  assert.strictEqual(B.nextBuildable(m), null);
});
test("empty manifest yields an empty ready list", function () {
  const m = S.makeManifest({ classes: [] });
  assert.deepStrictEqual(B.readyBuildable(m), []);
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
test("applies shared mastery setup to each class brief (parity with single-class creator)", function () {
  var BV = require("../brief-validator.js");
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ mastery: { target_level: 5, granularity: "deep", deep_dive_density: "low", field_disagreement: false } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(BV.validateBrief(brief, template).ok, true);
  assert.strictEqual(brief.mastery.target_level, 5);
  assert.strictEqual(brief.mastery.granularity, "deep");
  assert.strictEqual(brief.mastery.deep_dive_density, "low");
  assert.strictEqual(brief.mastery.field_disagreement, false);
});
test("mastery setup is whitelisted and clamped (garbage falls back to safe defaults)", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ mastery: { target_level: 99, granularity: "nonsense", deep_dive_density: "" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.mastery.target_level, 5);          // 99 clamped to 5
  assert.strictEqual(brief.mastery.granularity, "working");   // invalid -> default
  assert.strictEqual(brief.mastery.deep_dive_density, "high");// invalid -> default
});
test("absent mastery setup leaves the template mastery defaults intact", function () {
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  // a setup pass with no mastery key still normalizes to template-matching defaults
  m.setup = S.normalizeSetup({ tier: "standard" });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.mastery.target_level, template.mastery.target_level);
  assert.strictEqual(brief.mastery.granularity, template.mastery.granularity);
});
test("shared language: English delivery keeps the class in English (parity with single-class)", function () {
  var BV = require("../brief-validator.js");
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ language: { student_language: "en", delivery: "english" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(BV.validateBrief(brief, template).ok, true);
  assert.strictEqual(brief.language.primary, "en");
  assert.strictEqual(brief.language.localize_ui_strings, false);
});
test("shared language: translated renders the class in the student locale", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ language: { student_language: "es", delivery: "translated", glossary_in_primary: false } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.language.primary, "es");
  assert.strictEqual(brief.language.localize_ui_strings, true);
  assert.strictEqual(brief.language.glossary_in_primary, false);
});
test("shared language: split-screen yields en+locale", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ language: { student_language: "ja", delivery: "split" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.language.primary, "en+ja");
  assert.strictEqual(brief.language.localize_ui_strings, true);
});
test("shared language: a non-English locale with English delivery still stays English", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ language: { student_language: "fr", delivery: "english" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.language.primary, "en");
});
test("shared language: garbage locale/delivery fall back to safe English defaults", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ language: { student_language: "klingon", delivery: "interpretive-dance" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.language.primary, "en");
  assert.strictEqual(brief.language.localize_ui_strings, false);
});
test("shared demographics: typical + floor learner + gender mix all flow into the brief", function () {
  var BV = require("../brief-validator.js");
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ audience: {
    average: { age_band: "35-54", education: "graduate", background: "managers", technical: "technical", role: "director" },
    floor:   { age_band: "18+", education: "high school", background: "no prior knowledge", technical: "non", role: "general" },
    gender_mix: "balanced"
  } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(BV.validateBrief(brief, template).ok, true);
  assert.strictEqual(brief.audience.average.age_band, "35-54");
  assert.strictEqual(brief.audience.average.background, "managers");
  assert.strictEqual(brief.audience.floor.education, "high school");
  assert.strictEqual(brief.audience.floor.technical, "non");
  assert.strictEqual(brief.audience.gender_mix, "balanced");
});
test("shared demographics: a flat (legacy) audience still maps to the typical learner", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ audience: { education: "graduate", technical: "technical", role: "chemists" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.audience.average.education, "graduate");
  assert.strictEqual(brief.audience.average.role, "chemists");
});
test("shared KB policy: mode, recency, min-tier, seed prompts flow into the brief", function () {
  var BV = require("../brief-validator.js");
  var template = require("../brief.template.json");
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ research_owner: "assisted", kb: { mode: "grounded", recency_floor: "2025-06-01", min_tier: "primary", seed_prompts: "find the standard\nfind the report" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(BV.validateBrief(brief, template).ok, true);
  assert.strictEqual(brief.knowledge_base.research.mode, "grounded");
  assert.strictEqual(brief.knowledge_base.research.recency_floor, "2025-06-01");
  assert.deepStrictEqual(brief.knowledge_base.research.seed_prompts, ["find the standard", "find the report"]);
  assert.strictEqual(brief.knowledge_base.credibility.min_tier, "primary");
});
test("shared KB policy: creator ownership forces evidence boundary to 'none'", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 45 }] });
  m.setup = S.normalizeSetup({ research_owner: "creator", kb: { mode: "collaborative" } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.knowledge_base.research.mode, "none");      // owner is the master switch
  assert.strictEqual(brief.knowledge_base.research.allow_web, false);
});
test("shared length: slide density scales the per-class slide budget", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 40 }] });
  m.setup = S.normalizeSetup({ length: { slides_per_minute: 2, interaction_budget: { polls: 5, final_test: false } } });
  var brief = B.briefForClass(m, m.classes[0].slug);
  // Default tier is standard (floor 40, band [40, 60]). 40 min * 2 = 80, clamped
  // to the standard ceiling 60 — density scales within the band, runaway bounded.
  assert.strictEqual(brief.length.slide_budget, 60);
  assert.strictEqual(brief.length.interaction_budget.polls, 5);
  assert.strictEqual(brief.length.interaction_budget.final_test, false);
});
test("length density is CLAMPED to the tier band (no runaway count)", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 60 }] });
  m.setup = S.normalizeSetup({ tier: "standard" }); // standard floor 40 -> band [40, 60]
  var brief = B.briefForClass(m, m.classes[0].slug);
  // 60 min * 1.5 = 90, clamped to the standard ceiling (40 + 20) so a long class
  // can't derive a runaway deck (B3/B7).
  assert.strictEqual(brief.length.slide_budget, 60);
});
test("length clamp floors a too-small derived count up to the tier floor", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"], enabling: ["e"], suggested_minutes: 10 }] });
  m.setup = S.normalizeSetup({ tier: "professional", length: { slides_per_minute: 1 } }); // 10*1=10 < floor 60
  var brief = B.briefForClass(m, m.classes[0].slug);
  assert.strictEqual(brief.length.slide_budget, 60);                   // floored up to the professional floor
});

console.log("\n" + "=".repeat(60));
console.log("CURRICULUM-BUILD RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
