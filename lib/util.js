// lib/util.js
//
// Shared, general-purpose helpers extracted from api/generate.js (Sprint 3,
// step 5 — behavior-preserving). These are the genuinely cross-cutting, self-
// contained helpers that the generator, the renderers (lib/renderers/*), and the
// publish layer (lib/publish/*) all lean on. They were previously defined inline
// in generate.js and either used directly or hand-injected as a deps object into
// the earlier extracted modules; this module is now their single home.
//
// STRICTLY behavior-preserving: every function body and every constant is moved
// verbatim from generate.js. Nothing here computes anything differently. The
// move is gated by test/golden/golden.test.js (byte-identical generate output)
// plus the full suite, which exercises most of these via generate.js's
// `_internal` re-export (kept intact so tests still run the real code).
//
// The cluster is self-contained: every identifier referenced inside is defined
// here or is a JS/Node global (String, Math, Number, process, etc.). No requires
// back into generate.js, so there is no circular dependency.
"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_GENERATED_SLIDES = 400;
const MIN_MASTERCLASS_SLIDES = 30;
const MIN_COMPLEX_MASTERCLASS_SLIDES = 50;
const DEFAULT_MASTERCLASS_SLIDES = 90;

const CLASS_TIERS = {
  briefing: {
    label: "Quick briefing",
    source_floor: 4,
    primary_source_floor: 1,
    slide_floor: 30,
    standard: "Short, source-aware orientation. Useful for overviews, not full mastery."
  },
  standard: {
    label: "Standard class",
    source_floor: 8,
    primary_source_floor: 2,
    slide_floor: 40,
    standard: "Solid internal training with enough evidence for reliable instruction."
  },
  professional: {
    label: "Professional masterclass",
    source_floor: 12,
    primary_source_floor: 3,
    slide_floor: 60,
    standard: "Default quality bar for serious workplace learning and strong source discipline."
  },
  expert: {
    label: "Expert / safety-critical masterclass",
    source_floor: 18,
    primary_source_floor: 5,
    slide_floor: 90,
    standard: "Highest bar for technical, safety, compliance, infrastructure, or high-risk classes."
  }
};

// ---------------------------------------------------------------------------
// String / escaping helpers
// ---------------------------------------------------------------------------

function html(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attr(value) {
  return html(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function text(value, fallback) {
  const cleaned = String(value == null ? "" : value).trim();
  return cleaned || fallback || "";
}

function list(value, fallback, maxItems) {
  const items = Array.isArray(value) ? value : [];
  const cleaned = items.map((item) => text(item)).filter(Boolean);
  const usable = cleaned.length ? cleaned : fallback || [];
  return usable.slice(0, maxItems || 12);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? Math.trunc(number) : fallback;
  return Math.max(min, Math.min(max, safe));
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "masterclass";
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function baseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = (req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";
  if (!host) return "";
  const normalizedHost = String(host).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const protocol = /localhost|127\.0\.0\.1/.test(normalizedHost) ? "http" : "https";
  return `${protocol}://${normalizedHost}`;
}

// ---------------------------------------------------------------------------
// Class tier + knowledge-base scoring
// ---------------------------------------------------------------------------

function classTierKey(brief) {
  const key = text(brief && brief.class_tier && brief.class_tier.level, "professional").toLowerCase();
  return CLASS_TIERS[key] ? key : "professional";
}

function classTierSpec(brief) {
  const key = classTierKey(brief);
  return Object.assign({ level: key }, CLASS_TIERS[key]);
}

function sourceCounts(brief) {
  const uploads = Array.isArray(brief && brief.knowledge_base && brief.knowledge_base.uploads)
    ? brief.knowledge_base.uploads
    : [];
  const primary = uploads.filter((source) => text(source && source.trust, "").toLowerCase() === "primary").length;
  const secondary = uploads.filter((source) => text(source && source.trust, "").toLowerCase() === "secondary").length;
  const unknown = uploads.filter((source) => text(source && source.trust, "").toLowerCase() === "unknown").length;
  return { total: uploads.length, primary, secondary, unknown };
}

// Who owns closing source gaps for this class: "creator" (the human supplies
// sources), "assisted", or "ai" (Bernard researches). A shared brief accessor —
// used by the research engine AND by rendering/objectives/handler code.
function researchOwner(brief) {
  const owner = text(brief && brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.owner, "creator").toLowerCase();
  return ["creator", "assisted", "ai"].includes(owner) ? owner : "creator";
}

// Blended knowledge-base quality score (0-100). Turns the binary floor gate
// into a graded assessment so the human gets a real read on what was built, not
// just pass/fail. Three weighted components:
//   Coverage  (50%) — how well counts meet the tier floor (total + primary)
//   Authority (30%) — quality of sources (primary>secondary>unknown; verifiable text bonus)
//   Recency   (20%) — share of sources within the brief's recency floor
function recencyFloorYear(brief) {
  const raw = text(brief && brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.recency_floor, "");
  const m = raw.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function sourceYear(source) {
  const candidates = [source && source.published, source && source.date, source && source.year, source && source.updated];
  for (const c of candidates) {
    const m = String(c == null ? "" : c).match(/(\d{4})/);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

function scoreKnowledgeBase(brief) {
  const tier = classTierSpec(brief);
  const counts = sourceCounts(brief);
  const uploads = Array.isArray(brief && brief.knowledge_base && brief.knowledge_base.uploads)
    ? brief.knowledge_base.uploads
    : [];

  // Coverage: how close to the floor (capped at 1 each), averaged.
  const totalCov = tier.source_floor ? Math.min(1, counts.total / tier.source_floor) : 1;
  const primaryCov = tier.primary_source_floor ? Math.min(1, counts.primary / tier.primary_source_floor) : 1;
  const coverage = (totalCov + primaryCov) / 2;

  // Authority: weight each source by trust, with a bonus for fetchable text.
  let authPoints = 0;
  let authMax = 0;
  uploads.forEach((s) => {
    const trust = text(s && s.trust, "unknown").toLowerCase();
    const base = trust === "primary" ? 1 : trust === "secondary" ? 0.6 : 0.3;
    const verifiable = (s && (s.fetched === true || s.verified === true)) ? 0.15 : 0;
    authPoints += Math.min(1, base + verifiable);
    authMax += 1;
  });
  const authority = authMax ? authPoints / authMax : 0;

  // Recency: share of dated sources at/after the recency floor. If no floor or
  // no dates are known, treat recency as neutral (does not penalize).
  const floorYear = recencyFloorYear(brief);
  let dated = 0;
  let fresh = 0;
  uploads.forEach((s) => {
    const y = sourceYear(s);
    if (y) { dated += 1; if (!floorYear || y >= floorYear) fresh += 1; }
  });
  const recency = dated ? fresh / dated : 0.75; // neutral-ish when unknown

  const score = Math.round((coverage * 0.5 + authority * 0.3 + recency * 0.2) * 100);
  const band = score >= 85 ? "excellent" : score >= 70 ? "strong" : score >= 55 ? "usable" : "thin";

  return {
    score,
    band,
    components: {
      coverage: Math.round(coverage * 100),
      authority: Math.round(authority * 100),
      recency: Math.round(recency * 100)
    },
    weights: { coverage: 0.5, authority: 0.3, recency: 0.2 },
    detail: {
      total: counts.total,
      primary: counts.primary,
      secondary: counts.secondary,
      required_total: tier.source_floor,
      required_primary: tier.primary_source_floor,
      dated_sources: dated,
      recency_floor_year: floorYear || null
    },
    summary: `Knowledge-base score ${score}/100 (${band}): ` +
      `coverage ${Math.round(coverage * 100)}, authority ${Math.round(authority * 100)}, recency ${Math.round(recency * 100)}. ` +
      `${counts.total}/${tier.source_floor} sources, ${counts.primary}/${tier.primary_source_floor} primary.`
  };
}

function knowledgeBaseStandard(brief) {
  const tier = classTierSpec(brief);
  const counts = sourceCounts(brief);
  const sourceGap = Math.max(0, tier.source_floor - counts.total);
  const primaryGap = Math.max(0, tier.primary_source_floor - counts.primary);
  const floorMet = sourceGap === 0 && primaryGap === 0;

  // A human can approve an "evidence-limited" change order for genuinely scarce
  // topics. When that acknowledgment is present, the floor is treated as waived
  // by explicit human decision — the gate passes but the result is flagged so the
  // class and every downstream report disclose the scarcity. This is the ONLY way
  // the floor is ever bypassed, and it always leaves a visible trail.
  const evidenceLimited = Boolean(brief && brief.class_tier && brief.class_tier.evidence_limited_ack) && !floorMet;
  const ok = floorMet || evidenceLimited;

  const messages = [];
  if (evidenceLimited) {
    messages.push(`Evidence-limited class approved by change order: built on ${counts.total} verified source${counts.total === 1 ? "" : "s"} (${counts.primary} primary), below the ${tier.label} floor of ${tier.source_floor}/${tier.primary_source_floor}. Scope and confidence are disclosed in the class.`);
  } else {
    if (sourceGap) messages.push(`Add ${sourceGap} more usable source${sourceGap === 1 ? "" : "s"} to meet the ${tier.label} source floor.`);
    if (primaryGap) messages.push(`Add ${primaryGap} more primary source${primaryGap === 1 ? "" : "s"} to meet the ${tier.label} primary-source floor.`);
    if (!messages.length) messages.push(`Knowledge base meets the selected ${tier.label} floor.`);
  }
  return {
    ok,
    floor_met: floorMet,
    evidence_limited: evidenceLimited,
    tier,
    counts,
    score: scoreKnowledgeBase(brief),
    required_sources: tier.source_floor,
    required_primary_sources: tier.primary_source_floor,
    source_gap: sourceGap,
    primary_source_gap: primaryGap,
    messages
  };
}

// ---------------------------------------------------------------------------
// Slide budget
// ---------------------------------------------------------------------------

function slideBudgetFloor(brief) {
  const tier = classTierSpec(brief);
  const minutes = Number(brief && brief.length && brief.length.minutes) || 0;
  const mastery = Number(brief && brief.mastery && brief.mastery.target_level) || 0;
  const deepDive = text(brief && brief.mastery && brief.mastery.deep_dive_density, "").toLowerCase();
  const titleWords = text(brief && brief.meta && brief.meta.title, "").split(/\s+/).filter(Boolean).length;
  const sourceCount = arrayLength(brief && brief.knowledge_base && brief.knowledge_base.uploads) +
    arrayLength(brief && brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.seed_prompts);
  const objectiveCount = arrayLength(brief && brief.objectives && brief.objectives.terminal) +
    arrayLength(brief && brief.objectives && brief.objectives.enabling);
  const profile = [
    brief && brief.audience && brief.audience.average && brief.audience.average.technical,
    brief && brief.audience && brief.audience.floor && brief.audience.floor.technical,
    brief && brief.audience && brief.audience.average && brief.audience.average.background,
    brief && brief.audience && brief.audience.floor && brief.audience.floor.background,
    brief && brief.audience && brief.audience.average && brief.audience.average.role,
    brief && brief.audience && brief.audience.floor && brief.audience.floor.role,
    brief && brief.meta && brief.meta.title
  ].map((item) => text(item, "").toLowerCase()).join(" ");
  const complex = minutes >= 45 ||
    mastery >= 3 ||
    deepDive === "med" || deepDive === "high" ||
    titleWords >= 5 ||
    sourceCount >= 2 ||
    objectiveCount >= 3 ||
    /technical|fiber|data center|construction|engineer|safety|install|installation|network|electrical|mechanical|medical|legal|finance|compliance|operations/.test(profile);
  const complexityFloor = complex ? MIN_COMPLEX_MASTERCLASS_SLIDES : MIN_MASTERCLASS_SLIDES;
  return Math.max(complexityFloor, tier.slide_floor);
}

function totalSlideTarget(brief) {
  const floor = slideBudgetFloor(brief);
  const requested = brief && brief.length && brief.length.slide_budget;
  const hasExplicit = requested !== undefined && requested !== null && requested !== "" && Number.isFinite(Number(requested));
  if (hasExplicit) {
    // The human explicitly chose a slide count — honor it, down to 1. The floor
    // is a recommended default, not a hard wall. A below-floor request still
    // builds; slideBudgetWarning() discloses that it is below the usual depth.
    return clampInteger(requested, 1, MAX_GENERATED_SLIDES, Math.max(DEFAULT_MASTERCLASS_SLIDES, floor));
  }
  // No explicit budget: fall back to the recommended floor/default.
  return clampInteger(requested, floor, MAX_GENERATED_SLIDES, Math.max(DEFAULT_MASTERCLASS_SLIDES, floor));
}

// ---------------------------------------------------------------------------
// Deep dives
// ---------------------------------------------------------------------------

function deepDiveMode(brief) {
  return text(brief && brief.mastery && brief.mastery.deep_dive_density, "med").toLowerCase();
}

function wantsDeepDives(brief) {
  const mode = deepDiveMode(brief);
  if (mode === "low") return false;
  if (mode === "high") return true;
  return Number(brief.length && brief.length.minutes) >= 45 ||
    Number(brief.length && brief.length.slide_budget) >= 40 ||
    text(brief.mastery && brief.mastery.granularity) === "deep";
}

module.exports = {
  // constants
  MAX_GENERATED_SLIDES: MAX_GENERATED_SLIDES,
  MIN_MASTERCLASS_SLIDES: MIN_MASTERCLASS_SLIDES,
  MIN_COMPLEX_MASTERCLASS_SLIDES: MIN_COMPLEX_MASTERCLASS_SLIDES,
  DEFAULT_MASTERCLASS_SLIDES: DEFAULT_MASTERCLASS_SLIDES,
  CLASS_TIERS: CLASS_TIERS,
  // string / escaping
  html: html,
  attr: attr,
  text: text,
  list: list,
  clampInteger: clampInteger,
  arrayLength: arrayLength,
  slugify: slugify,
  isUrl: isUrl,
  stripHtml: stripHtml,
  baseUrl: baseUrl,
  // tier + kb scoring
  classTierKey: classTierKey,
  classTierSpec: classTierSpec,
  sourceCounts: sourceCounts,
  researchOwner: researchOwner,
  recencyFloorYear: recencyFloorYear,
  sourceYear: sourceYear,
  scoreKnowledgeBase: scoreKnowledgeBase,
  knowledgeBaseStandard: knowledgeBaseStandard,
  // slide budget
  slideBudgetFloor: slideBudgetFloor,
  totalSlideTarget: totalSlideTarget,
  // deep dives
  deepDiveMode: deepDiveMode,
  wantsDeepDives: wantsDeepDives
};
