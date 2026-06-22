/* eslint-disable no-console */
// test/curriculum.test.js — curriculum planner engine (api/curriculum.js). Deterministic.
const assert = require("assert");
const C = require("../api/curriculum.js")._internal;

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

group("Prompt builder");
test("includes subject/audience and asks for strict JSON", function () {
  const m = C.buildCurriculumPrompt({ subject: "Texas War of Independence", audience: "high schoolers" });
  assert.strictEqual(m.length, 2);
  assert.ok(/JSON/.test(m[0].content));
  assert.ok(/classes/.test(m[0].content));
  assert.ok(/Texas War of Independence/.test(m[1].content));
  assert.ok(/high schoolers/.test(m[1].content));
});
test("honors an explicit class count", function () {
  const m = C.buildCurriculumPrompt({ subject: "X", count: 6 });
  assert.ok(/exactly 6 classes/.test(m[0].content));
});
test("without a count, asks the model to choose a sensible number", function () {
  const m = C.buildCurriculumPrompt({ subject: "X" });
  assert.ok(/sensible number/.test(m[0].content));
});

group("Parsing the LLM response");
test("parses fenced JSON", function () {
  const p = C.parsePlanFromLLM("```json\n{\"classes\":[{\"title\":\"Intro\"}]}\n```");
  assert.ok(p && Array.isArray(p.classes));
});
test("parses prose-wrapped JSON", function () {
  const p = C.parsePlanFromLLM("Sure! Here is the plan: {\"classes\":[]} — hope it helps");
  assert.ok(p && Array.isArray(p.classes));
});
test("returns null on garbage", function () {
  assert.strictEqual(C.parsePlanFromLLM("I can't do that"), null);
});

group("Normalization (tolerant of messy model output)");
test("coerces classes, assigns order, clamps minutes, keeps objectives as string arrays", function () {
  const raw = { level: "intro", notes: "an arc", classes: [
    { title: "  Causes of the War ", summary: "why it happened", terminal: ["Explain the causes"], enabling: ["List grievances", "Identify actors"], suggested_minutes: 999 },
    { name: "Key Battles", objectives: { terminal: ["Sequence the battles"], enabling: ["Name commanders"] } }
  ] };
  const plan = C.normalizePlan(raw, { subject: "Texas War", audience: "teens" });
  assert.strictEqual(plan.classes.length, 2);
  assert.strictEqual(plan.classes[0].order, 1);
  assert.strictEqual(plan.classes[1].order, 2);
  assert.strictEqual(plan.classes[0].title, "Causes of the War"); // trimmed
  assert.ok(plan.classes[0].suggested_minutes <= 240); // clamped
  assert.deepStrictEqual(plan.classes[1].objectives.terminal, ["Sequence the battles"]); // via objectives.terminal
  assert.strictEqual(plan.subject, "Texas War");
});
test("drops classes with no title", function () {
  const plan = C.normalizePlan({ classes: [{ summary: "no title here" }, { title: "Real" }] }, {});
  assert.strictEqual(plan.classes.length, 1);
  assert.strictEqual(plan.classes[0].title, "Real");
});
test("handles a null/garbage parse without throwing", function () {
  const plan = C.normalizePlan(null, { subject: "X" });
  assert.strictEqual(plan.classes.length, 0);
  assert.strictEqual(plan.subject, "X");
});

group("Validation");
test("a plan with no classes is invalid", function () {
  const v = C.validatePlan(C.emptyPlan({ subject: "X" }));
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some(function (e) { return /no classes/.test(e); }));
});
test("a class with no terminal objective is flagged", function () {
  const plan = C.normalizePlan({ classes: [{ title: "Loose", enabling: ["a step"] }] }, {});
  const v = C.validatePlan(plan);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some(function (e) { return /no terminal objective/.test(e); }));
});
test("a well-formed plan validates", function () {
  const plan = C.normalizePlan({ classes: [{ title: "Good", terminal: ["Do the thing"], enabling: ["step"] }] }, {});
  assert.strictEqual(C.validatePlan(plan).ok, true);
});

group("Bridge to the existing pipeline (planToBriefs)");
test("each class becomes a partial brief with contract-shaped objectives", function () {
  const plan = C.normalizePlan({ classes: [
    { title: "Causes", terminal: ["Explain causes"], enabling: ["List grievances"], suggested_minutes: 50 }
  ] }, {});
  const briefs = C.planToBriefs(plan);
  assert.strictEqual(briefs.length, 1);
  const b = briefs[0].brief;
  assert.strictEqual(b.meta.title, "Causes");
  assert.deepStrictEqual(b.objectives.terminal, ["Explain causes"]);
  assert.deepStrictEqual(b.objectives.enabling, ["List grievances"]);
  assert.deepStrictEqual(b.objectives.out_of_scope, []); // contract requires the key
  assert.strictEqual(b.length.minutes, 50);
  assert.strictEqual(briefs[0].order, 1);
});
test("planToBriefs on an empty plan yields no briefs", function () {
  assert.deepStrictEqual(C.planToBriefs(C.emptyPlan({})), []);
});

console.log("\n" + "=".repeat(60));
console.log("CURRICULUM-PLANNER RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
