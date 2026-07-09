"use strict";

function classifySource(source) {
  const text = [source.title, source.publisher, source.locator].join(" ").toLowerCase();
  if (/\.gov|\.edu|standard|iso|ansi|ieee|osha|nist|official|manual|specification/.test(text)) return "primary";
  if (/journal|research|white paper|report|association|institute/.test(text)) return "secondary";
  return "unknown";
}

function verifySources(researchResult, context) {
  const log = context && context.log ? context.log : function () {};
  const verified = [];
  const rejected = [];
  (researchResult.candidates || []).forEach(function (source, index) {
    const trust = classifySource(source);
    const notes = Array.isArray(source.verification_notes) ? source.verification_notes.slice() : [];
    if (!source.locator || source.verification_status === "rejected") {
      rejected.push(Object.assign({}, source, { verification_status: "rejected", verification_notes: notes.concat("No usable locator.") }));
      return;
    }
    verified.push(Object.assign({}, source, {
      id: source.id || "source-" + (index + 1),
      credibility_rank: source.credibility_rank === "unknown" && trust !== "unknown" ? "high" : source.credibility_rank,
      reliability_rank: source.reliability_rank === "unknown" && trust !== "unknown" ? "high" : source.reliability_rank,
      verification_status: "verified",
      verification_notes: notes.concat("Verified as a usable " + trust + " source candidate."),
      trust_tier: trust
    }));
  });
  const primaryCount = verified.filter(function (source) { return source.trust_tier === "primary"; }).length;
  const floor = researchResult.floor || { sources: 12, primary: 3 };
  const standard = {
    ok: verified.length >= floor.sources && primaryCount >= floor.primary,
    verified_sources: verified.length,
    primary_sources: primaryCount,
    source_gap: Math.max(0, floor.sources - verified.length),
    primary_source_gap: Math.max(0, floor.primary - primaryCount)
  };
  log({ stage: "source-verification", message: standard.ok ? "Knowledge base source standard met." : "Knowledge base source standard needs operator action.", standard: standard });
  return { verified: verified, rejected: rejected, standard: standard };
}

module.exports = { verifySources: verifySources, classifySource: classifySource };
