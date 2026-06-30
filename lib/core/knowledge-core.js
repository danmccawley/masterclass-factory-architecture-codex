// lib/core/knowledge-core.js
//
// The knowledge-base resolution layer, extracted from api/generate.js (Sprint 3,
// module 6 — behavior-preserving). This is the orchestration that decides what
// happens to a brief's knowledge base before authoring:
//   - resolveKnowledgeBase        — the seal short-circuit + non-blocking recovery
//                                    ladder (discovery -> re-gate -> change-order pause).
//   - resolveKnowledgeBaseLegacy  — the previous blocking resolver shape, retained
//                                    for reference (no longer wired to the handler).
//   - detectAdvancementOpportunity — the one controlled, non-blocking probe that can
//                                    surface a stronger primary source after a seal.
//
// It sits ON TOP of the research engine: it calls discovery + scarcity + change-
// order building, but owns none of that machinery. Dependency direction is
// acyclic and requires NOTHING back from generate.js:
//   util, openai, research-engine  ->  knowledge-core  ->  generate
//
// STRICTLY behavior-preserving: every function body is moved verbatim.
"use strict";

const { knowledgeBaseStandard, researchOwner } = require("../util.js");
const { openAIKeyUsable } = require("./openai.js");
const {
  discoverKnowledgeBaseSources, prepareKnowledgeBase,
  highestMetTier, assessSourceScarcity, buildChangeOrder
} = require("./research-engine.js");

// The knowledge-base step NEVER blocks a build. It researches, scores, and
// analyzes — then, if the floor is not met, it PAUSES for informed consent. The
// human is the only off-switch: they can build anyway (the default), drop to a
// met tier, add sources, or decline. The factory and the AI never terminate a
// job order; only the human can choose not to build.
//
// Resolutions:
//   { resolution: "ready" }                  → floor met (or consent given); build now
//   { resolution: "knowledge_base_review" }  → floor not met; pause, present status +
//                                               analysis + recommendations, default = build anyway
// detectAdvancementOpportunity — the ONE controlled door that can reopen a
// sealed knowledge base. It runs a non-blocking probe: it asks discovery whether
// a genuinely stronger source (a new PRIMARY source not already sealed in) exists
// that the build did not have at seal time. It never blocks, never mutates the
// brief, and never folds anything in on its own. If it finds something, it
// returns a structured notice the human can review, approve, and execute through
// the proper channel. If anything goes wrong, it returns null and the build is
// entirely unaffected — an advancement check must never be able to break a build.
async function detectAdvancementOpportunity(brief) {
  try {
    if (!brief || !brief.knowledge_base) return null;
    const webAllowed = brief.knowledge_base.research && brief.knowledge_base.research.allow_web !== false;
    if (!webAllowed || !openAIKeyUsable()) return null;

    // Probe on a copy. Force AI/web and ask for MORE than the sealed tier so
    // discovery actually searches rather than early-returning as "already met".
    const probe = JSON.parse(JSON.stringify(brief));
    probe.knowledge_base.sealed = false;
    probe.knowledge_base.research = probe.knowledge_base.research || {};
    probe.knowledge_base.research.owner = "ai";
    probe.knowledge_base.research.allow_web = true;

    const sealedPaths = new Set((brief.knowledge_base.uploads || []).map((s) => s.path));
    const probeStandard = knowledgeBaseStandard(probe);
    // Nudge the floor up by one primary so discovery looks for something stronger
    // than what is already sealed, even when the sealed set technically "passes".
    const probeFloor = Object.assign({}, probeStandard, {
      ok: false,
      required_primary_sources: (probeStandard.required_primary_sources || 0) + 1
    });

    const discovery = await discoverKnowledgeBaseSources(probe, probeFloor);
    const found = (discovery.added_sources || []).filter(
      (s) => !sealedPaths.has(s.path) && s.trust === "primary"
    );
    if (!found.length) return null;

    return {
      kind: "knowledge_base_advancement",
      headline: `A stronger primary source surfaced after the knowledge base was sealed (${found.length} candidate${found.length === 1 ? "" : "s"}).`,
      detail: "This was found by a non-blocking background check. The class was built on the sealed knowledge base; nothing has changed. You may review and, if approved, fold this in to strengthen the class.",
      candidates: found,
      requires: "human_review_and_approval",
      execute_via: "Re-open the knowledge base at step 2, add the approved source, re-seal, and regenerate.",
      blocking: false
    };
  } catch (error) {
    // Non-blocking by contract: a failed probe must not affect the build.
    return null;
  }
}

async function resolveKnowledgeBase(brief) {
  const working = JSON.parse(JSON.stringify(brief));

  // SEAL SHORT-CIRCUIT. The knowledge base is resolved interactively at wizard
  // step 2 and SEALED by the human there. Once sealed, it is never re-litigated
  // downstream: we do not re-run discovery, we do not re-gate, we do not pause.
  // The human already made the call (build as-is, evidence-limited, or after
  // adding sources). The only thing that can ever reopen a sealed KB is a
  // human-approved "advancement opportunity" (see detectAdvancementOpportunity),
  // which arrives through its own door, never here.
  if (working.knowledge_base && working.knowledge_base.sealed) {
    const sealedStandard = knowledgeBaseStandard(working);
    return {
      resolution: "ready",
      brief: working,
      standard: sealedStandard,
      discovery: null,
      sealed: true,
      ladder: ["knowledge-base-sealed-by-human"]
    };
  }

  // Rung 0: already meets the selected floor.
  let standard = knowledgeBaseStandard(working);
  if (standard.ok) {
    return { resolution: "ready", brief: working, standard, discovery: null, ladder: ["floor-met-as-submitted"] };
  }

  const ladder = [];
  const owner = researchOwner(working);
  const webAllowed = working.knowledge_base && working.knowledge_base.research && working.knowledge_base.research.allow_web !== false;

  // Rung 1+2: auto-attempt discovery. Force AI research for this run if the
  // class did not already own it to the AI, so a creator-mode class still gets
  // a real attempt before anything escalates. The saved brief is untouched.
  let discovery = null;
  if (webAllowed && openAIKeyUsable()) {
    if (owner !== "ai") {
      working.knowledge_base.research = working.knowledge_base.research || {};
      working.knowledge_base.research.owner = "ai";
      ladder.push("forced-ai-research-for-recovery");
    }
    const prepared = await prepareKnowledgeBase(working);
    discovery = prepared.discovery;
    working.knowledge_base = prepared.brief.knowledge_base;
    ladder.push(`discovery-rounds:${(discovery && discovery.rounds) || 0}`);
    standard = knowledgeBaseStandard(working);
    if (standard.ok) {
      return { resolution: "ready", brief: working, standard, discovery, ladder };
    }
  } else {
    ladder.push(webAllowed ? "discovery-skipped-no-openai-key" : "discovery-skipped-web-disabled");
  }

  // Floor not met. We DO NOT block. Build the full analysis + recommendations and
  // return a single non-blocking review pause. The human decides whether to build.
  const metTier = highestMetTier(working);
  const scarcity = assessSourceScarcity(discovery, working);
  const changeOrder = buildChangeOrder(working, standard, discovery || {}, scarcity, (metTier && metTier.level !== standard.tier.level) ? metTier : null);

  return {
    resolution: "knowledge_base_review",
    brief: working,
    standard,
    discovery,
    offered_tier: (metTier && metTier.level !== standard.tier.level) ? metTier : null,
    requested_tier: standard.tier,
    change_order: changeOrder,
    scarcity,
    ladder: ladder.concat(["knowledge-base-review:awaiting-human-decision"]),
    message: changeOrder.recommendation.summary
  };
}

// Retained for reference / older callers: the previous blocking resolver shape.
// No longer used by the handler, which now treats KB as a non-blocking pause.
async function resolveKnowledgeBaseLegacy(brief) {
  const working = JSON.parse(JSON.stringify(brief));
  let standard = knowledgeBaseStandard(working);
  if (standard.ok) {
    return { resolution: "ready", brief: working, standard, discovery: null, ladder: ["floor-met-as-submitted"] };
  }
  const ladder = [];
  const owner = researchOwner(working);
  const webAllowed = working.knowledge_base && working.knowledge_base.research && working.knowledge_base.research.allow_web !== false;
  let discovery = null;
  if (webAllowed && openAIKeyUsable()) {
    if (owner !== "ai") {
      working.knowledge_base.research = working.knowledge_base.research || {};
      working.knowledge_base.research.owner = "ai";
      ladder.push("forced-ai-research-for-recovery");
    }
    const prepared = await prepareKnowledgeBase(working);
    discovery = prepared.discovery;
    working.knowledge_base = prepared.brief.knowledge_base;
    ladder.push(`discovery-rounds:${(discovery && discovery.rounds) || 0}`);
    standard = knowledgeBaseStandard(working);
    if (standard.ok) {
      return { resolution: "ready", brief: working, standard, discovery, ladder };
    }
  } else {
    ladder.push(webAllowed ? "discovery-skipped-no-openai-key" : "discovery-skipped-web-disabled");
  }

  const metTier = highestMetTier(working);
  const scarcity = assessSourceScarcity(discovery, working);
  const changeOrder = buildChangeOrder(working, standard, discovery || {}, scarcity, (metTier && metTier.level !== standard.tier.level) ? metTier : null);

  if (metTier && metTier.level !== standard.tier.level) {
    return {
      resolution: "change_order",
      sub_kind: "tier_offer",
      brief: working,
      standard,
      discovery,
      offered_tier: metTier,
      requested_tier: standard.tier,
      change_order: changeOrder,
      ladder: ladder.concat([`change-order:lower-tier:${metTier.level}`]),
      message: changeOrder.recommendation.summary
    };
  }

  if (scarcity.genuinely_scarce && standard.counts.total > 0) {
    return {
      resolution: "change_order",
      sub_kind: "evidence_limited",
      brief: working,
      standard,
      discovery,
      change_order: changeOrder,
      ladder: ladder.concat(["change-order:evidence-limited"]),
      message: changeOrder.recommendation.summary
    };
  }

  return {
    resolution: "needs_human",
    brief: working,
    standard,
    discovery,
    change_order: changeOrder,
    ladder: ladder.concat(["escalate-to-human"]),
    human_request: {
      headline: `I need ${standard.source_gap} more usable source(s)` +
        (standard.primary_source_gap ? ` including ${standard.primary_source_gap} primary` : "") +
        ` to build this at the ${standard.tier.label} bar.`,
      what_i_tried: (discovery && discovery.notes) || ["Automated source discovery was not available for this run."],
      gaps: (discovery && discovery.gaps) || [],
      rejected_sources: (discovery && discovery.rejected_sources) || [],
      your_options: changeOrder.recommendation.summary
        ? [changeOrder.recommendation.summary].concat([
            "Upload or paste a source document for the missing area.",
            "Point me at a specific URL (a standard, manufacturer guide, regulator page, or certification material)."
          ])
        : [
            "Upload or paste a source document for the missing area.",
            "Turn on AI-owned web research if it is currently off."
          ]
    }
  };
}

module.exports = {
  detectAdvancementOpportunity: detectAdvancementOpportunity,
  resolveKnowledgeBase: resolveKnowledgeBase,
  resolveKnowledgeBaseLegacy: resolveKnowledgeBaseLegacy
};
