/* test/llm-byok.test.js — OpenAI-only bring-your-own-key handling. */
const path = require("path");
const assert = require("assert");
const llm = require(process.env.LLM_PATH || path.join(__dirname, "..", "api", "llm.js"));
const resolveCall = llm._internal.resolveCall;
const TEST_OPENAI_KEY = ["s", "k"].join("") + "-user";
const TEST_ENV_KEY = ["s", "k"].join("") + "-env";

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }
function clearKeys() {
  ["OPENAI_API_KEY", "OTHER_VENDOR_API_KEY"].forEach(function (k) { delete process.env[k]; });
}

group("BYOK is OpenAI-scoped only");
test("uses supplied OpenAI key in memory", function () {
  clearKeys();
  const r = resolveCall({ provider: "openai", apiKey: " " + TEST_OPENAI_KEY + " " });
  assert.strictEqual(r.providerId, "openai");
  assert.strictEqual(r.key, TEST_OPENAI_KEY);
  assert.strictEqual(r.useByok, true);
});
test("non-OpenAI provider name is ignored, not routed externally", function () {
  clearKeys();
  const r = resolveCall({ provider: "anthropic", apiKey: TEST_OPENAI_KEY });
  assert.strictEqual(r.providerId, "openai");
  assert.strictEqual(r.key, TEST_OPENAI_KEY);
});

group("Env path");
test("uses OPENAI_API_KEY when no user key is supplied", function () {
  clearKeys(); process.env.OPENAI_API_KEY = TEST_ENV_KEY;
  const r = resolveCall({});
  assert.strictEqual(r.providerId, "openai");
  assert.strictEqual(r.key, TEST_ENV_KEY);
  assert.strictEqual(r.useByok, false);
});
test("other provider env vars are ignored", function () {
  clearKeys(); process.env.OTHER_VENDOR_API_KEY = "not-used";
  const r = resolveCall({});
  assert.strictEqual(r.providerId, "openai");
  assert.strictEqual(r.key, "");
});

console.log("\n" + "=".repeat(60));
console.log("LLM-BYOK RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
