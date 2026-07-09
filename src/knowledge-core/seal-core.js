"use strict";

const crypto = require("crypto");
const { SealedCoreSchema } = require("../schemas/sealed-core.schema.js");
const { assertValid } = require("../schemas/validator.js");

function sealCore(args) {
  const brief = args.brief;
  const sources = args.sources || [];
  const items = args.items || [];
  const now = args.now || new Date().toISOString();
  const sealed = {
    id: "sealed-core-" + crypto.createHash("sha1").update(brief.topic + now).digest("hex").slice(0, 10),
    brief_topic: brief.topic,
    sealed: true,
    sealed_at: now,
    approved_by: args.approved_by || "operator",
    approval_note: args.approval_note || "Operator approved the Knowledge Core as the locked foundation.",
    sources: sources,
    items: items,
    mutation_policy: "locked_requires_advancement_opportunity",
    provenance_stats: {
      verified_items: items.filter(function (item) { return item.verification_status === "verified"; }).length,
      source_count: sources.length,
      high_confidence_items: items.filter(function (item) { return item.confidence === "high"; }).length
    }
  };
  return assertValid(SealedCoreSchema, sealed, "Sealed Knowledge Core");
}

function advancementOpportunity(reason, requestedFacts) {
  return {
    required: true,
    reason: reason,
    requested_facts: requestedFacts || [],
    operator_options: [
      "Add or approve more sources, then reopen the Knowledge Core.",
      "Narrow the scope so the missing facts are no longer needed.",
      "Proceed with the gap explicitly flagged in the package."
    ]
  };
}

module.exports = { sealCore: sealCore, advancementOpportunity: advancementOpportunity };
