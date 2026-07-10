"use strict";

const { DeliverableSchema } = require("../../schemas/deliverable.schema.js");
const { assertValid } = require("../../schemas/validator.js");
const { provenanceMap } = require("../../knowledge-core/provenance.js");

function renderScript(sealedCore, plan, brief) {
  const lines = ["# Presenter Script: " + brief.topic, ""];
  plan.modules.forEach(function (module) {
    lines.push("## " + module.title);
    lines.push("[Timing: " + module.minutes + " minutes]");
    lines.push("Open with the practical stakes, then say: \"Let's work from evidence, not guesses.\"");
    lines.push("Use core item `" + module.hook_core_item_id + "` as the factual anchor.");
    lines.push("Transition: \"Now that we have the evidence, let's apply it to a real decision.\"");
    lines.push("");
  });
  const ids = plan.modules.map(function (m) { return m.hook_core_item_id; });
  return assertValid(DeliverableSchema, {
    id: "deliverable-script-" + sealedCore.id,
    kind: "presenter_script",
    title: brief.topic + " presenter script",
    format: "markdown",
    content: lines.join("\n"),
    core_item_ids: ids,
    provenance_map: provenanceMap("script", ids),
    qa_status: "pending"
  }, "Presenter script deliverable");
}

module.exports = { renderScript: renderScript };
