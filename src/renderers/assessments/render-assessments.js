"use strict";

const { DeliverableSchema } = require("../../schemas/deliverable.schema.js");
const { assertValid } = require("../../schemas/validator.js");
const { provenanceMap } = require("../../knowledge-core/provenance.js");

function renderAssessments(sealedCore, plan, brief) {
  const content = {
    formative_checks: plan.modules.map(function (module) {
      return { module_id: module.id, prompt: "Name one decision this module changes and cite the source evidence.", core_item_id: module.hook_core_item_id };
    }),
    summative_scenario: {
      prompt: "Use the class evidence to solve a realistic " + brief.topic + " scenario.",
      rubric: ["Evidence use", "Decision quality", "Risk awareness", "Plain-language explanation"],
      answer_key: plan.assessments.map(function (a) { return a.answer_key; }).join(" ")
    },
    mapped_assessments: plan.assessments
  };
  const ids = Array.from(new Set(plan.assessments.reduce(function (all, a) { return all.concat(a.core_item_ids); }, [])));
  return assertValid(DeliverableSchema, {
    id: "deliverable-assessments-" + sealedCore.id,
    kind: "assessments",
    title: brief.topic + " assessment set",
    format: "json",
    content: JSON.stringify(content, null, 2),
    core_item_ids: ids,
    provenance_map: provenanceMap("assessment", ids),
    qa_status: "pending"
  }, "Assessment deliverable");
}

module.exports = { renderAssessments: renderAssessments };
