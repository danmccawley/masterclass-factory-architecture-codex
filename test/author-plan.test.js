"use strict";
// Runs the REAL helpers exported from api/generate.js (never mirrors).
const assert = require("assert");
const { planAuthorBatches, fastAuthorModels } = require("../api/generate.js")._internal;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass += 1; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail += 1; }
}

test("splits 40 slides @12 into 4 batches", function () {
  assert.strictEqual(planAuthorBatches(40, 12, []).length, 4);
});
test("batches tile the full range with no gap or overlap", function () {
  const specs = planAuthorBatches(40, 12, []);
  assert.strictEqual(specs[0].fromIndex, 1);
  let expect = 1;
  specs.forEach((s) => { assert.strictEqual(s.fromIndex, expect); expect = s.toIndex + 1; });
  assert.strictEqual(expect, 41); // covered exactly 1..40
});
test("lesson sections are fully distributed, no duplication", function () {
  const sections = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const specs = planAuthorBatches(40, 12, sections);
  const union = [].concat.apply([], specs.map((s) => s.sections));
  assert.strictEqual(union.length, 8);
  assert.strictEqual(new Set(union).size, 8);
});
test("0 slides yields no batches", function () {
  assert.strictEqual(planAuthorBatches(0, 12, []).length, 0);
});
test("fewer sections than batches still tiles all slides", function () {
  const specs = planAuthorBatches(40, 12, ["x", "y"]);
  assert.strictEqual(specs[specs.length - 1].toIndex, 40);
});
test("one batch when batch size >= slide count", function () {
  assert.strictEqual(planAuthorBatches(10, 12, ["a"]).length, 1);
});
test("fast author ladder puts the fast model first, keeps full model as fallback", function () {
  const fm = fastAuthorModels();
  assert.strictEqual(fm[0], "gpt-4.1-mini");
  assert.ok(fm.indexOf("gpt-5.5") > 0, "full model retained as fallback");
});

console.log("\n============================================================");
console.log("AUTHOR-PLAN RESULTS: " + pass + " passed, " + fail + " failed");
console.log(fail === 0 ? "ALL GREEN" : "SOME FAILED");
process.exit(fail === 0 ? 0 : 1);
