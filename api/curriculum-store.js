/* ============================================================================
   curriculum-store.js — A curriculum is a manifest committed to the repo.
   ----------------------------------------------------------------------------
   Storage model (extends the existing GitHub-as-datastore):
     - Each curriculum lives at  curricula/<slug>/curriculum.json
     - Member classes still publish to  classes/<class-slug>/  and link back
       via curriculumId; the manifest enumerates them with a build status.
     - Job/build state IS the per-class status field in the manifest (no
       separate job store): planned -> building -> built | failed.
     - A shared, curriculum-level knowledge_core is the spine for coherence.

   This file is split into PURE functions (the data model — fully unit-tested)
   and a thin GitHub persistence layer (network — exercised in production).
============================================================================ */

const STATUSES = ["planned", "building", "built", "failed"];

/* --------------------------------------------------------------------------
   Pure helpers
-------------------------------------------------------------------------- */

function slugify(text) {
  return String(text == null ? "" : text)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.+/g, "")
    .slice(0, 80) || "curriculum";
}

function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 200);
}

function asStringArray(v, max) {
  if (!Array.isArray(v)) return [];
  return v.map(function (x) { return cleanText(x, 400); }).filter(Boolean).slice(0, max || 12);
}

function clampInt(v, lo, hi, dflt) {
  var n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function nowIso() { return new Date().toISOString(); }

/* --------------------------------------------------------------------------
   Manifest construction + normalization
-------------------------------------------------------------------------- */

function normalizeClass(raw, index, seenSlugs) {
  raw = raw && typeof raw === "object" ? raw : {};
  var title = cleanText(raw.title, 160);
  var base = slugify(raw.slug || title || ("class-" + (index + 1)));
  // De-duplicate slugs so each class addresses a unique folder.
  var slug = base, n = 2;
  while (seenSlugs[slug]) { slug = base + "-" + n; n += 1; }
  seenSlugs[slug] = true;

  var status = STATUSES.indexOf(raw.status) >= 0 ? raw.status : "planned";
  return {
    id: slug,
    slug: slug,
    order: clampInt(raw.order, 1, 999, index + 1),
    title: title,
    summary: cleanText(raw.summary, 400),
    terminal: asStringArray(raw.terminal, 5),
    enabling: asStringArray(raw.enabling, 8),
    prerequisites: asStringArray(raw.prerequisites, 12),
    assessment: cleanText(raw.assessment, 600),
    suggested_minutes: clampInt(raw.suggested_minutes, 5, 240, 50),
    status: status,
    class_url: cleanText(raw.class_url, 400)
  };
}

function normalizeManifest(raw, input) {
  raw = raw && typeof raw === "object" ? raw : {};
  input = input || {};
  var title = cleanText(raw.title || input.title || input.subject, 160);
  var slug = slugify(raw.slug || raw.id || title);
  var seen = {};
  var classes = (Array.isArray(raw.classes) ? raw.classes : [])
    .map(function (c, i) { return normalizeClass(c, i, seen); });
  // Stable ordering by the order field, then re-sequence 1..N.
  classes.sort(function (a, b) { return a.order - b.order; });
  classes.forEach(function (c, i) { c.order = i + 1; });

  var core = raw.knowledge_core && typeof raw.knowledge_core === "object" ? raw.knowledge_core : {};
  return {
    schema: "curriculum/v1",
    id: slug,
    slug: slug,
    title: title,
    subject: cleanText(raw.subject || input.subject, 200),
    audience: cleanText(raw.audience || input.audience, 200),
    level: cleanText(raw.level || input.level || "introductory", 40),
    program_outcome: cleanText(raw.program_outcome || input.program_outcome, 600),
    created: cleanText(raw.created, 40) || nowIso(),
    updated: nowIso(),
    knowledge_core: {
      shared: core.shared !== false,
      sealed: core.sealed === true,
      sources: Array.isArray(core.sources) ? core.sources : []
    },
    classes: classes
  };
}

function makeManifest(input) {
  return normalizeManifest({
    title: input && input.title,
    subject: input && input.subject,
    audience: input && input.audience,
    level: input && input.level,
    program_outcome: input && input.program_outcome,
    classes: (input && input.classes) || []
  }, input || {});
}

/* Bridge a planner plan (api/curriculum.js output) into a stored manifest. */
function planToManifest(plan, input) {
  plan = plan || {};
  return normalizeManifest({
    title: (input && (input.title || input.subject)) || (plan && plan.title),
    subject: input && input.subject,
    audience: input && input.audience,
    level: plan.level || (input && input.level),
    program_outcome: plan.notes || (input && input.program_outcome),
    classes: Array.isArray(plan.classes) ? plan.classes : []
  }, input || {});
}

/* --------------------------------------------------------------------------
   Validation (STRUCTURAL only — coherence checks are a separate engine)
-------------------------------------------------------------------------- */

function validateManifest(manifest) {
  var errors = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors: ["Manifest must be an object."] };
  }
  if (manifest.schema !== "curriculum/v1") errors.push("Unknown or missing schema (expected curriculum/v1).");
  if (!manifest.slug) errors.push("Manifest is missing a slug.");
  if (!Array.isArray(manifest.classes) || manifest.classes.length === 0) {
    errors.push("A curriculum needs at least one class.");
    return { ok: errors.length === 0, errors: errors };
  }
  var seen = {};
  manifest.classes.forEach(function (c, i) {
    var where = "Class " + (i + 1) + (c && c.title ? " (\"" + c.title + "\")" : "");
    if (!c || typeof c !== "object") { errors.push(where + " is not an object."); return; }
    if (!c.title) errors.push(where + " has no title.");
    if (!Array.isArray(c.terminal) || c.terminal.length === 0) errors.push(where + " has no terminal objective.");
    if (STATUSES.indexOf(c.status) < 0) errors.push(where + " has an invalid status: " + c.status);
    if (!c.slug) errors.push(where + " has no slug.");
    else if (seen[c.slug]) errors.push(where + " has a duplicate slug: " + c.slug);
    seen[c.slug] = true;
  });
  return { ok: errors.length === 0, errors: errors };
}

/* --------------------------------------------------------------------------
   Job state: update a single class's build status (returns a new manifest)
-------------------------------------------------------------------------- */

function setClassStatus(manifest, classSlug, status, extra) {
  if (STATUSES.indexOf(status) < 0) throw new Error("Invalid status: " + status);
  var next = JSON.parse(JSON.stringify(manifest));
  var found = false;
  next.classes = (next.classes || []).map(function (c) {
    if (c.slug === classSlug || c.id === classSlug) {
      found = true;
      c.status = status;
      if (extra && typeof extra === "object") {
        if (typeof extra.class_url === "string") c.class_url = extra.class_url;
      }
    }
    return c;
  });
  if (!found) throw new Error("No class with slug: " + classSlug);
  next.updated = nowIso();
  return next;
}

function buildProgress(manifest) {
  var classes = (manifest && manifest.classes) || [];
  var by = { planned: 0, building: 0, built: 0, failed: 0 };
  classes.forEach(function (c) { if (by[c.status] != null) by[c.status] += 1; });
  return {
    total: classes.length,
    built: by.built,
    building: by.building,
    failed: by.failed,
    planned: by.planned,
    done: classes.length > 0 && by.built === classes.length
  };
}

/* --------------------------------------------------------------------------
   Bridge: each class -> a partial brief for the existing generate pipeline.
   Mirrors the contract shape used by api/curriculum.js planToBriefs.
-------------------------------------------------------------------------- */

function manifestToBriefs(manifest) {
  var classes = (manifest && manifest.classes) || [];
  return classes.map(function (c) {
    return {
      order: c.order,
      slug: c.slug,
      curriculumId: manifest.slug,
      brief: {
        meta: { title: c.title, slug: c.slug },
        objectives: {
          terminal: c.terminal.slice(),
          enabling: c.enabling.slice(),
          out_of_scope: []
        },
        length: { minutes: c.suggested_minutes }
      }
    };
  });
}

/* --------------------------------------------------------------------------
   Thin GitHub persistence (Contents API). Network — not unit-tested.
-------------------------------------------------------------------------- */

function githubConfig() {
  return {
    token: String(process.env.GITHUB_TOKEN || "").trim(),
    owner: String(process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "").trim(),
    repo: String(process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || "").trim(),
    branch: String(process.env.GITHUB_BRANCH || "main").trim()
  };
}

async function githubRequest(pathname, options) {
  var cfg = githubConfig();
  var response = await fetch("https://api.github.com" + pathname, Object.assign({
    headers: {
      authorization: "Bearer " + cfg.token,
      accept: "application/vnd.github+json",
      "user-agent": "masterclass-factory",
      "content-type": "application/json"
    }
  }, options || {}));
  return response;
}

function manifestPath(slug) { return "curricula/" + slugify(slug) + "/curriculum.json"; }

async function readManifest(slug) {
  var cfg = githubConfig();
  if (!cfg.token || !cfg.owner || !cfg.repo) throw new Error("GitHub storage is not configured (GITHUB_TOKEN/OWNER/REPO).");
  var path = manifestPath(slug);
  var res = await githubRequest("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path + "?ref=" + encodeURIComponent(cfg.branch), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not read curriculum (HTTP " + res.status + ").");
  var data = await res.json();
  var json = Buffer.from(data.content || "", "base64").toString("utf8");
  return { manifest: normalizeManifest(JSON.parse(json)), sha: data.sha };
}

async function writeManifest(manifest, sha) {
  var cfg = githubConfig();
  if (!cfg.token || !cfg.owner || !cfg.repo) throw new Error("GitHub storage is not configured (GITHUB_TOKEN/OWNER/REPO).");
  var check = validateManifest(manifest);
  if (!check.ok) throw new Error("Refusing to write an invalid manifest: " + check.errors.join("; "));
  var path = manifestPath(manifest.slug);
  var body = {
    message: "curriculum: " + (manifest.title || manifest.slug),
    content: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8").toString("base64"),
    branch: cfg.branch
  };
  if (sha) body.sha = sha;
  var res = await githubRequest("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    var detail = await res.json().catch(function () { return {}; });
    throw new Error("Could not write curriculum (HTTP " + res.status + "): " + (detail.message || ""));
  }
  return await res.json();
}

module.exports = {
  STATUSES: STATUSES,
  slugify: slugify,
  makeManifest: makeManifest,
  normalizeManifest: normalizeManifest,
  planToManifest: planToManifest,
  validateManifest: validateManifest,
  setClassStatus: setClassStatus,
  buildProgress: buildProgress,
  manifestToBriefs: manifestToBriefs,
  manifestPath: manifestPath,
  readManifest: readManifest,
  writeManifest: writeManifest,
  _internal: {
    slugify: slugify, makeManifest: makeManifest, normalizeManifest: normalizeManifest,
    planToManifest: planToManifest, validateManifest: validateManifest,
    setClassStatus: setClassStatus, buildProgress: buildProgress, manifestToBriefs: manifestToBriefs
  }
};
