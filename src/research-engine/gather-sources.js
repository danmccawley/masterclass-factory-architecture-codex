"use strict";

const { SourceCandidateListSchema } = require("../schemas/source-candidate.schema.js");
const { assertValid } = require("../schemas/validator.js");

const TIER_FLOORS = {
  briefing: { sources: 4, primary: 1 },
  standard: { sources: 8, primary: 2 },
  professional: { sources: 12, primary: 3 },
  expert: { sources: 20, primary: 6 }
};

function sourceFloorFor(tier) {
  return TIER_FLOORS[tier] || TIER_FLOORS.professional;
}

function candidateFromUpload(upload, index) {
  return {
    id: upload.id || "source-" + (index + 1),
    title: upload.name || upload.uri || "Operator source " + (index + 1),
    source_type: upload.type === "url" ? "web" : "uploaded_file",
    locator: upload.uri || "",
    publisher: "",
    author: "",
    published_date: "",
    excerpt: "",
    credibility_rank: "unknown",
    reliability_rank: "unknown",
    verification_status: upload.uri ? "candidate" : "rejected",
    verification_notes: upload.uri ? ["Operator supplied source."] : ["Missing source locator."]
  };
}

function acceptedCandidates(candidates) {
  return candidates.filter(function (source) {
    return source.verification_status !== "rejected" && source.locator;
  });
}

async function gatherSources(context) {
  const brief = context.brief;
  const log = context.log || function () {};
  const candidates = (brief.uploaded_materials || []).map(candidateFromUpload);
  log({ stage: "research", message: "Collected operator supplied materials.", count: candidates.length });

  if ((brief.research_depth === "assisted" || brief.research_depth === "ai owned") && context.openai) {
    const floor = sourceFloorFor(brief.class_tier);
    const result = await context.openai.generateStructured({
      stage: "research",
      schemaName: "source_candidates",
      schema: SourceCandidateListSchema,
      instructions: [
        "You are Bernard's research agent for Masterclass Factory.",
        "Find credible, relevant source candidates only. Do not invent URLs, dates, authors, quotes, or statistics.",
        "Return source candidates that can be verified later. Prefer primary sources, standards, authoritative manuals, peer-reviewed work, official guidance, and current technical documentation."
      ].join("\n"),
      input: JSON.stringify({
        topic: brief.topic,
        audience: brief.audience,
        class_tier: brief.class_tier,
        minimum_source_goal: floor.sources,
        minimum_primary_source_goal: floor.primary,
        must_cover: brief.must_cover,
        out_of_scope: brief.out_of_scope
      }),
      tools: [{ type: "web_search_preview" }],
      maxOutputTokens: 6000,
      timeoutMs: 120000
    });
    const payload = assertValid(SourceCandidateListSchema, result.data, "Source candidate list");
    payload.candidates.forEach(function (candidate) { candidates.push(candidate); });
    log({ stage: "research", message: "OpenAI research returned candidates.", count: payload.candidates.length, model: result.model });
  }

  const unique = [];
  const seen = Object.create(null);
  candidates.forEach(function (candidate, index) {
    const key = String(candidate.locator || candidate.title || index).toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    unique.push(Object.assign({}, candidate, { id: candidate.id || "source-" + (unique.length + 1) }));
  });

  return {
    candidates: unique,
    accepted: acceptedCandidates(unique),
    floor: sourceFloorFor(brief.class_tier)
  };
}

module.exports = {
  gatherSources: gatherSources,
  sourceFloorFor: sourceFloorFor,
  acceptedCandidates: acceptedCandidates
};
