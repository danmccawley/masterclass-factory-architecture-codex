/* eslint-disable no-console */
// test/llm-byok.test.js — bring-your-own-key provider/key resolution
// (api/llm.js resolveCall). Deterministic; manipulates process.env like
// the existing llm.test.js. No network.
const path = require("path");
const llm = require(process.env.LLM_PATH || path.join(__dirname, "..", "api", "llm.js"));
const resolveCall = llm._internal.resolveCall;

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }
const assert = require("assert");

function clearKeys() {
  ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY", "GROK_API_KEY"]
    .forEach(function (k) { delete process.env[k]; });
}

group("BYOK honored for an explicit, known provider");
test("uses the supplied key + chosen provider even with NO env key", function () {
  clearKeys();
  const r = resolveCall({ provider: "anthropic", apiKey: "ant-user-key" });
  assert.strictEqual(r.providerId, "anthropic");
  assert.strictEqual(r.key, "ant-user-key");
  assert.strictEqual(r.useByok, true);
});
test("trims whitespace around the supplied key", function () {
  clearKeys();
  const r = resolveCall({ provider: "openai", apiKey: "  sk-user  " });
  assert.strictEqual(r.key, "sk-user");
  assert.strictEqual(r.useByok, true);
});

group("BYOK refused when it would misroute or is meaningless");
test("unknown provider + key falls back to env resolution (key NOT used)", function () {
  clearKeys(); process.env.OPENAI_API_KEY = "sk-env";
  const r = resolveCall({ provider: "bogus-provider", apiKey: "user-key" });
  assert.strictEqual(r.useByok, false);
  assert.strictEqual(r.providerId, "openai");
  assert.strictEqual(r.key, "sk-env");        // user key never routed to a provider they didn't pick
});
test("no provider named + key does not attach the key to the default provider", function () {
  clearKeys(); process.env.OPENAI_API_KEY = "sk-env";
  const r = resolveCall({ apiKey: "user-key" });
  assert.strictEqual(r.useByok, false);
  assert.strictEqual(r.key, "sk-env");
});
test("empty / whitespace key is treated as no key", function () {
  clearKeys(); process.env.ANTHROPIC_API_KEY = "ant-env";
  const r = resolveCall({ provider: "anthropic", apiKey: "   " });
  assert.strictEqual(r.useByok, false);
  assert.strictEqual(r.key, "ant-env");
});

group("Behavior unchanged when no key is supplied (env path)");
test("explicit configured provider uses its env key", function () {
  clearKeys(); process.env.OPENAI_API_KEY = "sk-env";
  const r = resolveCall({ provider: "openai" });
  assert.strictEqual(r.providerId, "openai");
  assert.strictEqual(r.key, "sk-env");
  assert.strictEqual(r.useByok, false);
});
test("requested-but-unconfigured provider still falls back to a configured one", function () {
  clearKeys(); process.env.OPENAI_API_KEY = "sk-env";
  const r = resolveCall({ provider: "anthropic" });   // no anthropic env key, no BYOK
  assert.strictEqual(r.providerId, "openai");
  assert.strictEqual(r.useByok, false);
});

console.log("\n" + "=".repeat(60));
console.log("LLM-BYOK RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
