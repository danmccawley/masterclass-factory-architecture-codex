"use strict";

const SourceCandidateSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    id: { type: "string", required: true },
    title: { type: "string", required: true },
    source_type: { type: "string", enum: ["web", "uploaded_file", "operator_note"], required: true },
    locator: { type: "string", required: true },
    publisher: { type: "string", required: true },
    author: { type: "string", required: true },
    published_date: { type: "string", required: true },
    excerpt: { type: "string", required: true },
    credibility_rank: { type: "string", enum: ["high", "medium", "low", "unknown"], required: true },
    reliability_rank: { type: "string", enum: ["high", "medium", "low", "unknown"], required: true },
    trust_tier: { type: "string", enum: ["primary", "secondary", "unknown"] },
    verification_status: { type: "string", enum: ["candidate", "verified", "rejected"], required: true },
    verification_notes: { type: "array", required: true, items: { type: "string" } }
  }
};

const SourceCandidateListSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    candidates: { type: "array", required: true, items: SourceCandidateSchema }
  }
};

module.exports = {
  SourceCandidateSchema: SourceCandidateSchema,
  SourceCandidateListSchema: SourceCandidateListSchema
};
