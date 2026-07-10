"use strict";

const { CoreItemSchema } = require("./core-item.schema.js");
const { SourceCandidateSchema } = require("./source-candidate.schema.js");

const SealedCoreSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    brief_topic: { type: "string", required: true },
    sealed: { type: "boolean", required: true },
    sealed_at: { type: "string", format: "date-time", required: true },
    approved_by: { type: "string", required: true },
    approval_note: { type: "string", required: true },
    sources: { type: "array", required: true, items: SourceCandidateSchema },
    items: { type: "array", required: true, items: CoreItemSchema },
    mutation_policy: { type: "string", enum: ["locked_requires_advancement_opportunity"], required: true },
    provenance_stats: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: {
        verified_items: { type: "integer", minimum: 0, required: true },
        source_count: { type: "integer", minimum: 0, required: true },
        high_confidence_items: { type: "integer", minimum: 0, required: true }
      }
    }
  }
};

module.exports = { SealedCoreSchema: SealedCoreSchema };
