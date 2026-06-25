"use strict";
// Runs the REAL classifier exported from api/generate.js (never a mirror).
const assert = require("assert");
const { classifySource } = require("../api/generate.js")._internal;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass += 1; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail += 1; }
}
const primaryOf = (url, title, snip) => classifySource(url, title, snip).trust === "primary";

// --- Rigor: general history/commentary sites must stay SECONDARY -------------
test("history.com stays secondary", function () {
  assert.strictEqual(primaryOf("https://www.history.com/topics/texas-revolution"), false);
});
test("wikipedia stays secondary", function () {
  assert.strictEqual(primaryOf("https://en.wikipedia.org/wiki/Texas_Revolution"), false);
});
test("britannica stays secondary", function () {
  assert.strictEqual(primaryOf("https://www.britannica.com/event/Texas-Revolution"), false);
});
test("commentary 'about' a treaty on a .com stays secondary", function () {
  assert.strictEqual(primaryOf("https://example.com/blog/the-treaty-explained", "The Treaty of Velasco Explained"), false);
});
test("a /archive/ news path alone does NOT flip to primary", function () {
  assert.strictEqual(primaryOf("https://www.newssite.com/archive/2019/texas"), false);
});

// --- Genuine primary sources must be PRIMARY --------------------------------
test("state .gov archive is primary", function () {
  assert.strictEqual(primaryOf("https://www.tsl.texas.gov/treasures/republic"), true);
});
test("loc.gov is primary", function () {
  assert.strictEqual(primaryOf("https://www.loc.gov/item/texas-declaration"), true);
});
test(".edu is primary", function () {
  assert.strictEqual(primaryOf("https://library.uh.edu/something"), true);
});
test("Avalon project (primary documents) is primary", function () {
  assert.strictEqual(primaryOf("https://avalon.law.yale.edu/19th_century/texan01.asp"), true);
});
test("archive.org original text is primary", function () {
  assert.strictEqual(primaryOf("https://archive.org/details/texasdeclaration"), true);
});
test("a 'primary source' / 'digital collections' page is primary by signal", function () {
  assert.strictEqual(primaryOf("https://www.somerepo.org/primary-sources/velasco", "Treaty of Velasco — full text transcript"), true);
});
test("an archives.* host is primary", function () {
  assert.strictEqual(primaryOf("https://archives.gov.example/records"), true);
});

console.log("\n============================================================");
console.log("CLASSIFY-SOURCE RESULTS: " + pass + " passed, " + fail + " failed");
console.log(fail === 0 ? "ALL GREEN" : "SOME FAILED");
process.exit(fail === 0 ? 0 : 1);
