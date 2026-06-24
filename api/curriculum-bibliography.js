/* ============================================================================
   curriculum-bibliography.js — Harvest each built class's cited sources and
   roll them up into the curriculum's shared knowledge_core bibliography.
   ----------------------------------------------------------------------------
   The build loop generates classes one at a time through /api/generate. Each
   build returns the sealed source list the class is grounded in. This module is
   the PURE data layer that:
     (a) normalizes a raw source (from the generate projection, from
         source_discovery, or hand-entered by a human),
     (b) records a class's sources on its manifest entry (class.sources), and
     (c) deduplicates the union across all classes into
         manifest.knowledge_core.sources — the spine the store already reserves
         ("the shared, curriculum-level knowledge_core") — attributing each
         source to the classes that cite it (cited_by).

   Nothing here touches the network. The build handler calls these between the
   generate response and the manifest write. Fully unit-tested.
============================================================================ */

var TRUST = ["primary", "secondary", "unknown"];

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 300);
}

function normTrust(v) {
  var t = String(v == null ? "" : v).toLowerCase().trim();
  return TRUST.indexOf(t) >= 0 ? t : "unknown";
}

/* primary (0) sorts before secondary (1) before unknown (2). */
function trustRank(s) {
  if (s && s.primary) return 0;
  var t = normTrust(s && s.trust);
  return t === "primary" ? 0 : (t === "secondary" ? 1 : 2);
}

/* A normalized de-dupe key. URL beats title: scheme, leading www., and trailing
   slashes are stripped so the same page from two builds collapses to one row. */
function dedupeKey(source) {
  var p = String(source && source.path || "").toLowerCase().trim();
  if (p) {
    p = p.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    return "u:" + p;
  }
  return "t:" + String(source && source.title || "").toLowerCase().trim();
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                              */
/* -------------------------------------------------------------------------- */

/* Coerce any raw source shape into the canonical record. Accepts path|url|href,
   published|date|year, trust + an explicit `primary` flag. Returns null when
   there is neither a URL nor a title (nothing citable). `viaClass` attributes
   the source to a class when the raw record carries no cited_by of its own. */
function normalizeSource(raw, viaClass) {
  raw = raw && typeof raw === "object" ? raw : {};
  var path = cleanText(raw.path || raw.url || raw.href || "", 600);
  var title = cleanText(raw.title || raw.name || "", 300);
  if (!path && !title) return null;

  var primary = raw.primary === true || normTrust(raw.trust) === "primary";
  var trust = primary ? "primary" : normTrust(raw.trust);
  var published = cleanText(raw.published || raw.date || raw.year || "", 40);

  var s = {
    path: path,
    title: title || path,
    trust: trust,
    primary: primary,
    published: published
  };

  if (Array.isArray(raw.cited_by) && raw.cited_by.length) {
    s.cited_by = raw.cited_by.map(function (c) { return cleanText(c, 120); }).filter(Boolean);
  } else if (viaClass) {
    s.cited_by = [cleanText(viaClass, 120)];
  }
  return s;
}

/* Fold an incoming record into an existing one, keeping the richest signal:
   a real title over a URL-as-title, primary trust wins, gain a date if missing,
   union the cited_by attribution. */
function mergeInto(target, incoming) {
  var incomingHasRealTitle = incoming.title && incoming.title !== incoming.path;
  var targetHasRealTitle = target.title && target.title !== target.path;
  if (incomingHasRealTitle && (!targetHasRealTitle || incoming.title.length > target.title.length)) {
    target.title = incoming.title;
  }
  if (incoming.primary) target.primary = true;
  if (target.primary) target.trust = "primary";
  else if (target.trust === "unknown" && incoming.trust !== "unknown") target.trust = incoming.trust;
  if (!target.published && incoming.published) target.published = incoming.published;
  if (Array.isArray(incoming.cited_by)) {
    target.cited_by = target.cited_by || [];
    incoming.cited_by.forEach(function (c) { if (target.cited_by.indexOf(c) < 0) target.cited_by.push(c); });
  }
  return target;
}

/* De-duplicate a list of raw/normalized sources, preserving first-seen order. */
function dedupeSources(list) {
  var byKey = {};
  var order = [];
  (list || []).forEach(function (raw) {
    var s = normalizeSource(raw);
    if (!s) return;
    var k = dedupeKey(s);
    if (byKey[k]) { mergeInto(byKey[k], s); }
    else { byKey[k] = s; order.push(k); }
  });
  return order.map(function (k) { return byKey[k]; });
}

/* -------------------------------------------------------------------------- */
/* Manifest operations (return NEW manifests; never mutate the input)         */
/* -------------------------------------------------------------------------- */

/* Record the sources a single class was built on, de-duped within the class. */
function recordClassSources(manifest, classSlug, rawSources) {
  var next = JSON.parse(JSON.stringify(manifest || {}));
  var found = false;
  next.classes = (next.classes || []).map(function (c) {
    if (c.slug === classSlug || c.id === classSlug) {
      found = true;
      c.sources = dedupeSources(Array.isArray(rawSources) ? rawSources : []);
    }
    return c;
  });
  if (!found) throw new Error("No class with slug: " + classSlug);
  return next;
}

/* Aggregate every class's sources into the shared knowledge_core: one row per
   distinct source, attributed to all classes that cite it, sorted by trust then
   title. Idempotent — safe to call after every class completes. cited_by is
   accumulated in class build/declared order. */
function rollUpKnowledgeCore(manifest) {
  var next = JSON.parse(JSON.stringify(manifest || {}));
  var ordered = (next.classes || []).slice().sort(function (a, b) {
    return (a.order || 0) - (b.order || 0);
  });

  var collected = [];
  ordered.forEach(function (c) {
    (c.sources || []).forEach(function (s) {
      var copy = normalizeSource(s);
      if (!copy) return;
      copy.cited_by = (Array.isArray(s.cited_by) && s.cited_by.length) ? s.cited_by.slice() : [];
      if (copy.cited_by.indexOf(c.slug) < 0) copy.cited_by.push(c.slug);
      collected.push(copy);
    });
  });

  var merged = dedupeSources(collected);
  merged.sort(function (a, b) {
    var r = trustRank(a) - trustRank(b);
    if (r) return r;
    return String(a.title || "").toLowerCase().localeCompare(String(b.title || "").toLowerCase());
  });

  var core = (next.knowledge_core && typeof next.knowledge_core === "object") ? next.knowledge_core : {};
  core.shared = core.shared !== false;
  core.sealed = core.sealed === true;
  core.sources = merged;
  core.compiled_at = new Date().toISOString();
  next.knowledge_core = core;
  return next;
}

/* Read the compiled bibliography for rendering. Uses the already-rolled-up core
   if present; otherwise computes it on the fly without persisting. */
function bibliography(manifest) {
  var core = manifest && manifest.knowledge_core;
  if (core && Array.isArray(core.sources) && core.sources.length) return core.sources.slice();
  return rollUpKnowledgeCore(manifest).knowledge_core.sources || [];
}

/* Trust-tier counts for headers/badges. */
function summarize(sources) {
  var by = { primary: 0, secondary: 0, unknown: 0 };
  (sources || []).forEach(function (s) {
    var r = trustRank(s);
    by[r === 0 ? "primary" : (r === 1 ? "secondary" : "unknown")] += 1;
  });
  return { total: (sources || []).length, primary: by.primary, secondary: by.secondary, unknown: by.unknown };
}

module.exports = {
  normalizeSource: normalizeSource,
  dedupeKey: dedupeKey,
  dedupeSources: dedupeSources,
  recordClassSources: recordClassSources,
  rollUpKnowledgeCore: rollUpKnowledgeCore,
  bibliography: bibliography,
  summarize: summarize,
  _internal: {
    cleanText: cleanText, normTrust: normTrust, trustRank: trustRank, mergeInto: mergeInto,
    normalizeSource: normalizeSource, dedupeKey: dedupeKey, dedupeSources: dedupeSources,
    recordClassSources: recordClassSources, rollUpKnowledgeCore: rollUpKnowledgeCore,
    bibliography: bibliography, summarize: summarize
  }
};
