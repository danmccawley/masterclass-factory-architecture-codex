"use strict";

const DeliverableSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    kind: { type: "string", enum: ["slide_deck", "facilitator_guide", "assessments", "presenter_script", "provenance_appendix", "package"], required: true },
    title: { type: "string", required: true },
    format: { type: "string", required: true },
    content: { type: "string", required: true },
    core_item_ids: { type: "array", required: true, items: { type: "string" } },
    provenance_map: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          artifact_ref: { type: "string", required: true },
          core_item_id: { type: "string", required: true }
        }
      }
    },
    qa_status: { type: "string", enum: ["pending", "pass", "fail"], required: true }
  }
};

module.exports = { DeliverableSchema: DeliverableSchema };
