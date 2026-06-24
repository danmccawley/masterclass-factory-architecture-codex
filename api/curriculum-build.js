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
const briefTemplate = require("../brief.template.json");

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
  b.length = Object.assign({}, template.length, {
    minutes: cls.suggested_minutes,
    slide_budget: Math.max(10, Math.min(400, Math.round(cls.suggested_minutes * 1.5)))
  });

  // Curriculum "level" (introductory..advanced) loosely maps onto the class tier.
  var tierMap = { introductory: "standard", intermediate: "standard", advanced: "professional", mixed: "standard" };
  b.class_tier = { level: tierMap[String(manifest.level || "").toLowerCase()] || template.class_tier.level };

  // Preserve the curriculum audience as free text without breaking the structured contract.
  if (manifest.audience) {
    b.audience = JSON.parse(JSON.stringify(template.audience));
    b.audience.average = Object.assign({}, b.audience.average, { background: manifest.audience });
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
  return {
    manifest: manifest,
    progress: store.buildProgress(manifest),
    coherence: coherence.analyzeCoherence(manifest),
    next: next,
    next_brief: next ? briefForClass(manifest, next) : null
  };
}

module.exports = async function curriculumBuildHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

  try {
    if (req.method === "GET") {
      var slug = (req.query && req.query.slug) || (req.url && (req.url.split("slug=")[1] || "").split("&")[0]) || "";
      if (!slug) { send(res, 400, { ok: false, errors: ["Provide ?slug=<curriculum>."] }); return; }
      var read = await store.readManifest(decodeURIComponent(slug));
      if (!read) { send(res, 404, { ok: false, errors: ["No curriculum with that slug."] }); return; }
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
module.exports.briefForClass = briefForClass;
module.exports._internal = { buildOrder: buildOrder, nextBuildable: nextBuildable, briefForClass: briefForClass };
