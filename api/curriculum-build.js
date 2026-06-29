/* ============================================================================
   curriculum-build.js — Fan-out orchestration for building a curriculum's
   classes, plus the persistence/status endpoint.
   ----------------------------------------------------------------------------
   Generation is long per class, and serverless invocations are time-bounded,
   so fan-out is CLIENT-orchestrated: the curriculum view builds one class at a
   time through the existing /api/generate (each its own request), and reports
   the result back here to update the manifest's per-class status. This file
   answers "what order, and what's next?" (pure, tested) and persists state.

   Endpoint:
     GET  ?slug=...            -> { manifest, progress, coherence, next }
     POST { action:"save", manifest|plan, input? } -> { manifest, coherence }
     POST { action:"status", slug, class, status, class_url? } -> { progress, next }
============================================================================ */

const store = require("./curriculum-store.js");
const coherence = require("./curriculum-coherence.js");
const bib = require("./curriculum-bibliography.js");
const briefTemplate = require("../brief.template.json");

// Per-tier slide floors (mirror api/generate.js CLASS_TIERS.slide_floor) and the
// band above the floor that bounds the minutes*density slide budget. Kept local
// so the curriculum path stays decoupled from the generate monolith. Clamp =
// [floor, floor + SANE_SLIDE_BAND]; density scales the count within that band.
const TIER_SLIDE_FLOOR = { briefing: 30, standard: 40, professional: 60, expert: 90 };
const SANE_SLIDE_BAND = 20;

/* --------------------------------------------------------------------------
   Pure: dependency-ordered build sequence (Kahn topological sort).
   Prerequisites build before dependents; ties broken by the class order field.
   A cycle can't be ordered — those classes are appended last (coherence flags
   the cycle separately; we never dead-end the sequence).
-------------------------------------------------------------------------- */

function buildOrder(manifest) {
  var classes = (manifest && manifest.classes) || [];
  var bySlug = {};
  classes.forEach(function (c) { bySlug[c.slug] = c; });

  var indeg = {};
  var dependents = {};
  classes.forEach(function (c) { indeg[c.slug] = 0; dependents[c.slug] = []; });
  classes.forEach(function (c) {
    (c.prerequisites || []).forEach(function (p) {
      if (bySlug[p]) { indeg[c.slug] += 1; dependents[p].push(c.slug); }
    });
  });

  function byOrder(a, b) { return (bySlug[a].order || 0) - (bySlug[b].order || 0); }

  var ready = classes.filter(function (c) { return indeg[c.slug] === 0; }).map(function (c) { return c.slug; }).sort(byOrder);
  var out = [];
  var placed = {};
  while (ready.length) {
    var slug = ready.shift();
    out.push(slug); placed[slug] = true;
    dependents[slug].forEach(function (d) {
      indeg[d] -= 1;
      if (indeg[d] === 0) ready.push(d);
    });
    ready.sort(byOrder);
  }
  // Any class not placed sits in a cycle; append by order so the list is complete.
  classes.map(function (c) { return c.slug; })
    .filter(function (s) { return !placed[s]; })
    .sort(byOrder)
    .forEach(function (s) { out.push(s); });
  return out;
}

/* Pure: the next class that can be built now — planned/failed, with every
   prerequisite already built. Returns null when nothing is buildable (done,
   or blocked by an unbuilt/failed prerequisite — the human then sees why). */
function nextBuildable(manifest) {
  var classes = (manifest && manifest.classes) || [];
  var bySlug = {};
  classes.forEach(function (c) { bySlug[c.slug] = c; });
  var order = buildOrder(manifest);
  for (var i = 0; i < order.length; i++) {
    var c = bySlug[order[i]];
    if (!c) continue;
    if (c.status !== "planned" && c.status !== "failed") continue;
    var prereqsBuilt = (c.prerequisites || []).every(function (p) {
      return !bySlug[p] || bySlug[p].status === "built";
    });
    if (prereqsBuilt) return c.slug;
  }
  return null;
}

/* Pure: EVERY class that can be built right now — planned/failed, with every
   prerequisite already built — returned in dependency/order order. This is the
   parallel-build superset of nextBuildable: readyBuildable(m)[0] === nextBuildable(m),
   and readyBuildable(m).length === 0 exactly when nextBuildable(m) === null.
   The client scheduler fills its worker slots from this list; because readiness
   is recomputed server-side from the manifest, two returned slugs are always
   safe to build concurrently (neither depends on the other, nor on anything
   still unbuilt). */
function readyBuildable(manifest) {
  var classes = (manifest && manifest.classes) || [];
  var bySlug = {};
  classes.forEach(function (c) { bySlug[c.slug] = c; });
  var order = buildOrder(manifest);
  var ready = [];
  for (var i = 0; i < order.length; i++) {
    var c = bySlug[order[i]];
    if (!c) continue;
    if (c.status !== "planned" && c.status !== "failed") continue;
    var prereqsBuilt = (c.prerequisites || []).every(function (p) {
      return !bySlug[p] || bySlug[p].status === "built";
    });
    if (prereqsBuilt) ready.push(c.slug);
  }
  return ready;
}

/* Pure: synthesize a FULL, contract-valid brief for one class by merging the
   brief template defaults with curriculum-level and class-level data. This is
   what the build loop sends to /api/generate. Template is injectable for tests. */
function briefForClass(manifest, classSlug, template) {
  template = template || briefTemplate;
  var classes = (manifest && manifest.classes) || [];
  var cls = classes.filter(function (c) { return c.slug === classSlug || c.id === classSlug; })[0];
  if (!cls) return null;

  var b = JSON.parse(JSON.stringify(template));
  b.meta = { title: cls.title, slug: cls.slug, created: new Date().toISOString(), engine_contract: "v-texas" };
  b.objectives = { terminal: (cls.terminal || []).slice(), enabling: (cls.enabling || []).slice(), out_of_scope: [] };
  b.length = Object.assign({}, template.length, { minutes: cls.suggested_minutes });

  // Shared, curriculum-level setup (audience/demographics + tier + KB ownership)
  // that every class inherits. Absent => prior behavior (tier from level, AI owns
  // research, free-text audience only).
  var setup = (manifest && manifest.setup && typeof manifest.setup === "object") ? manifest.setup : null;

  // Curriculum "level" (introductory..advanced) loosely maps onto the class tier;
  // an explicit shared tier wins.
  var tierMap = { introductory: "standard", intermediate: "standard", advanced: "professional", mixed: "standard" };
  b.class_tier = { level: (setup && setup.tier) || tierMap[String(manifest.level || "").toLowerCase()] || template.class_tier.level };

  // Audience: keep the free-text curriculum audience as background; layer the
  // shared structured demographics on top when a setup pass has been done. The
  // single-class creator captures BOTH a typical and a floor learner, so the
  // curriculum carries the same. Back-compat: an older flat setup.audience
  // (education/technical/role at the top level) is treated as the typical learner.
  if (manifest.audience || setup) {
    b.audience = JSON.parse(JSON.stringify(template.audience));
    if (manifest.audience) b.audience.average = Object.assign({}, b.audience.average, { background: manifest.audience });
    if (setup && setup.audience) {
      var sa = setup.audience;
      var avg = (sa.average && typeof sa.average === "object") ? sa.average : sa;
      var flr = (sa.floor && typeof sa.floor === "object") ? sa.floor : null;
      b.audience.average = Object.assign({}, b.audience.average, {
        age_band: avg.age_band || b.audience.average.age_band,
        education: avg.education || b.audience.average.education,
        background: avg.background || b.audience.average.background,
        technical: avg.technical || b.audience.average.technical,
        role: avg.role || b.audience.average.role
      });
      if (flr) {
        b.audience.floor = Object.assign({}, b.audience.floor, {
          age_band: flr.age_band || b.audience.floor.age_band,
          education: flr.education || b.audience.floor.education,
          background: flr.background || b.audience.floor.background,
          technical: flr.technical || b.audience.floor.technical,
          role: flr.role || b.audience.floor.role
        });
      }
      if (sa.gender_mix) b.audience.gender_mix = sa.gender_mix;
      b.audience.tone = sa.tone || b.audience.tone;
      b.audience.accessibility = Object.assign({}, b.audience.accessibility, { reading_grade_cap: sa.reading_grade_cap });
    }
  }

  // Knowledge-base ownership: the shared choice (creator / assisted / ai).
  //   ai       — Bernard researches & verifies (default; first-class step).
  //   assisted — seed with the human's sources, Bernard fills the gaps.
  //   creator  — use ONLY the human's sources; no automatic web research.
  var owner = (setup && setup.research_owner) || "ai";
  var seeds = (setup && Array.isArray(setup.sources)) ? setup.sources : [];
  b.knowledge_base = b.knowledge_base || JSON.parse(JSON.stringify(template.knowledge_base || {}));
  b.knowledge_base.research = b.knowledge_base.research || {};
  b.knowledge_base.research.owner = owner;
  b.knowledge_base.research.allow_web = (owner !== "creator");
  if (seeds.length) {
    var existing = Array.isArray(b.knowledge_base.uploads) ? b.knowledge_base.uploads : [];
    var mapped = seeds
      .map(function (s) { return { path: s.path, type: "url", trust: s.trust || "unknown" }; })
      .filter(function (u) { return u.path; });
    b.knowledge_base.uploads = existing.concat(mapped);
  }

  // Knowledge-base research policy (beyond ownership): evidence boundary, recency
  // floor, minimum source tier, seed prompts. owner=creator forces "use only my
  // sources" so mode/web stay coherent; otherwise the shared policy applies.
  if (setup && setup.kb && typeof setup.kb === "object") {
    var kb = setup.kb;
    b.knowledge_base.research.mode = (owner === "creator") ? "none"
      : (["none", "grounded", "collaborative"].indexOf(kb.mode) >= 0 ? kb.mode : "collaborative");
    if (kb.recency_floor) b.knowledge_base.research.recency_floor = kb.recency_floor;
    if (Array.isArray(kb.seed_prompts) && kb.seed_prompts.length) b.knowledge_base.research.seed_prompts = kb.seed_prompts.slice();
    b.knowledge_base.credibility = b.knowledge_base.credibility || {};
    if (["primary", "secondary", "unknown"].indexOf(kb.min_tier) >= 0) b.knowledge_base.credibility.min_tier = kb.min_tier;
  }

  // Length budget: per-class minutes come from the plan; the shared control is
  // slide DENSITY (slides per minute), scaled per class, plus the interaction
  // budget. Absent => 1.5 slides/min (the prior default) and template interactions.
  // The raw minutes*density product is CLAMPED to a sane band tied to the class
  // tier (B3/B7): the tier's slide floor is the minimum depth, and floor + a
  // fixed band is the ceiling, so a long class or a high density can no longer
  // derive a runaway 100+ slide deck. Density still scales the count WITHIN the
  // band. (Tier floors mirror api/generate.js CLASS_TIERS; kept local so the
  // curriculum path need not require the generate monolith.)
  var spm = (setup && setup.length && Number(setup.length.slides_per_minute)) ? Number(setup.length.slides_per_minute) : 1.5;
  var floorSlides = TIER_SLIDE_FLOOR[b.class_tier.level] || TIER_SLIDE_FLOOR.standard;
  var ceilingSlides = floorSlides + SANE_SLIDE_BAND;
  var derivedSlides = Math.round((cls.suggested_minutes || 60) * spm);
  b.length.slide_budget = Math.max(floorSlides, Math.min(ceilingSlides, derivedSlides));
  if (setup && setup.length && setup.length.interaction_budget && typeof setup.length.interaction_budget === "object") {
    b.length.interaction_budget = Object.assign({}, b.length.interaction_budget, setup.length.interaction_budget);
  }

  // Mastery: the shared curriculum-level depth settings every class inherits —
  // the same knobs the single-class creator exposes (target level, granularity,
  // where-the-field-disagrees, deep-dive density). Absent => template defaults.
  // Values are whitelisted so a malformed setup can never poison a class brief.
  if (setup && setup.mastery && typeof setup.mastery === "object") {
    var sm = setup.mastery;
    b.mastery = Object.assign({}, template.mastery, b.mastery);
    if (sm.target_level != null) {
      var lvl = Math.round(Number(sm.target_level));
      if (!isNaN(lvl)) b.mastery.target_level = Math.max(1, Math.min(5, lvl));
    }
    if (["survey", "working", "deep"].indexOf(sm.granularity) >= 0) b.mastery.granularity = sm.granularity;
    if (["low", "med", "high"].indexOf(sm.deep_dive_density) >= 0) b.mastery.deep_dive_density = sm.deep_dive_density;
    if (typeof sm.field_disagreement === "boolean") b.mastery.field_disagreement = sm.field_disagreement;
  }

  // Language: the shared presentation locale + delivery, mapped to the brief the
  // same way the single-class creator does. delivery "english" (or locale "en")
  // keeps the class in English; "translated" renders in the student locale;
  // "split" shows English + the student locale ("en+xx").
  if (setup && setup.language && typeof setup.language === "object") {
    var lg = setup.language;
    var lang = ["en", "es", "fr", "de", "pt", "it", "ar", "zh", "ja", "ko", "vi"].indexOf(lg.student_language) >= 0 ? lg.student_language : "en";
    var delivery = ["english", "translated", "split"].indexOf(lg.delivery) >= 0 ? lg.delivery : "english";
    var glossaryPrimary = (lg.glossary_in_primary === false) ? false : true;
    b.language = Object.assign({}, template.language, b.language);
    if (delivery === "english" || lang === "en") {
      b.language.primary = "en";
      b.language.localize_ui_strings = false;
    } else {
      b.language.primary = (delivery === "split") ? ("en+" + lang) : lang;
      b.language.localize_ui_strings = true;
    }
    b.language.glossary_in_primary = glossaryPrimary;
  }
  return b;
}



function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try { return Promise.resolve(JSON.parse(req.body)); }
    catch (e) { return Promise.reject(new Error("Request body is not valid JSON.")); }
  }
  return new Promise(function (resolve, reject) {
    var chunks = "";
    req.on("data", function (c) { chunks += c; });
    req.on("end", function () { try { resolve(chunks ? JSON.parse(chunks) : {}); } catch (e) { reject(new Error("Request body is not valid JSON.")); } });
    req.on("error", reject);
  });
}

function view(manifest) {
  var next = nextBuildable(manifest);
  var ready = readyBuildable(manifest);
  var biblio = bib.bibliography(manifest);
  return {
    manifest: manifest,
    progress: store.buildProgress(manifest),
    coherence: coherence.analyzeCoherence(manifest),
    bibliography: biblio,
    bibliography_summary: bib.summarize(biblio),
    // next/next_brief: the single next class, kept for the serial client path.
    next: next,
    next_brief: next ? briefForClass(manifest, next) : null,
    // ready: ALL classes buildable right now, dependency-correct order. The
    // parallel scheduler fills its worker slots from this; briefs are fetched
    // per-slug as each worker starts (keeps this payload light). ready[0]===next.
    ready: ready
  };
}

module.exports = async function curriculumBuildHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

  // Read a query param from req.query (Vercel) or fall back to parsing req.url.
  function qparam(name) {
    if (req.query && req.query[name] != null) return String(req.query[name]);
    var marker = name + "=";
    var raw = req.url && req.url.indexOf(marker) >= 0
      ? (req.url.split(marker)[1] || "").split("&")[0]
      : "";
    return raw;
  }

  try {
    if (req.method === "GET") {
      var slug = qparam("slug");
      if (!slug) { send(res, 400, { ok: false, errors: ["Provide ?slug=<curriculum>."] }); return; }
      var read = await store.readManifest(decodeURIComponent(slug));
      if (!read) { send(res, 404, { ok: false, errors: ["No curriculum with that slug."] }); return; }
      // Brief-by-slug mode: ?slug=<curriculum>&class=<classSlug> returns just that
      // one class's full brief. The parallel scheduler calls this as each worker
      // starts a class, so the polled view stays light (no briefs in the payload).
      var classSlug = qparam("class");
      if (classSlug) {
        var brief = briefForClass(read.manifest, decodeURIComponent(classSlug));
        if (!brief) { send(res, 404, { ok: false, errors: ["No class with that slug in this curriculum."] }); return; }
        send(res, 200, { ok: true, sha: read.sha, class: decodeURIComponent(classSlug), brief: brief });
        return;
      }
      send(res, 200, Object.assign({ ok: true, sha: read.sha }, view(read.manifest)));
      return;
    }

    if (req.method !== "POST") { send(res, 405, { ok: false, errors: ["Use GET or POST."] }); return; }

    var body = await readBody(req);
    var action = body && body.action;

    if (action === "save") {
      var manifest = body.plan
        ? store.planToManifest(body.plan, body.input || {})
        : store.normalizeManifest(body.manifest || {}, body.input || {});
      var check = store.validateManifest(manifest);
      if (!check.ok) { send(res, 422, { ok: false, errors: check.errors }); return; }
      var existing = await store.readManifest(manifest.slug);
      await store.writeManifest(manifest, existing && existing.sha);
      send(res, 200, { ok: true, manifest: manifest, coherence: coherence.analyzeCoherence(manifest) });
      return;
    }

    if (action === "status") {
      var current = await store.readManifest(body.slug);
      if (!current) { send(res, 404, { ok: false, errors: ["No curriculum with that slug."] }); return; }
      var updated = store.setClassStatus(current.manifest, body.class, body.status, { class_url: body.class_url });
      // Harvest the class's cited sources into the shared knowledge_core as it
      // completes. Only on a successful build, and only when sources arrived —
      // never wipe a prior harvest on a status flip with no payload.
      if (body.status === "built" && Array.isArray(body.sources) && body.sources.length) {
        updated = bib.recordClassSources(updated, body.class, body.sources);
        updated = bib.rollUpKnowledgeCore(updated);
      }
      await store.writeManifest(updated, current.sha);
      send(res, 200, Object.assign({ ok: true }, view(updated)));
      return;
    }

    send(res, 400, { ok: false, errors: ["Unknown action. Use save or status."] });
  } catch (error) {
    send(res, 502, { ok: false, errors: [String(error && error.message || error)] });
  }
};

module.exports.buildOrder = buildOrder;
module.exports.nextBuildable = nextBuildable;
module.exports.readyBuildable = readyBuildable;
module.exports.briefForClass = briefForClass;
module.exports._internal = { buildOrder: buildOrder, nextBuildable: nextBuildable, readyBuildable: readyBuildable, briefForClass: briefForClass };
