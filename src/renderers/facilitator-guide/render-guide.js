"use strict";

const { DeliverableSchema } = require("../../schemas/deliverable.schema.js");
const { assertValid } = require("../../schemas/validator.js");
const { provenanceMap } = require("../../knowledge-core/provenance.js");

function renderGuide(sealedCore, plan, brief) {
  const lines = ["# Facilitator Guide: " + brief.topic, ""];
  plan.modules.forEach(function (module, index) {
    lines.push("## " + module.title + " (" + module.minutes + " min)");
    lines.push("- Setup/materials: projector, learner handout, source appendix.");
    lines.push("- Hook: use core item `" + module.hook_core_item_id + "`.");
    lines.push("- Prompt: What would make this decision hard in your work?");
    lines.push("- Activity: worked example, guided practice, independent application.");
    lines.push("- Misconception correction: redirect to the cited source instead of opinion.");
    lines.push("- Differentiation: give fast learners an edge case; give struggling learners a decision checklist.");
    lines.push("- Contingency cut: keep the scenario and retrieval check; trim discussion first.");
    lines.push("");
  });
  const ids = plan.modules.map(function (m) { return m.hook_core_item_id; });
  return assertValid(DeliverableSchema, {
    id: "deliverable-guide-" + sealedCore.id,
    kind: "facilitator_guide",
    title: brief.topic + " facilitator guide",
    format: "markdown",
    content: lines.join("\n"),
    core_item_ids: ids,
    provenance_map: provenanceMap("guide", ids),
    qa_status: "pending"
  }, "Facilitator guide deliverable");
}

module.exports = { renderGuide: renderGuide };
