"use strict";

const OutcomeSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    text: { type: "string", required: true },
    bloom_level: { type: "string", enum: ["apply", "analyze", "evaluate", "create"], required: true },
    core_item_ids: { type: "array", required: true, items: { type: "string" } }
  }
};

const AssessmentSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    outcome_id: { type: "string", required: true },
    prompt: { type: "string", required: true },
    rubric: { type: "array", required: true, items: { type: "string" } },
    answer_key: { type: "string", required: true },
    core_item_ids: { type: "array", required: true, items: { type: "string" } }
  }
};

const ModuleSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    title: { type: "string", required: true },
    minutes: { type: "integer", minimum: 1, required: true },
    hook_core_item_id: { type: "string", required: true },
    outcome_ids: { type: "array", required: true, items: { type: "string" } },
    interaction_every_minutes: { type: "integer", minimum: 5, maximum: 10, required: true },
    deep_dive: { type: "boolean", required: true }
  }
};

const CurriculumPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    sealed_core_id: { type: "string", required: true },
    duration_minutes: { type: "integer", minimum: 10, required: true },
    outcomes: { type: "array", minItems: 1, required: true, items: OutcomeSchema },
    assessments: { type: "array", minItems: 1, required: true, items: AssessmentSchema },
    modules: { type: "array", minItems: 1, required: true, items: ModuleSchema },
    signoff_required: { type: "boolean", required: true }
  }
};

module.exports = {
  CurriculumPlanSchema: CurriculumPlanSchema,
  OutcomeSchema: OutcomeSchema,
  AssessmentSchema: AssessmentSchema,
  ModuleSchema: ModuleSchema
};
