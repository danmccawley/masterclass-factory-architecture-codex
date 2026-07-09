"use strict";

const { CurriculumPlanSchema } = require("../schemas/curriculum-plan.schema.js");
const { assertValid } = require("../schemas/validator.js");

const BLOOM = ["apply", "analyze", "evaluate", "create"];

function measurableVerb(index) {
  return ["apply", "analyze", "evaluate", "design"][index % 4];
}

function buildCurriculumPlan(context, sealedCore) {
  const brief = context.brief;
  const items = sealedCore.items;
  if (!sealedCore.sealed) throw new Error("Curriculum planning requires a sealed Knowledge Core.");
  if (!items.length) throw new Error("Curriculum planning requires at least one verified core item.");
  const outcomeCount = Math.max(3, Math.min(8, Math.ceil(items.length / 3)));
  const outcomes = [];
  for (let i = 0; i < outcomeCount; i += 1) {
    const core = items[i % items.length];
    outcomes.push({
      id: "outcome-" + (i + 1),
      text: "Learners will be able to " + measurableVerb(i) + " " + brief.topic + " decisions using verified evidence and job-relevant criteria.",
      bloom_level: BLOOM[Math.min(BLOOM.length - 1, i % BLOOM.length)],
      core_item_ids: [core.id]
    });
  }
  const assessments = outcomes.map(function (outcome, index) {
    return {
      id: "assessment-" + (index + 1),
      outcome_id: outcome.id,
      prompt: "Scenario: use the evidence from this class to respond to a realistic " + brief.topic + " decision.",
      rubric: ["Uses verified evidence", "Explains tradeoffs", "Matches the learner's operating context", "Avoids unsupported claims"],
      answer_key: "A strong answer cites the relevant core evidence and explains the decision path.",
      core_item_ids: outcome.core_item_ids
    };
  });
  const moduleCount = Math.max(3, Math.min(outcomeCount, Math.ceil(brief.duration_minutes / 20)));
  const baseMinutes = Math.floor(brief.duration_minutes / moduleCount);
  const modules = [];
  for (let i = 0; i < moduleCount; i += 1) {
    const outcome = outcomes[i % outcomes.length];
    const core = items[i % items.length];
    modules.push({
      id: "module-" + (i + 1),
      title: i === 0 ? "Why this matters" : "Practice block " + (i + 1),
      minutes: i === moduleCount - 1 ? brief.duration_minutes - baseMinutes * (moduleCount - 1) : baseMinutes,
      hook_core_item_id: core.id,
      outcome_ids: [outcome.id],
      interaction_every_minutes: 8,
      deep_dive: brief.preferences.include_deep_dives !== "no"
    });
  }
  return assertValid(CurriculumPlanSchema, {
    id: "curriculum-" + sealedCore.id,
    sealed_core_id: sealedCore.id,
    duration_minutes: brief.duration_minutes,
    outcomes: outcomes,
    assessments: assessments,
    modules: modules,
    signoff_required: true
  }, "Curriculum plan");
}

module.exports = { buildCurriculumPlan: buildCurriculumPlan };
