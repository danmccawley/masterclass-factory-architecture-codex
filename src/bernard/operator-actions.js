"use strict";

const { createOpenAIClient } = require("../util/config/openai-client.js");
const { assertValid, BriefSchema, fromLegacyBrief } = require("../schemas/index.js");
const { gatherSources } = require("../research-engine/gather-sources.js");
const { verifySources } = require("../research-engine/verify-sources.js");
const { assembleCore } = require("../knowledge-core/assemble-core.js");
const { sealCore } = require("../knowledge-core/seal-core.js");
const { buildCurriculumPlan } = require("../curriculum-plan/build-plan.js");
const { renderSlides } = require("../renderers/slides/render-slides.js");
const { renderGuide } = require("../renderers/facilitator-guide/render-guide.js");
const { renderAssessments } = require("../renderers/assessments/render-assessments.js");
const { renderScript } = require("../renderers/presenter-script/render-script.js");
const { runQAGate } = require("../qa/qa-agent.js");
const { scorePlan } = require("../qa/evals/factory-evals.js");
const { buildPackage } = require("../package/build-package.js");

function createJobLog() {
  const started = Date.now();
  const events = [];
  return {
    event: function (entry) {
      events.push(Object.assign({ at_ms: Date.now() - started }, entry || {}));
    },
    events: events
  };
}

function normalizeBrief(input) {
  const brief = input && input.topic ? input : fromLegacyBrief(input || {});
  return assertValid(BriefSchema, brief, "Brief");
}

async function runFactory(input, options) {
  options = options || {};
  const log = createJobLog();
  const brief = normalizeBrief(input);
  const context = {
    brief: brief,
    log: log.event,
    openai: options.openai || (options.enableOpenAI === false ? null : createOpenAIClient(options.openaiOptions || {}))
  };
  log.event({ stage: "brief", message: "Brief accepted." });

  const research = await gatherSources(context);
  const sourceVerification = verifySources(research, context);
  if (!sourceVerification.standard.ok && !options.proceedWithGaps) {
    return {
      ok: false,
      stage: "knowledge-core-review",
      needs_operator: true,
      message: "Knowledge Core cannot be sealed yet because the selected source standard is not met.",
      source_standard: sourceVerification.standard,
      candidates: sourceVerification.verified,
      rejected_sources: sourceVerification.rejected,
      log: log.events
    };
  }

  const core = await assembleCore(context, sourceVerification.verified);
  const sealedCore = sealCore({
    brief: brief,
    sources: sourceVerification.verified,
    items: core.items,
    approved_by: options.approvedBy || "operator",
    approval_note: options.approvalNote || "Auto-sealed for API run after operator approval signal."
  });
  const plan = buildCurriculumPlan(context, sealedCore);
  const deliverables = [
    renderSlides(sealedCore, plan, brief),
    renderGuide(sealedCore, plan, brief),
    renderAssessments(sealedCore, plan, brief),
    renderScript(sealedCore, plan, brief)
  ];
  const qa = runQAGate(sealedCore, plan, deliverables, brief);
  const evals = scorePlan(plan, deliverables);
  const pkg = buildPackage({ brief: brief, sealedCore: sealedCore, plan: plan, deliverables: deliverables, qa: qa, evals: evals });
  log.event({ stage: "package", message: "Package assembled.", status: pkg.status });
  return Object.assign({ ok: qa.ok, log: log.events }, pkg);
}

module.exports = {
  normalizeBrief: normalizeBrief,
  runFactory: runFactory,
  createJobLog: createJobLog
};
