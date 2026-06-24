/* eslint-disable no-console */
// test/curriculum-bibliography.test.js — source harvest + knowledge_core roll-up
// (api/curriculum-bibliography.js). Pure / deterministic.
const assert = require("assert");
const Bib = require("../api/curriculum-bibliography.js");
const S = require("../api/curriculum-store.js")._internal;

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (e) { failed += 1; failures.push({ name, message: e.message }); console.log("  FAIL " + name + "\n         " + e.message); }
}
function group(t) { console.log("\n# " + t); }

function manifest3() {
  // Three ordered classes; sources deliberately overlap across classes.
  return S.makeManifest({ subject: "Test", classes: [
    { title: "Foundations", order: 1, terminal: ["t1"] },
    { title: "Core", order: 2, terminal: ["t2"] },
    { title: "Advanced", order: 3, terminal: ["t3"] }
  ] });
}

group("normalizeSource");
test("accepts url/published/year aliases and derives primary from trust", function () {
  const s = Bib.normalizeSource({ url: "https://nist.gov/spec", title: "NIST Spec", trust: "primary", date: "2024" });
  assert.strictEqual(s.path, "https://nist.gov/spec");
  assert.strictEqual(s.title, "NIST Spec");
  assert.strictEqual(s.trust, "primary");
  assert.strictEqual(s.primary, true);
  assert.strictEqual(s.published, "2024");
});
test("explicit primary flag forces primary trust", function () {
  const s = Bib.normalizeSource({ path: "x", primary: true, trust: "secondary" });
  assert.strictEqual(s.primary, true);
  assert.strictEqual(s.trust, "primary");
});
test("unknown trust is the default; title falls back to path", function () {
  const s = Bib.normalizeSource({ url: "https://example.com/a" });
  assert.strictEqual(s.trust, "unknown");
  assert.strictEqual(s.primary, false);
  assert.strictEqual(s.title, "https://example.com/a");
});
test("returns null when there is neither url nor title", function () {
  assert.strictEqual(Bib.normalizeSource({}), null);
  assert.strictEqual(Bib.normalizeSource(null), null);
});
test("viaClass attributes the source when raw has no cited_by", function () {
  const s = Bib.normalizeSource({ url: "https://a.com" }, "foundations");
  assert.deepStrictEqual(s.cited_by, ["foundations"]);
});

group("dedupeKey / dedupeSources");
test("scheme, www., and trailing slash collapse to one key", function () {
  const a = Bib.normalizeSource({ url: "https://www.iso.org/std/123/" });
  const b = Bib.normalizeSource({ url: "http://iso.org/std/123" });
  assert.strictEqual(Bib.dedupeKey(a), Bib.dedupeKey(b));
});
test("dedupeSources merges duplicates and keeps the richer title + primary", function () {
  const list = [
    { url: "https://iso.org/std/1" },                                   // title = url, unknown
    { url: "https://iso.org/std/1", title: "ISO 9001 Standard", trust: "primary" }
  ];
  const out = Bib.dedupeSources(list);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].title, "ISO 9001 Standard");
  assert.strictEqual(out[0].primary, true);
});

group("recordClassSources");
test("records de-duped sources onto the matching class", function () {
  const m = manifest3();
  const out = Bib.recordClassSources(m, "core", [
    { url: "https://a.com", title: "A" },
    { url: "https://a.com", title: "A" },     // dup
    { url: "https://b.com", title: "B" }
  ]);
  const core = out.classes.filter((c) => c.slug === "core")[0];
  assert.strictEqual(core.sources.length, 2);
  // original manifest untouched (robust whether store seeds sources:[] or not)
  assert.strictEqual((m.classes.filter((c) => c.slug === "core")[0].sources || []).length, 0);
});
test("throws on an unknown class slug", function () {
  assert.throws(function () { Bib.recordClassSources(manifest3(), "nope", []); }, /No class with slug/);
});

group("rollUpKnowledgeCore");
test("unions across classes, dedupes, and attributes cited_by", function () {
  let m = manifest3();
  m = Bib.recordClassSources(m, "foundations", [{ url: "https://shared.com", title: "Shared", trust: "secondary" }]);
  m = Bib.recordClassSources(m, "core", [
    { url: "https://shared.com", title: "Shared" },               // same as foundations
    { url: "https://core-only.com", title: "Core Only", trust: "primary" }
  ]);
  m = Bib.rollUpKnowledgeCore(m);

  const sources = m.knowledge_core.sources;
  assert.strictEqual(sources.length, 2);
  const shared = sources.filter((s) => s.path === "https://shared.com")[0];
  assert.deepStrictEqual(shared.cited_by, ["foundations", "core"]);
  assert.ok(m.knowledge_core.compiled_at);
});
test("primary sources sort before secondary/unknown, then by title", function () {
  let m = manifest3();
  m = Bib.recordClassSources(m, "core", [
    { url: "https://z.com", title: "Zeta", trust: "unknown" },
    { url: "https://p.com", title: "Primary One", trust: "primary" },
    { url: "https://a.com", title: "Alpha", trust: "secondary" }
  ]);
  m = Bib.rollUpKnowledgeCore(m);
  const titles = m.knowledge_core.sources.map((s) => s.title);
  assert.deepStrictEqual(titles, ["Primary One", "Alpha", "Zeta"]);
});
test("preserves knowledge_core.shared and leaves sealed=false by default", function () {
  let m = manifest3();
  m = Bib.recordClassSources(m, "core", [{ url: "https://a.com", title: "A" }]);
  m = Bib.rollUpKnowledgeCore(m);
  assert.strictEqual(m.knowledge_core.shared, true);
  assert.strictEqual(m.knowledge_core.sealed, false);
});
test("a curriculum with no class sources yields an empty, valid core", function () {
  const m = Bib.rollUpKnowledgeCore(manifest3());
  assert.deepStrictEqual(m.knowledge_core.sources, []);
  assert.ok(m.knowledge_core.compiled_at);
});

group("bibliography / summarize");
test("bibliography computes on the fly when core not yet rolled up", function () {
  let m = manifest3();
  m = Bib.recordClassSources(m, "core", [{ url: "https://a.com", title: "A", trust: "primary" }]);
  const list = Bib.bibliography(m);   // core.sources still empty array from makeManifest
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, "A");
});
test("summarize counts by trust tier", function () {
  const sum = Bib.summarize([
    { trust: "primary", primary: true },
    { trust: "secondary" },
    { trust: "secondary" },
    { trust: "unknown" }
  ]);
  assert.deepStrictEqual(sum, { total: 4, primary: 1, secondary: 2, unknown: 1 });
});

console.log("\n" + "=".repeat(60));
console.log("CURRICULUM-BIBLIOGRAPHY RESULTS: " + passed + " passed, " + failed + " failed");
if (failed) { console.log("\nFAILURES:"); failures.forEach(function (f) { console.log("  - " + f.name + ": " + f.message); }); process.exit(1); }
else { console.log("ALL GREEN"); process.exit(0); }
