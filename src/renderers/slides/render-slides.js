"use strict";

const { DeliverableSchema } = require("../../schemas/deliverable.schema.js");
const { assertValid } = require("../../schemas/validator.js");
const { assertCoreItemIds, provenanceMap } = require("../../knowledge-core/provenance.js");

function slideCountFor(brief) {
  const byTime = Math.max(12, Math.ceil(brief.duration_minutes * 0.75));
  const tierFloor = brief.class_tier === "expert" ? 60 : brief.class_tier === "professional" ? 45 : brief.class_tier === "standard" ? 30 : 15;
  return Math.max(byTime, tierFloor);
}

function renderSlides(sealedCore, plan, brief) {
  const coreIds = sealedCore.items.map(function (item) { return item.id; });
  assertCoreItemIds(sealedCore, coreIds);
  const target = slideCountFor(brief);
  const slides = [];
  for (let i = 0; i < target; i += 1) {
    const item = sealedCore.items[i % sealedCore.items.length];
    const module = plan.modules[i % plan.modules.length];
    slides.push({
      number: i + 1,
      title: module.title + ": " + item.topic,
      headline: item.claim,
      evidence: item.citation,
      speaker_notes: "Teach this as assertion-evidence. Use core item " + item.id + " for the claim. Add a worked example, guided practice, and a short retrieval check.",
      visual_suggestion: "Use a simple process diagram, annotated field photo, comparison table, or decision tree grounded in the cited source.",
      deep_dive: module.deep_dive ? "Deep dive: explain edge cases, field disagreements, limitations, and transfer scenarios using only core item " + item.id + "." : "",
      core_item_ids: [item.id]
    });
  }
  return assertValid(DeliverableSchema, {
    id: "deliverable-slides-" + sealedCore.id,
    kind: "slide_deck",
    title: brief.topic + " slide deck",
    format: "json+pptx-ready",
    content: JSON.stringify({ slides: slides }, null, 2),
    core_item_ids: coreIds,
    provenance_map: provenanceMap("slide", slides.map(function (s) { return s.core_item_ids[0]; })),
    qa_status: "pending"
  }, "Slide deliverable");
}

module.exports = { renderSlides: renderSlides, slideCountFor: slideCountFor };
