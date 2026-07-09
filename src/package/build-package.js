"use strict";

const { DeliverableSchema } = require("../schemas/deliverable.schema.js");
const { assertValid } = require("../schemas/validator.js");

function buildProvenanceAppendix(sealedCore) {
  const lines = ["# Works Cited and Source Quality", ""];
  sealedCore.sources.forEach(function (source) {
    lines.push("## " + source.title);
    lines.push("- Locator: " + source.locator);
    lines.push("- Credibility: " + source.credibility_rank);
    lines.push("- Reliability: " + source.reliability_rank);
    lines.push("- Verification: " + source.verification_status);
    lines.push("- Notes: " + source.verification_notes.join(" "));
    lines.push("");
  });
  lines.push("## Grading Method");
  lines.push("Credibility ranks source authority, provenance, recency, and relevance. Reliability ranks whether the source is stable, specific, corroborated, and appropriate for the claim type.");
  return assertValid(DeliverableSchema, {
    id: "deliverable-provenance-" + sealedCore.id,
    kind: "provenance_appendix",
    title: "Works cited and source quality",
    format: "markdown",
    content: lines.join("\n"),
    core_item_ids: sealedCore.items.map(function (item) { return item.id; }),
    provenance_map: sealedCore.items.map(function (item) { return { artifact_ref: "works-cited", core_item_id: item.id }; }),
    qa_status: "pending"
  }, "Provenance deliverable");
}

function buildPackage(args) {
  const appendix = buildProvenanceAppendix(args.sealedCore);
  const deliverables = args.deliverables.concat([appendix]);
  return {
    id: "package-" + args.sealedCore.id,
    status: args.qa.ok ? "ready" : "blocked",
    brief: args.brief,
    sealed_core: args.sealedCore,
    curriculum_plan: args.plan,
    deliverables: deliverables,
    qa: args.qa,
    evals: args.evals,
    operator_message: args.qa.ok
      ? "Bernard built the package from the sealed Knowledge Core. Presentation edits are safe; fact changes require reopening the core."
      : "Bernard found issues that must be corrected before delivery."
  };
}

module.exports = { buildPackage: buildPackage, buildProvenanceAppendix: buildProvenanceAppendix };
