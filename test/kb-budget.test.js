/* eslint-disable no-console */
// test/kb-budget.test.js — budget governor (api/kb-budget.js). Deterministic.
const assert = require("assert");
const B = require("../api/kb-budget.js");

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

group("Usage extraction (both OpenAI API shapes)");
test("responses API shape (input_tokens/output_tokens)", function () {
  const u = B.readOpenAIUsage({ usage: { input_tokens: 1000, output_tokens: 250, total_tokens: 1250 } });
  assert.strictEqual(u.input_tokens, 1000);
  assert.strictEqual(u.output_tokens, 250);
  assert.strictEqual(u.total_tokens, 1250);
});
test("chat completions shape (prompt_tokens/completion_tokens)", function () {
  const u = B.readOpenAIUsage({ usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 } });
  assert.strictEqual(u.input_tokens, 800);
  assert.strictEqual(u.output_tokens, 200);
  assert.strictEqual(u.total_tokens, 1000);
});
test("missing usage never throws -> zeros", function () {
  const u = B.readOpenAIUsage({});
  assert.strictEqual(u.total_tokens, 0);
  const u2 = B.readOpenAIUsage(null);
  assert.strictEqual(u2.total_tokens, 0);
});
test("total derived when absent", function () {
  const u = B.readOpenAIUsage({ usage: { prompt_tokens: 5, completion_tokens: 7 } });
  assert.strictEqual(u.total_tokens, 12);
});

group("Token cost math");
test("per-model pricing applies (gpt-4o-mini cheaper than gpt-4o)", function () {
  const mini = B.tokenCostUsd(1e6, 1e6, "gpt-4o-mini");
  const big = B.tokenCostUsd(1e6, 1e6, "gpt-4o");
  assert.ok(mini < big);
});
test("1M in + 1M out on gpt-4o-mini = $0.15 + $0.60 = $0.75", function () {
  assert.strictEqual(B.tokenCostUsd(1e6, 1e6, "gpt-4o-mini"), 0.75);
});
test("unknown model falls back to default pricing", function () {
  assert.strictEqual(B.tokenCostUsd(1e6, 0, "some-future-model"), 2.50);
});

group("Ledger");
test("records token op and tallies spend", function () {
  const L = B.createBudgetLedger(10);
  L.record({ kind: "authoring", model: "gpt-4o-mini", input_tokens: 1e6, output_tokens: 1e6 });
  assert.strictEqual(L.spent(), 0.75);
  assert.strictEqual(L.remaining(), 9.25);
});
test("records tavily searches at per-search price", function () {
  const L = B.createBudgetLedger(10);
  L.record({ kind: "tavily", searches: 10 });
  assert.strictEqual(L.spent(), 0.08);
});
test("summary reports budget/spent/remaining and an honest note", function () {
  const L = B.createBudgetLedger(5);
  L.record({ kind: "x", usd: 1.25 });
  const s = L.summary();
  assert.strictEqual(s.spent_usd, 1.25);
  assert.strictEqual(s.remaining_usd, 3.75);
  assert.ok(/measured token usage/.test(s.note));
});

group("Overage: NOTIFY, never refuse");
test("under budget -> no exceed, no options", function () {
  const L = B.createBudgetLedger(10);
  L.record({ kind: "x", usd: 2 });
  const c = B.checkOverage(L, 1, 1); // 2 + 1 + 1 = 4 <= 10
  assert.strictEqual(c.would_exceed, false);
  assert.strictEqual(c.options.length, 0);
});
test("over budget -> flags overage with a dollar figure and 3 options", function () {
  const L = B.createBudgetLedger(5);
  L.record({ kind: "x", usd: 4 });
  const c = B.checkOverage(L, 2, 1); // 4 + 2 + 1 = 7, over by 2
  assert.strictEqual(c.would_exceed, true);
  assert.strictEqual(c.estimated_overage_usd, 2);
  const ids = c.options.map(function (o) { return o.id; });
  assert.deepStrictEqual(ids, ["raise_budget", "spend_anyway", "stop"]);
  assert.ok(/over your \$5\.00 budget/.test(c.message));
});
test("the options are notify-style, never a refusal/block", function () {
  const L = B.createBudgetLedger(1);
  L.record({ kind: "x", usd: 2 });
  const c = B.checkOverage(L, 0, 0);
  // 'spend_anyway' must exist; there must be NO option that hard-blocks.
  assert.ok(c.options.some(function (o) { return o.id === "spend_anyway"; }));
});
test("budget of 0 (unset) NEVER flags overage (no governor friction)", function () {
  const L = B.createBudgetLedger(0);
  L.record({ kind: "x", usd: 999 });
  const c = B.checkOverage(L, 999, 999);
  assert.strictEqual(c.would_exceed, false);
});

group("Forecasting upcoming work");
test("estimate a discovery round (tavily-first)", function () {
  assert.ok(B.estimateOperationUsd("discovery_round", 1) > 0);
});
test("claim extraction scales per source", function () {
  const one = B.estimateOperationUsd("claim_extraction_per_source", 1);
  const ten = B.estimateOperationUsd("claim_extraction_per_source", 10);
  assert.ok(Math.abs(ten - one * 10) < 1e-6);
});

console.log("\n" + "=".repeat(60));
console.log("BUDGET-GOVERNOR RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
