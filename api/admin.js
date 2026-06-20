const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function adminKey(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return String(
    (req.headers && (req.headers["x-admin-key"] || req.headers["authorization"])) ||
    url.searchParams.get("key") ||
    ""
  ).replace(/^Bearer\s+/i, "").trim();
}

function requireAdmin(req, res) {
  const configured = String(process.env.POLL_ADMIN_KEY || "").trim();
  if (!configured) {
    send(res, 503, {
      ok: false,
      errors: ["Set POLL_ADMIN_KEY in Vercel to enable the owner-only admin endpoint."]
    });
    return false;
  }
  if (!timingSafeEqual(adminKey(req), configured)) {
    send(res, 403, { ok: false, errors: ["Bad admin key."] });
    return false;
  }
  return true;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

function classFolders() {
  const root = path.join(__dirname, "..", "classes");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
}

function summarizeClass(folder) {
  const slug = path.basename(folder);
  const record = readJson(path.join(folder, "class-record.json"));
  const files = fs.readdirSync(folder).filter((name) => fs.statSync(path.join(folder, name)).isFile());
  const requiredExports = [
    "student-handout.md",
    "facilitator-guide.md",
    "quiz-answer-key.md",
    "evidence-map.json",
    "class-blueprint.json",
    "class-record.json"
  ];
  return {
    slug,
    title: record && record.title ? record.title : slug,
    generated_at: record && record.generated_at ? record.generated_at : "",
    class_tier: record && record.class_tier ? record.class_tier.label : "",
    quality_score: record && record.quality ? record.quality.score : null,
    quality_status: record && record.quality ? record.quality.status : "",
    knowledge_standard_ok: record && record.knowledge_standard ? record.knowledge_standard.ok : null,
    source_count: record && record.source_paper ? record.source_paper.section_count : null,
    slide_count: record && record.slide_count ? record.slide_count : null,
    deep_dive_count: record && record.deep_dive_count ? record.deep_dive_count : null,
    exports_complete: requiredExports.every((name) => files.indexOf(name) !== -1),
    missing_exports: requiredExports.filter((name) => files.indexOf(name) === -1),
    files
  };
}

module.exports = async function adminHandler(req, res) {
  if (req.method !== "GET") {
    send(res, 405, { ok: false, errors: ["Use GET for the admin summary."] });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const classes = classFolders().map(summarizeClass);
    send(res, 200, {
      ok: true,
      checked_at: new Date().toISOString(),
      summary: {
        classes: classes.length,
        needs_attention: classes.filter((item) => (
          item.knowledge_standard_ok === false ||
          item.exports_complete === false ||
          (Number.isFinite(item.quality_score) && item.quality_score < 85)
        )).length
      },
      classes
    });
  } catch (error) {
    send(res, 500, { ok: false, errors: [String(error && error.message || error)] });
  }
};
