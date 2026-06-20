// api/remediate.js
//
// On-demand knowledge-base remediation. Given a class setup that failed the
// source floor, this runs Bernard's discovery pass and returns VERIFIED source
// candidates for the class maker to approve into the brief. It does NOT generate
// or publish anything, and it does NOT mutate the saved brief.
//
// Unlike /api/generate, this endpoint runs discovery regardless of the brief's
// research owner: it temporarily forces AI-owned research for this single call
// so a creator/assisted-mode class can still ask "have Bernard try" from the
// tracker's failure screen. The human still approves the results before
// re-running the generator, so the human-in-the-loop contract is preserved.

const generate = require("./generate.js");
const {
  knowledgeBaseStandard,
  discoverKnowledgeBaseSources,
  sourceCounts,
  readBody,
  safeErrorMessage
} = generate._internal;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

module.exports = async function remediateHandler(req, res) {
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

    // Work on a deep copy. Force AI-owned, web-enabled research for this call
    // only — the caller's saved brief is never changed here.
    const probe = JSON.parse(JSON.stringify(brief));
    probe.knowledge_base.research = probe.knowledge_base.research || {};
    const originalOwner = probe.knowledge_base.research.owner || "creator";
    probe.knowledge_base.research.owner = "ai";
    probe.knowledge_base.research.allow_web = true;

    const standard = knowledgeBaseStandard(probe);
    const before = sourceCounts(probe);

    if (standard.ok) {
      send(res, 200, {
        ok: true,
        already_met: true,
        tier: standard.tier.label,
        before: { total: before.total, primary: before.primary },
        required: { total: standard.required_sources, primary: standard.required_primary_sources },
        added_sources: [],
        notes: ["The knowledge base already meets the selected source floor; no remediation needed."]
      });
      return;
    }

    const discovery = await discoverKnowledgeBaseSources(probe, standard);
    const added = discovery.added_sources || [];

    // What the brief would look like if the class maker accepts every added source.
    const proposedUploads = (probe.knowledge_base.uploads || []).concat(added);
    const afterStandard = knowledgeBaseStandard({
      ...probe,
      knowledge_base: { ...probe.knowledge_base, uploads: proposedUploads }
    });

    send(res, 200, {
      ok: true,
      already_met: false,
      tier: standard.tier.label,
      original_research_owner: originalOwner,
      before: { total: before.total, primary: before.primary },
      required: { total: standard.required_sources, primary: standard.required_primary_sources },
      rounds: discovery.rounds || 0,
      // Paste these into knowledge_base.uploads after review, then re-run /api/generate.
      added_sources: added,
      rejected_sources: discovery.rejected_sources || [],
      gaps: discovery.gaps || [],
      notes: discovery.notes || [],
      would_meet_standard: afterStandard.ok,
      remaining_message: afterStandard.ok ? null : afterStandard.messages.join(" ")
    });
  } catch (error) {
    send(res, 500, { ok: false, errors: [safeErrorMessage(error && (error.message || error))] });
  }
};
