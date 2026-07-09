"use strict";

const { CoreItemListSchema } = require("../schemas/core-item.schema.js");
const { assertValid } = require("../schemas/validator.js");

function deterministicCore(brief, verifiedSources) {
  const sources = verifiedSources.length ? verifiedSources : [];
  const topic = brief.topic;
  const items = sources.map(function (source, index) {
    return {
      id: "core-" + (index + 1),
      claim: source.excerpt || (source.title + " is a verified source for " + topic + "."),
      topic: topic,
      module_hint: "Module " + (index + 1),
      source_candidate_id: source.id,
      citation: source.locator,
      confidence: source.credibility_rank === "low" ? "low" : "medium",
      verification_status: "verified",
      allowed_uses: ["slides", "facilitator guide", "assessment", "presenter script"],
      risk_flags: []
    };
  });
  return { items: items, gaps: items.length ? [] : ["No verified sources are available for the Knowledge Core."] };
}

async function assembleCore(context, verifiedSources) {
  const brief = context.brief;
  const log = context.log || function () {};
  if (context.openai && verifiedSources.length) {
    const result = await context.openai.generateStructured({
      stage: "reasoning",
      schemaName: "core_items",
      schema: CoreItemListSchema,
      instructions: [
        "You assemble the Masterclass Factory Knowledge Core.",
        "Use only the provided source candidates. Every claim must cite a source_candidate_id.",
        "Do not add facts that are not present in the source title, excerpt, or locator metadata.",
        "Flag gaps instead of inventing missing facts."
      ].join("\n"),
      input: JSON.stringify({ brief: brief, verified_sources: verifiedSources }),
      maxOutputTokens: 8000,
      timeoutMs: 120000
    });
    const data = assertValid(CoreItemListSchema, result.data, "Knowledge Core items");
    log({ stage: "knowledge-core", message: "OpenAI assembled core items.", count: data.items.length, model: result.model });
    return data;
  }
  const fallback = deterministicCore(brief, verifiedSources);
  log({ stage: "knowledge-core", message: "Assembled core items from verified sources.", count: fallback.items.length });
  return fallback;
}

module.exports = { assembleCore: assembleCore, deterministicCore: deterministicCore };
