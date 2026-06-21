// api/kb-objectives.js
//
// Per-objective knowledge-base saturation (spec §3). Saturation is judged for
// EACH terminal/enabling objective, then rolled up "weakest objective gates the
// class" — not averaged. A class with one unsupported objective is not done,
// however rich the rest.
//
// HONEST SCOPE. Truly knowing which sources bear on which objective is the
// claim-extraction layer (an LLM read of each source — network + keys, built
// later). So the relevance mapper is INJECTED, exactly like the round engine's
// discovery primitives:
//   * Production (later): a semantic/claim-based mapper from the extraction step.
//   * Now / default: a TRANSPARENT keyword-overlap proxy, clearly labeled. It is
//     a real (if crude) signal, never a fabricated one, and it is replaced — not
//     patched — when claim extraction lands.
//
// Objective IDENTITY lives here, in the saturation layer, NOT in the validated
// brief (objectives stay flat strings; the validator and generate.js are
// untouched). id = stable hash of the normalized objective text, with the text
// carried alongside so re-linking after a rewrite is possible.
"use strict";

// --- identity -------------------------------------------------------------
function normalizeText(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

// Small stable non-crypto hash (djb2). Deterministic id for an objective string.
function objectiveId(textValue) {
  const s = normalizeText(textValue);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "obj_" + h.toString(36);
}

// --- relevance: default proxy mapper -------------------------------------
const STOP = new Set(["the", "a", "an", "of", "to", "and", "or", "for", "in", "on",
  "with", "by", "is", "are", "be", "as", "at", "from", "that", "this", "it", "how",
  "what", "why", "when", "use", "using", "into", "their", "they", "you", "your"]);

function tokens(s) {
  return normalizeText(s).split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && !STOP.has(w); });
}

// Registrable-ish domain from a URL, for independence checks. Crude eTLD+1.
function domainOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/]+)/i);
  if (!m) return String(url || "").toLowerCase();
  const host = m[1].toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

// Transparent keyword-overlap relevance in [0,1]: share of an objective's
// content words that appear in the source's title/path/type. A PROXY for real
// source→objective relevance, not semantic understanding.
function keywordOverlapMapper(objectiveText, source) {
  const objToks = tokens(objectiveText);
  if (!objToks.length) return 0;
  const hay = new Set(tokens([(source && source.title) || "", (source && source.path) || "", (source && source.type) || ""].join(" ")));
  let hit = 0;
  objToks.forEach(function (t) { if (hay.has(t)) hit += 1; });
  return hit / objToks.length;
}

// --- per-objective read ---------------------------------------------------
// status ladder (no fake numbers): uncovered < thin < supported < corroborated.
// "structural" is only asserted when the caller says the rounds have saturated
// AND the objective is still thin/uncovered — i.e. more searching won't help.
function readObjective(objectiveText, kind, sources, opts) {
  const mapper = opts.mapper;
  const threshold = typeof opts.relevanceThreshold === "number" ? opts.relevanceThreshold : 0.34;
  const corroborationMin = opts.corroborationMin || 2;

  const supporting = [];
  (sources || []).forEach(function (s) {
    const rel = mapper(objectiveText, s);
    if (rel >= threshold) supporting.push(Object.assign({ _rel: Math.round(rel * 100) / 100 }, s));
  });

  const domains = {};
  supporting.forEach(function (s) { domains[domainOf(s.path)] = true; });
  const independentDomains = Object.keys(domains).length;
  const primaryCount = supporting.filter(function (s) { return String(s.trust || "").toLowerCase() === "primary"; }).length;

  let status;
  if (supporting.length === 0) status = "uncovered";
  else if (independentDomains >= corroborationMin) status = "corroborated";
  else if (supporting.length >= 1) status = "thin"; // supported but single-origin
  else status = "thin";

  const saturated = Boolean(opts.saturated);
  const structural = saturated && (status === "uncovered" || status === "thin");

  return {
    id: objectiveId(objectiveText),
    text: objectiveText,
    kind: kind, // "terminal" | "enabling"
    supporting_sources: supporting.length,
    independent_domains: independentDomains,
    primary_sources: primaryCount,
    corroborated: independentDomains >= corroborationMin,
    status: status,
    // structural = more searching will not close this gap (rounds already dry).
    gap_kind: status === "uncovered" || status === "thin" ? (structural ? "structural" : "closeable") : null,
    supporting_source_paths: supporting.map(function (s) { return s.path; })
  };
}

// --- rollup: weakest objective gates the class ---------------------------
const STATUS_RANK = { uncovered: 0, thin: 1, supported: 2, corroborated: 3 };

function buildObjectiveSaturation(objectives, sources, opts) {
  opts = opts || {};
  const mapper = opts.mapper || keywordOverlapMapper;
  const o = objectives || {};
  const terminal = Array.isArray(o.terminal) ? o.terminal : [];
  const enabling = Array.isArray(o.enabling) ? o.enabling : [];

  const readOpts = {
    mapper: mapper,
    relevanceThreshold: opts.relevanceThreshold,
    corroborationMin: opts.corroborationMin,
    saturated: opts.saturated
  };

  const reads = []
    .concat(terminal.map(function (t) { return readObjective(t, "terminal", sources, readOpts); }))
    .concat(enabling.map(function (e) { return readObjective(e, "enabling", sources, readOpts); }));

  // Weakest objective gates the class.
  let weakest = null;
  reads.forEach(function (r) {
    if (weakest === null || STATUS_RANK[r.status] < STATUS_RANK[weakest.status]) weakest = r;
  });

  const counts = {
    total: reads.length,
    corroborated: reads.filter(function (r) { return r.status === "corroborated"; }).length,
    thin: reads.filter(function (r) { return r.status === "thin"; }).length,
    uncovered: reads.filter(function (r) { return r.status === "uncovered"; }).length,
    structural_gaps: reads.filter(function (r) { return r.gap_kind === "structural"; }).length
  };

  // Class is "ready" only when every objective is at least corroborated.
  const classStatus = reads.length === 0 ? "no_objectives" : (weakest ? weakest.status : "uncovered");

  return {
    objectives: reads,
    rollup: {
      class_status: classStatus,
      gated_by: weakest ? { id: weakest.id, kind: weakest.kind, status: weakest.status, text: weakest.text } : null,
      counts: counts
    },
    mapper_kind: mapper === keywordOverlapMapper ? "keyword-overlap-proxy" : "injected",
    caveat: mapper === keywordOverlapMapper
      ? "Per-objective coverage uses a keyword-overlap PROXY for source relevance. It is a transparent heuristic, not semantic understanding; real source\u2192objective mapping arrives with the claim-extraction build and will replace it."
      : "Per-objective coverage uses an injected relevance mapper."
  };
}

module.exports = {
  buildObjectiveSaturation: buildObjectiveSaturation,
  readObjective: readObjective,
  keywordOverlapMapper: keywordOverlapMapper,
  objectiveId: objectiveId,
  domainOf: domainOf,
  _tokens: tokens
};
