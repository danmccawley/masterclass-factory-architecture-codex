// api/kb-rounds.js
//
// One knowledge-base discovery ROUND, exposed so the wizard can build the KB
// incrementally and pause at a human checkpoint after each round (continue /
// narrow / accept). This is the engine behind the saturation-control panel.
//
// Design rules this file holds to:
//   * It performs NO discovery itself. The real discovery primitives from
//     generate.js (findSourceCandidates, normalizeDiscoveredSources,
//     fetchUrlText, scoreKnowledgeBase, knowledgeBaseStandard, sourceCounts,
//     classTierSpec) are INJECTED. In production knowledge-base.js passes the
//     real implementations; tests pass fakes. We never mirror generate.js
//     internals, so there is no drift.
//   * Round state (everything accepted + every dead URL so far) is carried in
//     the request body between rounds, so the endpoint stays stateless and
//     needs no KV/database.
//   * The new-sources-this-round count is the honest saturation signal: it is
//     the number of NEW verified sources, deduped by URL against everything
//     already accepted or already rejected in prior rounds. It cannot be
//     inflated, because duplicates are filtered before counting.
//   * Nothing here seals or generates. Accept is handled by the existing seal
//     path in knowledge-base.js, untouched.
"use strict";

function normPath(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function emptyState() {
  return { accepted: [], dead: [], rejected: [], rounds_run: 0, new_per_round: [] };
}

// A TRANSIENT failure is one worth one retry: an abort/timeout, a network blip,
// a 5xx, or a 429. A 404/410/"not found" is NOT transient — the resource is
// genuinely gone — and must never be retried or counted as transient. Callers
// may also flag a typed result/error explicitly with `.transient === true`.
function isTransient(err) {
  if (err && err.transient === true) return true;
  const m = (err && (err.message || String(err))) || "";
  if (/\b(404|410)\b|not found|gone/i.test(m)) return false;
  return /abort|aborted|timeout|timed out|network|fetch failed|socket|econn|etimedout|eai_again|\b5\d\d\b|\b429\b/i.test(m);
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Call an async provider with BOUNDED retry-with-backoff: one retry on a
// transient failure, then DEGRADE by returning a typed result. It never throws
// to the round — a provider hiccup can no longer collapse a round to 15/100.
async function callProviderWithRetry(fn, opts) {
  opts = opts || {};
  const retries = typeof opts.retries === "number" ? opts.retries : 1;
  const backoffMs = typeof opts.backoffMs === "number" ? opts.backoffMs : 400;
  let attempts = 0;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    attempts += 1;
    try {
      const value = await fn();
      return { ok: true, value: value, attempts: attempts, error: null, transient: false };
    } catch (e) {
      lastError = e;
      const transient = isTransient(e);
      if (!transient || attempt === retries) {
        return { ok: false, value: null, attempts: attempts, error: (e && (e.message || String(e))) || "provider failed", transient: transient };
      }
      if (backoffMs > 0) await delay(backoffMs * (attempt + 1));
    }
  }
  return { ok: false, value: null, attempts: attempts, error: (lastError && (lastError.message || String(lastError))) || "provider failed", transient: false };
}

// The never-dead-end menu for a round checkpoint. Every state — even zero
// sources — offers a real way forward. Tokens align with the seal path in
// knowledge-base.js (add_sources, proceed_anyway) and the rounds endpoint
// (search_again = run another round).
function buildRoundOptions() {
  return [
    { id: "search_again", label: "Run another discovery round.", token: "search_again" },
    { id: "add_source", label: "Add a source by hand (paste a URL or upload a document).", token: "add_sources" },
    { id: "accept_evidence_limited", label: "Accept and seal the knowledge base evidence-limited.", token: "proceed_anyway" }
  ];
}

// Tier-1 source-composition ledger: a line-by-line, auditable breakdown of the
// knowledge base from data the engine already has. It does NOT assert credibility
// scores it cannot back (that is the tier-2 reliability ledger, which needs claim
// extraction). Every row reports only what is observed: declared type, declared
// trust, and verification status. The rejected list is shown too, because what
// was thrown out (and why) is as much a part of an honest audit as what was kept.
function buildCompositionLedger(state, brief, primitives) {
  const P = primitives;
  const st = (state && Array.isArray(state.accepted)) ? state : emptyState();

  const after = JSON.parse(JSON.stringify(brief));
  after.knowledge_base = after.knowledge_base || {};
  const originalUploads = Array.isArray(after.knowledge_base.uploads) ? after.knowledge_base.uploads : [];
  after.knowledge_base.uploads = originalUploads.concat(st.accepted);

  const standard = P.knowledgeBaseStandard(after);
  const tier = P.classTierSpec(after);

  function verifyStatus(s) {
    if (s && s.fetched === true) return "verified (full text read)";
    if (s && s.reachable_only === true) return "reachable only (text not extractable \u2014 credibility unverified)";
    if (s && s.verified === true) return "verified";
    return "declared by class maker (not machine-verified)";
  }

  const sources = after.knowledge_base.uploads.map(function (s, i) {
    const trust = String((s && s.trust) || "unknown").toLowerCase();
    return {
      index: i + 1,
      path: (s && s.path) || "",
      type: (s && s.type) || "url",
      trust: trust,
      origin: st.accepted.indexOf(s) !== -1 ? "found by Bernard" : "added by class maker",
      verification: verifyStatus(s),
      // Honest caveat carried on every row until tier-2 lands:
      reliability_note: "Trust tier is as declared/classified; full credibility (authority, corroboration, bias, recency) is assessed in the reliability ledger."
    };
  });

  const counts = P.sourceCounts(after);
  const rejected = (st.rejected || []).map(function (r) {
    return { path: r.path, reason: r.reason || "did not pass verification" };
  });

  return {
    tier: tier.label,
    totals: {
      total: counts.total,
      primary: counts.primary,
      secondary: counts.secondary,
      unknown: counts.unknown,
      required_total: standard.required_sources,
      required_primary: standard.required_primary_sources,
      floor_met: Boolean(standard.floor_met)
    },
    verification_summary: {
      full_text: sources.filter(function (s) { return /full text/.test(s.verification); }).length,
      reachable_only: sources.filter(function (s) { return /reachable only/.test(s.verification); }).length,
      unverified: sources.filter(function (s) { return /not machine-verified/.test(s.verification); }).length,
      rejected: rejected.length
    },
    sources: sources,
    rejected: rejected,
    caveat: "This is the composition ledger: it reports source type, declared trust, and verification status only. First-hand vs primary vs secondary classification and per-source credibility scoring require the reliability ledger (claim-extraction build) and are not asserted here."
  };
}

// Build the same discovery prompt shape discoverKnowledgeBaseSources uses, so
// the injected findSourceCandidates behaves identically to the in-loop call.
function buildRoundPrompt(brief, standard, needed, roundIndex, acceptedPaths, deadPaths) {
  return JSON.stringify({
    task: "Find source candidates for this masterclass knowledge base. Return more candidates than needed so verification can reject weak or unreachable pages.",
    class_title: brief && brief.meta && brief.meta.title,
    selected_tier: standard.tier,
    needed,
    round: roundIndex + 1,
    current_sources: brief && brief.knowledge_base && brief.knowledge_base.uploads,
    already_accepted_urls: Array.from(acceptedPaths),
    already_rejected_urls: Array.from(deadPaths),
    seed_prompts: brief && brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.seed_prompts,
    recency_floor: brief && brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.recency_floor,
    rules: [
      "Use web search.",
      "Return only source candidates with URLs you actually found.",
      "Do NOT return any URL listed in already_accepted_urls or already_rejected_urls.",
      roundIndex > 0
        ? "Earlier rounds came up short. Broaden the search: adjacent terms, the governing body's own site, regional regulators, manufacturer documentation portals, certification curricula."
        : "Prefer source pages that can support teaching claims, procedures, hazards, standards, vocabulary, or assessment.",
      needed.primary_sources_needed > 0
        ? `Prioritize PRIMARY sources this round; ${needed.primary_sources_needed} more primary source(s) are required.`
        : "Mark primary only when the organization is the standard-setter, regulator, manufacturer, certification body, or direct publisher."
    ]
  }, null, 2);
}

// Decide the recommendation from the honest signals. The whole point of the
// control is that this is calibrated in BOTH directions: it must not push to
// continue when nothing new is coming, and it must not push to stop while the
// floor is unmet and rounds are still finding material.
function recommendationFor(floorMet, saturated, newThisRound) {
  if (floorMet) return newThisRound <= 2 ? "stop" : "narrow";
  // Floor not met: if a full round found nothing new, more searching will not
  // close the gap — that is a structural shortfall, so stop and let the human
  // decide (add sources manually / accept evidence-limited). Otherwise keep going.
  return saturated ? "stop" : "continue";
}

function recText(rec, floorMet, saturated, newThisRound) {
  if (rec === "continue") {
    return `Round added ${newThisRound} new verified source${newThisRound === 1 ? "" : "s"} and the floor is not yet met. Another round is still finding material.`;
  }
  if (rec === "narrow") {
    return "The source floor is met. Continuing only adds depth on the thinnest gaps, not coverage.";
  }
  if (floorMet) {
    return "The source floor is met and new sources have largely dried up. Accepting now is well supported.";
  }
  if (saturated) {
    return "A full round found no new verifiable sources. The remaining gap looks structural \u2014 more searching will not close it. Add a source by hand or accept evidence-limited.";
  }
  return "Review the checkpoint and decide.";
}

function buildRoundCheckpoint(args) {
  const score = args.score;
  const standard = args.standard;
  const floorMet = Boolean(standard.floor_met);
  const newThisRound = args.newThisRound;
  const degraded = Boolean(args.degraded);
  // A DEGRADED round (the provider failed transiently after a retry) has NOT
  // established saturation — we simply didn't get an answer. So it must not be
  // read as a structural dead-end: recommend continue, tag gaps closeable.
  const saturated = newThisRound === 0 && !degraded;
  const rec = recommendationFor(floorMet, saturated, newThisRound);

  const hasSources = standard.counts.total > 0;
  // Status the UI keys off. evidence_limited = zero sources present (the old
  // "bare 15" case) — now always paired with actionable options, never a wall.
  const status = !hasSources ? "evidence_limited" : (floorMet ? "floor_met" : "in_progress");

  const threads = (args.gaps || []).slice(0, 6).map(function (g) {
    return {
      name: String(g),
      gain: floorMet ? "low" : "medium",
      // If the floor is unmet AND the round genuinely saturated, the gap could
      // not be closed by searching this round -> structural; else closeable.
      type: (!floorMet && saturated) ? "structural" : "closeable"
    };
  });

  return {
    round: args.round,
    status: status,
    overall_score: score.score,
    band: score.band,
    components: score.components,
    new_claims: newThisRound,
    new_per_round: args.newPerRound.slice(),
    cumulative_sources: standard.counts.total,
    cumulative_primary: standard.counts.primary,
    required_sources: standard.required_sources,
    required_primary: standard.required_primary_sources,
    floor_met: floorMet,
    tier: args.tier.label,
    recommendation: rec,
    rec_text: degraded
      ? "A discovery provider timed out after a retry this round; no new sources were verified. This is a transient hiccup, not saturation — another round can still find material."
      : recText(rec, floorMet, saturated, newThisRound),
    degraded: degraded,
    // Always offer a way forward (never dead-end), and surface it prominently
    // when the round is evidence-limited.
    options: buildRoundOptions(),
    threads: threads,
    error: args.error || null
  };
}

// Run exactly one discovery round. Returns { checkpoint, state } where state is
// the updated round log to send back with the next round.
async function runKnowledgeBaseRound(opts) {
  opts = opts || {};
  const P = opts.primitives;
  const brief = opts.brief;
  const maxUrlChecks = opts.maxUrlChecks || 16;
  if (!P || !brief) throw new Error("runKnowledgeBaseRound: brief and primitives are required.");

  const state = (opts.state && Array.isArray(opts.state.accepted)) ? opts.state : emptyState();

  // Working brief = original uploads + everything accepted in prior rounds.
  const working = JSON.parse(JSON.stringify(brief));
  working.knowledge_base = working.knowledge_base || {};
  working.knowledge_base.uploads = (working.knowledge_base.uploads || []).concat(state.accepted);

  const standardBefore = P.knowledgeBaseStandard(working);
  const tier = P.classTierSpec(working);
  const countsBefore = P.sourceCounts(working);
  const needed = {
    total_sources_needed: Math.max(0, standardBefore.required_sources - countsBefore.total),
    primary_sources_needed: Math.max(0, standardBefore.required_primary_sources - countsBefore.primary)
  };

  const acceptedPaths = new Set((working.knowledge_base.uploads || []).map(function (s) { return normPath(s && s.path); }));
  const deadPaths = new Set((state.dead || []).map(normPath));
  const roundIndex = state.rounds_run;

  let newThisRound = 0;
  let gaps = [];
  let error = null;
  let degraded = false;

  // 1) DISCOVERY with bounded retry. A transient search failure (abort/timeout/
  //    5xx/429) is retried once, then degrades to a typed result — it never
  //    throws to the round, so a provider hiccup cannot zero the score.
  const prompt = buildRoundPrompt(brief, standardBefore, needed, roundIndex, acceptedPaths, deadPaths);
  const search = await callProviderWithRetry(
    function () { return P.findSourceCandidates(prompt, working, standardBefore, needed); },
    { retries: typeof opts.retries === "number" ? opts.retries : 1, backoffMs: typeof opts.backoffMs === "number" ? opts.backoffMs : 400 }
  );

  if (!search.ok) {
    // Provider failed after the retry. Degrade — keep prior-round accepted
    // sources (state.accepted), score whatever exists, and surface a transient
    // note. NOT a structural dead-end.
    degraded = true;
    error = search.error;
  } else {
    try {
      const researched = search.value;
      gaps = (researched && researched.data && Array.isArray(researched.data.gaps)) ? researched.data.gaps : [];

      const seen = Array.from(acceptedPaths).concat(Array.from(deadPaths));
      const candidates = P.normalizeDiscoveredSources(researched && researched.data, seen)
        .filter(function (c) { return !acceptedPaths.has(normPath(c.path)) && !deadPaths.has(normPath(c.path)); });

      const target = Math.max(needed.total_sources_needed + 4, needed.primary_sources_needed + 2, 8);
      const toCheck = candidates.slice(0, Math.min(maxUrlChecks, target + 4));

      // 2) VERIFY with Promise.allSettled so a single fetch abort/timeout cannot
      //    discard the sources that DID verify this round (partial = success).
      const settled = await Promise.allSettled(toCheck.map(function (c) { return P.fetchUrlText(c.path); }));
      settled.forEach(function (res, idx) {
        const c = toCheck[idx];
        const fetched = res.status === "fulfilled"
          ? res.value
          : { ok: false, transient: true, error: (res.reason && (res.reason.message || String(res.reason))) || "fetch failed" };
        if (fetched && fetched.ok) {
          state.accepted.push(Object.assign({}, c, {
            fetched: Boolean(fetched.text),
            reachable_only: Boolean(fetched.reachable_only)
          }));
          acceptedPaths.add(normPath(c.path));
          newThisRound += 1;
        } else if (fetched && fetched.transient) {
          // Transient fetch failure: do NOT blacklist the URL — a later round
          // can retry it. It simply did not verify this round.
        } else {
          deadPaths.add(normPath(c.path));
          state.rejected = state.rejected || [];
          if (!state.rejected.some(function (r) { return normPath(r.path) === normPath(c.path); })) {
            state.rejected.push({ path: c.path, reason: (fetched && fetched.error) || "did not pass the readability/reachability check" });
          }
        }
      });
    } catch (e) {
      // Defensive: any unexpected processing error degrades, never throws.
      degraded = true;
      error = (e && (e.message || String(e))) || "Discovery round failed.";
    }
  }

  state.rounds_run = roundIndex + 1;
  state.new_per_round = (state.new_per_round || []).concat(newThisRound);
  state.dead = Array.from(deadPaths);

  // Cumulative score AFTER this round.
  const after = JSON.parse(JSON.stringify(brief));
  after.knowledge_base = after.knowledge_base || {};
  after.knowledge_base.uploads = (after.knowledge_base.uploads || []).concat(state.accepted);
  const score = P.scoreKnowledgeBase(after);
  const standardAfter = P.knowledgeBaseStandard(after);

  const checkpoint = buildRoundCheckpoint({
    round: state.rounds_run,
    score: score,
    standard: standardAfter,
    newThisRound: newThisRound,
    newPerRound: state.new_per_round,
    gaps: gaps,
    tier: tier,
    degraded: degraded,
    error: error
  });

  return { checkpoint: checkpoint, state: state };
}

module.exports = {
  runKnowledgeBaseRound: runKnowledgeBaseRound,
  buildRoundCheckpoint: buildRoundCheckpoint,
  buildCompositionLedger: buildCompositionLedger,
  recommendationFor: recommendationFor,
  buildRoundOptions: buildRoundOptions,
  callProviderWithRetry: callProviderWithRetry,
  emptyState: emptyState,
  _normPath: normPath,
  _isTransient: isTransient
};
