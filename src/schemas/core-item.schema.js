"use strict";

const CoreItemSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    claim: { type: "string", minLength: 8, required: true },
    topic: { type: "string", required: true },
    module_hint: { type: "string", required: true },
    source_candidate_id: { type: "string", required: true },
    citation: { type: "string", required: true },
    confidence: { type: "string", enum: ["high", "medium", "low"], required: true },
    verification_status: { type: "string", enum: ["verified", "needs_review", "rejected"], required: true },
    allowed_uses: { type: "array", required: true, items: { type: "string" } },
    risk_flags: { type: "array", required: true, items: { type: "string" } }
  }
};

const CoreItemListSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    items: { type: "array", required: true, items: CoreItemSchema },
    gaps: { type: "array", required: true, items: { type: "string" } }
  }
};

module.exports = { CoreItemSchema: CoreItemSchema, CoreItemListSchema: CoreItemListSchema };
