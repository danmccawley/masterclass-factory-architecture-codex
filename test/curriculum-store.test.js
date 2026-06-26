/* eslint-disable no-console */
// test/curriculum-store.test.js — curriculum storage manifest (api/curriculum-store.js). Deterministic.
const assert = require("assert");
const S = require("../api/curriculum-store.js")._internal;

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

function sampleClass(over) {
  return Object.assign({ title: "Intro", terminal: ["Explain X"], enabling: ["List Y"], suggested_minutes: 50 }, over || {});
}

group("Slugify");
test("lowercases, dashes, strips quotes/traversal", function () {
  assert.strictEqual(S.slugify("The Texas War of Independence"), "the-texas-war-of-independence");
  assert.strictEqual(S.slugify("../../etc/passwd"), "etc-passwd");
});
test("empty input yields a fallback slug", function () {
  assert.strictEqual(S.slugify(""), "curriculum");
});

group("Manifest construction + normalization");
test("makeManifest builds a v1 manifest with slug, timestamps, shared core", function () {
  const m = S.makeManifest({ subject: "Organic Chemistry", audience: "undergrads", classes: [sampleClass()] });
  assert.strictEqual(m.schema, "curriculum/v1");
  assert.ok(m.slug);
  assert.strictEqual(m.subject, "Organic Chemistry");
  assert.ok(typeof m.created === "string" && typeof m.updated === "string");
  assert.strictEqual(m.knowledge_core.shared, true);
  assert.strictEqual(m.knowledge_core.sealed, false);
});
test("normalizes classes: dedups slugs, re-sequences order, clamps minutes", function () {
  const m = S.makeManifest({ title: "T", classes: [
    sampleClass({ title: "Same", order: 5, suggested_minutes: 9999 }),
    sampleClass({ title: "Same", order: 2 })
  ] });
  assert.strictEqual(m.classes.length, 2);
  // order re-sequenced 1..N after sorting by original order
  assert.deepStrictEqual(m.classes.map(c => c.order), [1, 2]);
  // slugs de-duplicated
  assert.notStrictEqual(m.classes[0].slug, m.classes[1].slug);
  // minutes clamped to <= 240
  assert.ok(m.classes.every(c => c.suggested_minutes <= 240));
});
test("default status is planned and class carries prerequisite/assessment fields", function () {
  const m = S.makeManifest({ classes: [sampleClass()] });
  assert.strictEqual(m.classes[0].status, "planned");
  assert.ok(Array.isArray(m.classes[0].prerequisites));
  assert.strictEqual(typeof m.classes[0].assessment, "string");
});

group("Validation (structural)");
test("a manifest with no classes is invalid", function () {
  const r = S.validateManifest(S.makeManifest({ subject: "X", classes: [] }));
  assert.strictEqual(r.ok, false);
});
test("a class with no terminal objective is flagged", function () {
  const m = S.makeManifest({ classes: [sampleClass({ terminal: [] })] });
  const r = S.validateManifest(m);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /terminal objective/.test(e)));
});
test("a class with no title is flagged", function () {
  const m = S.makeManifest({ classes: [sampleClass({ title: "" })] });
  const r = S.validateManifest(m);
  assert.strictEqual(r.ok, false);
});
test("a well-formed manifest validates", function () {
  const m = S.makeManifest({ subject: "X", classes: [sampleClass(), sampleClass({ title: "Two" })] });
  assert.strictEqual(S.validateManifest(m).ok, true);
});

group("Job state: setClassStatus");
test("updates a class status and bumps updated, without mutating the original", function () {
  const m = S.makeManifest({ classes: [sampleClass()] });
  const slug = m.classes[0].slug;
  const next = S.setClassStatus(m, slug, "built", { class_url: "https://x/classes/intro/" });
  assert.strictEqual(next.classes[0].status, "built");
  assert.strictEqual(next.classes[0].class_url, "https://x/classes/intro/");
  assert.strictEqual(m.classes[0].status, "planned"); // original untouched
});
test("rejects an invalid status", function () {
  const m = S.makeManifest({ classes: [sampleClass()] });
  assert.throws(function () { S.setClassStatus(m, m.classes[0].slug, "exploded"); });
});
test("rejects an unknown class slug", function () {
  const m = S.makeManifest({ classes: [sampleClass()] });
  assert.throws(function () { S.setClassStatus(m, "nope", "built"); });
});

group("Build progress");
test("counts statuses and reports done only when all built", function () {
  let m = S.makeManifest({ classes: [sampleClass(), sampleClass({ title: "Two" })] });
  assert.strictEqual(S.buildProgress(m).done, false);
  m = S.setClassStatus(m, m.classes[0].slug, "built");
  m = S.setClassStatus(m, m.classes[1].slug, "built");
  const p = S.buildProgress(m);
  assert.strictEqual(p.built, 2);
  assert.strictEqual(p.done, true);
});

group("Bridges");
test("planToManifest turns a planner plan into a manifest", function () {
  const plan = { level: "introductory", notes: "the arc", classes: [
    { title: "Causes", summary: "s", terminal: ["Explain causes"], enabling: ["List grievances"], suggested_minutes: 50 }
  ] };
  const m = S.planToManifest(plan, { subject: "Texas War", audience: "HS" });
  assert.strictEqual(m.schema, "curriculum/v1");
  assert.strictEqual(m.program_outcome, "the arc");
  assert.strictEqual(m.classes[0].title, "Causes");
});
test("manifestToBriefs yields contract-shaped partial briefs with curriculumId", function () {
  const m = S.makeManifest({ subject: "X", classes: [sampleClass({ title: "Causes", terminal: ["Explain causes"], enabling: ["List grievances"], suggested_minutes: 50 })] });
  const briefs = S.manifestToBriefs(m);
  assert.strictEqual(briefs.length, 1);
  const b = briefs[0].brief;
  assert.strictEqual(b.meta.title, "Causes");
  assert.deepStrictEqual(b.objectives.terminal, ["Explain causes"]);
  assert.deepStrictEqual(b.objectives.out_of_scope, []);
  assert.strictEqual(b.length.minutes, 50);
  assert.strictEqual(briefs[0].order, 1);
  assert.strictEqual(briefs[0].curriculumId, m.slug);
});

group("normalizeSetup (shared curriculum setup)");
test("clamps to contract enums and survives a manifest round-trip", function () {
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"] }] });
  m.setup = S.normalizeSetup({ tier: "EXPERT", research_owner: "assisted", audience: { technical: "Technical", tone: "academic", reading_grade_cap: 99, role: "engineers" } });
  assert.strictEqual(m.setup.tier, "expert");
  assert.strictEqual(m.setup.research_owner, "assisted");
  assert.strictEqual(m.setup.audience.average.technical, "technical");
  assert.strictEqual(m.setup.audience.reading_grade_cap, 16); // clamped to max
  var round = S.normalizeManifest(JSON.parse(JSON.stringify(m)));
  assert.deepStrictEqual(round.setup, m.setup);
});
test("invalid values fall back to safe defaults", function () {
  var s = S.normalizeSetup({ tier: "nonsense", research_owner: "nobody", audience: { technical: "?", tone: "?" } });
  assert.strictEqual(s.tier, "standard");
  assert.strictEqual(s.research_owner, "ai");
  assert.strictEqual(s.audience.average.technical, "mixed");
  assert.strictEqual(s.audience.tone, "plain");
});
test("absent setup yields null (manifest stays setup-free)", function () {
  assert.strictEqual(S.normalizeSetup(undefined), null);
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"] }] });
  assert.ok(!("setup" in m));
});
test("setup carries human-entered seed sources, normalized + round-tripped", function () {
  var s = S.normalizeSetup({ research_owner: "creator", sources: [
    { url: "https://nist.gov/x", title: "NIST X" },
    { url: "https://nist.gov/x" },           // dup collapses
    { title: "no url" }                        // dropped
  ] });
  assert.strictEqual(s.sources.length, 1);
  assert.strictEqual(s.sources[0].path, "https://nist.gov/x");
  var m = S.makeManifest({ subject: "X", classes: [{ title: "A", terminal: ["t"] }] });
  m.setup = s;
  var round = S.normalizeManifest(JSON.parse(JSON.stringify(m)));
  assert.deepStrictEqual(round.setup.sources, s.sources);
});

console.log("\n" + "=".repeat(60));
console.log("CURRICULUM-STORE RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
