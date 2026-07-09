/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const { validateSchema, BriefSchema } = require("../../src/schemas/index.js");
const { runFactory } = require("../../src/bernard/operator-actions.js");
const { slideCountFor } = require("../../src/renderers/slides/render-slides.js");

function brief() {
  return {
    topic: "Fiber installation in data centers",
    audience: {
      role: "data center technicians",
      skill_level: "technical",
      floor_background: "New technician with general safety awareness.",
      language: "en",
      reading_grade_cap: 9
    },
    duration_minutes: 90,
    delivery_format: "live workshop",
    tone: "plain",
    class_tier: "professional",
    research_depth: "operator supplied",
    must_cover: ["safety", "inspection", "testing"],
    out_of_scope: [],
    uploaded_materials: Array.from({ length: 12 }).map(function (_, i) {
      return { id: "s" + i, name: (i < 3 ? "Official standard " : "Technical report ") + i, type: "url", uri: "https://example.com/source-" + i };
    }),
    preferences: { include_deep_dives: "yes", include_video_audio_links: "optional", split_language_view: false }
  };
}

(async function () {
  const b = brief();
  const validation = validateSchema(BriefSchema, b);
  assert.strictEqual(validation.ok, true, validation.errors.join("\n"));
  assert.ok(slideCountFor(b) >= 45, "professional class should not collapse to 5 slides");
  const result = await runFactory(b, { enableOpenAI: false });
  assert.strictEqual(result.ok, true, JSON.stringify(result.qa, null, 2));
  assert.strictEqual(result.status, "ready");
  assert.ok(result.sealed_core.sealed, "core must be sealed before render");
  const deck = result.deliverables.filter(function (d) { return d.kind === "slide_deck"; })[0];
  const slides = JSON.parse(deck.content).slides;
  assert.ok(slides.length >= 45, "deck must respect masterclass depth");
  assert.ok(slides.every(function (s) { return s.core_item_ids && s.core_item_ids.length; }), "every slide must cite core IDs");
  assert.ok(result.deliverables.some(function (d) { return d.kind === "provenance_appendix"; }), "package must include works cited/source quality appendix");
  console.log("FACTORY RESULTS: all green");
})();
