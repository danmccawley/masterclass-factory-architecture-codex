// api/knowledge-base.js
//
// The interactive knowledge-base surface for wizard step 2. This is where the
// knowledge base is RESOLVED with the human and then SEALED. Once sealed, the
// generator never re-litigates it (see the seal short-circuit in
// resolveKnowledgeBase). The human is the only off-switch.
//
// Two modes:
//   mode: "review" (default) — run discovery + scoring and return the status,
//     score, analysis, and options. Nothing is sealed; nothing is generated.
//   mode: "seal" — apply the human's decision and return a SEALED brief the
//     wizard carries forward into generation. Decisions:
//       proceed_anyway            build as-is, evidence-limited if below floor
//       accept_tier  (+ tier)     seal at a chosen (usually lower) tier
//       add_sources  (+ sources)  fold approved sources in, then seal
//       as_is                     seal when the floor is already met
//       decline                   do NOT seal; the human wants to keep working
//
// This endpoint generates and publishes NOTHING. It only resolves and seals.

const generate = require("./generate.js");
const {
  knowledgeBaseStandard,
  resolveKnowledgeBase,
  readBody,
  safeErrorMessage,
  CLASS_TIERS
} = generate._internal;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

// Stamp a brief as sealed, capturing a snapshot of the standard/score at seal
// time so downstream stages can report what the human agreed to without ever
// recomputing or re-gating it.
function sealBrief(brief, note) {
  const sealed = JSON.parse(JSON.stringify(brief));
  sealed.knowledge_base = sealed.knowledge_base || {};
  const standard = knowledgeBaseStandard(sealed);
  sealed.knowledge_base.sealed = true;
  sealed.knowledge_base.seal = {
    at: new Date().toISOString(),
    by: "human",
    note: note || "",
    floor_met: Boolean(standard.ok),
    score: standard.score || null,
    tier: standard.tier ? standard.tier.label : null
  };
  return { sealed, standard };
}

module.exports = async function knowledgeBaseHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { ok: false, errors: ["Use POST with a class setup body."] });
    return;
  }

  try {
    const body = await readBody(req);
    const brief = body && body.brief ? body.brief : body;
    if (!brief || !brief.knowledge_base) {
      send(res, 422, { ok: false, errors: ["Missing class setup or knowledge_base in request body."] });
      return;
    }
    const mode = body && body.mode ? String(body.mode).toLowerCase() : "review";

    // ----- SEAL MODE -----
    if (mode === "seal") {
      const decision = body && body.decision ? String(body.decision).toLowerCase() : "as_is";
      const working = JSON.parse(JSON.stringify(brief));
      working.class_tier = working.class_tier || { level: (brief.class_tier && brief.class_tier.level) || "briefing" };

      if (decision === "decline") {
        send(res, 200, { ok: true, sealed: false, decision, message: "Knowledge base left open by human decision; keep working before sealing." });
        return;
      }

      if (decision === "add_sources") {
        const incoming = Array.isArray(body.sources) ? body.sources : [];
        working.knowledge_base.uploads = (working.knowledge_base.uploads || []).concat(incoming);
        const afterStandard = knowledgeBaseStandard(working);
        if (!afterStandard.ok) {
          // Still short after adding — flag evidence-limited so the seal still builds.
          working.class_tier.evidence_limited_ack = true;
          working.class_tier.evidence_limited_note = "Sealed after adding sources; still below the floor by human decision.";
        }
      } else if (decision === "accept_tier") {
        const tier = body && body.tier ? String(body.tier).toLowerCase() : null;
        if (tier && CLASS_TIERS[tier]) {
          working.class_tier = Object.assign({}, working.class_tier, { level: tier });
        }
        const tierStandard = knowledgeBaseStandard(working);
        if (!tierStandard.ok) {
          working.class_tier.evidence_limited_ack = true;
          working.class_tier.evidence_limited_note = `Sealed at ${tier || working.class_tier.level} below its source floor by human decision.`;
        }
      } else if (decision === "proceed_anyway") {
        const standardNow = knowledgeBaseStandard(working);
        if (!standardNow.ok) {
          working.class_tier.evidence_limited_ack = true;
          working.class_tier.evidence_limited_note = "Sealed and built by human decision below the source floor; scope and confidence are disclosed.";
        }
      } else {
        // "as_is": only valid when the floor is already met; otherwise stamp
        // evidence-limited so sealing still produces a buildable class.
        const standardNow = knowledgeBaseStandard(working);
        if (!standardNow.ok) {
          working.class_tier.evidence_limited_ack = true;
          working.class_tier.evidence_limited_note = "Sealed as-is by human decision below the source floor.";
        }
      }

      const { sealed, standard } = sealBrief(working, (working.class_tier && working.class_tier.evidence_limited_note) || "Sealed by human decision.");
      send(res, 200, {
        ok: true,
        sealed: true,
        decision,
        seal: sealed.knowledge_base.seal,
        score: standard.score || null,
        floor_met: Boolean(standard.ok),
        tier: standard.tier ? standard.tier.label : null,
        // The wizard carries this forward; its knowledge_base.sealed === true
        // makes the generator skip KB resolution entirely.
        brief: sealed,
        message: standard.ok
          ? "Knowledge base sealed. The floor is met; the class will build at full standard."
          : "Knowledge base sealed evidence-limited by your decision. The class will build and disclose that it is below the source floor."
      });
      return;
    }

    // ----- REVIEW MODE (default) -----
    const recovery = await resolveKnowledgeBase(brief);
    if (recovery.resolution === "ready") {
      const standard = recovery.standard;
      send(res, 200, {
        ok: true,
        status: "ready",
        floor_met: true,
        already_sealed: Boolean(recovery.sealed),
        score: (standard && standard.score) || null,
        tier: standard && standard.tier ? standard.tier.label : null,
        knowledge_standard: standard,
        discovery: recovery.discovery || null,
        recovery_ladder: recovery.ladder,
        message: recovery.sealed
          ? "Knowledge base is already sealed."
          : "The knowledge base meets the selected floor. Seal it to lock it in and move on."
      });
      return;
    }

    // Floor not met → present the interactive review (score + analysis + options).
    send(res, 200, {
      ok: true,
      status: "knowledge_base_review",
      floor_met: false,
      score: (recovery.change_order && recovery.change_order.score) || recovery.standard.score,
      options: (recovery.change_order && recovery.change_order.options) || [],
      change_order: recovery.change_order,
      offered_tier: recovery.offered_tier || null,
      requested_tier: recovery.requested_tier || recovery.standard.tier,
      knowledge_standard: recovery.standard,
      discovery: recovery.discovery || null,
      scarcity: recovery.scarcity || null,
      recovery_ladder: recovery.ladder,
      how_to_proceed: "Resolve it here: build anyway (sealed evidence-limited), pick a tier whose floor is met, add sources, or keep working. Then seal to move on.",
      message: recovery.message
    });
  } catch (error) {
    send(res, 500, { ok: false, errors: [safeErrorMessage(error && (error.message || error))] });
  }
};
