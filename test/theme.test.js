/* eslint-disable no-console */
// test/theme.test.js — class theming engine (api/theme.js). Deterministic.
const assert = require("assert");
const T = require("../api/theme.js")._internal;

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

group("Hex parsing");
test("clampHex accepts #abc, #aabbcc, and bare hex", function () {
  assert.strictEqual(T.clampHex("#abc"), "#aabbcc");
  assert.strictEqual(T.clampHex("AABBCC"), "#aabbcc");
  assert.strictEqual(T.clampHex("#11AA33"), "#11aa33");
});
test("clampHex rejects garbage", function () {
  assert.strictEqual(T.clampHex("nope"), null);
  assert.strictEqual(T.clampHex("#12"), null);
  assert.strictEqual(T.clampHex(""), null);
});

group("WCAG contrast");
test("black on white is ~21:1, white on white is 1:1", function () {
  assert.ok(T.contrastRatio("#000000", "#ffffff") > 20);
  assert.ok(Math.abs(T.contrastRatio("#ffffff", "#ffffff") - 1) < 0.001);
});
test("nudge lifts low-contrast fg to meet the minimum", function () {
  // light gray on white fails; must be darkened to >= 4.5
  const fixed = T.nudgeForContrast("#cccccc", "#ffffff", 4.5);
  assert.ok(T.contrastRatio(fixed, "#ffffff") >= 4.5);
});
test("nudge leaves already-legible colors untouched", function () {
  const fixed = T.nudgeForContrast("#111111", "#ffffff", 4.5);
  assert.strictEqual(fixed, "#111111");
});

group("Named themes are all legible-by-construction");
test("every named theme passes guardrails WITHOUT adjustment", function () {
  Object.keys(T.NAMED_THEMES).forEach(function (k) {
    const r = T.ensureLegible(T.NAMED_THEMES[k].palette);
    assert.strictEqual(r.adjusted, false, k + " required adjustment: " + JSON.stringify(r.warnings));
  });
});
test("every named theme has body-text contrast >= 4.5 (AA)", function () {
  Object.keys(T.NAMED_THEMES).forEach(function (k) {
    const p = T.NAMED_THEMES[k].palette;
    assert.ok(T.contrastRatio(p.ink, p.bg) >= 4.5, k + " ink/bg too low");
    assert.ok(T.contrastRatio(p.paperInk, p.paper) >= 4.5, k + " deep-dive text too low");
  });
});

group("Guardrails fix an unreadable custom palette");
test("white text on white bg gets darkened", function () {
  const r = T.ensureLegible({ bg: "#ffffff", ink: "#fafafa" });
  assert.ok(r.adjusted);
  assert.ok(T.contrastRatio(r.palette.ink, r.palette.bg) >= 4.5);
  assert.ok(r.warnings.some(function (w) { return /Body text/.test(w); }));
});
test("missing tokens are filled from the default palette", function () {
  const r = T.ensureLegible({ accent: "#ff0000" });
  assert.strictEqual(r.palette.bg, T.DEFAULT_PALETTE.bg);
  assert.strictEqual(r.palette.accent, "#ff0000");
});

group("CSS override emitter");
test("themeCssOverride maps tokens to the template's CSS vars", function () {
  const css = T.themeCssOverride(T.NAMED_THEMES.dune.palette);
  assert.ok(/--amber:#e0922e/.test(css), "primary accent -> --amber");
  assert.ok(/--teal:/.test(css), "secondary accent -> --teal");
  assert.ok(/--paper-ink:/.test(css));
  assert.ok(/^:root\{/.test(css));
});

group("resolveThemeCss (what the generator injects)");
test("named theme resolves to a CSS override", function () {
  const css = T.resolveThemeCss({ mode: "named", named: "ocean" });
  assert.ok(/--bg:#061620/.test(css));
});
test("default / tech-noir / unknown -> empty (built-in look, no regression)", function () {
  assert.strictEqual(T.resolveThemeCss(null), "");
  assert.strictEqual(T.resolveThemeCss({ mode: "named", named: "tech-noir" }), "");
  assert.strictEqual(T.resolveThemeCss({ mode: "named", named: "does-not-exist" }), "");
  assert.strictEqual(T.resolveThemeCss({}), "");
});
test("custom tokens resolve and are made legible", function () {
  const css = T.resolveThemeCss({ mode: "custom", tokens: { bg: "#ffffff", ink: "#f4f4f4", accent: "#3333ff" } });
  // ink must have been darkened => not the near-white we passed
  assert.ok(!/--ink:#f4f4f4/.test(css));
  assert.ok(/--bg:#ffffff/.test(css));
});

group("LLM palette parsing");
test("parses fenced JSON and maps aliases", function () {
  const text = "```json\n{ \"background\": \"#101820\", \"text\": \"#eaeaea\", \"primary\": \"#ff8800\", \"secondary\": \"#22cccc\" }\n```";
  const p = T.paletteFromLLMJson(text);
  assert.strictEqual(p.bg, "#101820");
  assert.strictEqual(p.ink, "#eaeaea");
  assert.strictEqual(p.accent, "#ff8800");
  assert.strictEqual(p.accent2, "#22cccc");
});
test("parses prose-wrapped JSON object", function () {
  const text = "Here is your palette: { \"bg\": \"#0a0a0a\", \"ink\": \"#ffffff\" } — enjoy!";
  const p = T.paletteFromLLMJson(text);
  assert.strictEqual(p.bg, "#0a0a0a");
});
test("returns null on unparseable / no-color responses", function () {
  assert.strictEqual(T.paletteFromLLMJson("sorry, I can't help"), null);
  assert.strictEqual(T.paletteFromLLMJson("{ \"foo\": \"bar\" }"), null);
});
test("themePromptMessages asks for strict JSON of all tokens", function () {
  const m = T.themePromptMessages("foggy pacific northwest morning");
  assert.strictEqual(m.length, 2);
  assert.ok(/JSON/.test(m[0].content));
  assert.ok(/paper/.test(m[0].content));
  assert.ok(/foggy pacific northwest/.test(m[1].content));
});

group("Catalog for the wizard dropdown");
test("themeCatalog lists every named theme with swatch colors", function () {
  const cat = T.themeCatalog();
  assert.strictEqual(cat.length, Object.keys(T.NAMED_THEMES).length);
  cat.forEach(function (c) {
    assert.ok(c.key && c.label && c.swatch && c.swatch.bg && c.swatch.accent);
  });
});

console.log("\n" + "=".repeat(60));
console.log("THEME-ENGINE RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
