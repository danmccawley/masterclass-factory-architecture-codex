const fs = require("fs");
const path = require("path");

const REPORT_KEY = "librarian:last_report";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSourcePaper(sourceJs) {
  const marker = "window.SOURCE_PAPER";
  const markerIndex = sourceJs.indexOf(marker);
  if (markerIndex === -1) return null;
  const equals = sourceJs.indexOf("=", markerIndex);
  if (equals === -1) return null;
  const raw = sourceJs.slice(equals + 1).trim().replace(/;\s*$/, "");
  return JSON.parse(raw);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractUrls(section) {
  const body = String(section.body || "");
  const hrefs = [];
  body.replace(/href="([^"]+)"/gi, (match, url) => {
    hrefs.push(url);
    return match;
  });
  body.replace(/https?:\/\/[^\s<>"')]+/gi, (url) => {
    hrefs.push(url.replace(/[.,;]+$/, ""));
    return url;
  });
  return unique(hrefs);
}

function sourceQuality(body) {
  const plain = stripHtml(body);
  const credibility = plain.match(/Credibility ranking:\s*([^.]*)\./i);
  const reliability = plain.match(/Reliability ranking:\s*([^.]*)\./i);
  return {
    credibility: credibility ? credibility[1].trim() : "Unrated",
    reliability: reliability ? reliability[1].trim() : "Needs review"
  };
}

function readSavedClasses() {
  const root = path.join(__dirname, "..", "classes");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const slug = entry.name;
      const sourcePath = path.join(root, slug, "source.js");
      if (!fs.existsSync(sourcePath)) return null;
      try {
        const paper = parseSourcePaper(fs.readFileSync(sourcePath, "utf8"));
        if (!paper || !Array.isArray(paper.sections)) return null;
        const sources = paper.sections.map((section) => {
          const urls = extractUrls(section);
          const quality = sourceQuality(section.body);
          return {
            id: section.id,
            num: section.num,
            title: section.title,
            urls,
            credibility: quality.credibility,
            reliability: quality.reliability
          };
        });
        return {
          slug,
          title: paper.title || slug,
          cite: paper.cite || "",
          source_count: sources.length,
          url_count: sources.reduce((sum, source) => sum + source.urls.length, 0),
          sources
        };
      } catch (error) {
        return {
          slug,
          title: slug,
          source_count: 0,
          url_count: 0,
          sources: [],
          error: String(error && error.message || error)
        };
      }
    })
    .filter(Boolean);
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "user-agent": "Masterclass Factory Librarian" }
    });
    return {
      url,
      ok: response.ok,
      status: response.status,
      etag: response.headers.get("etag") || "",
      last_modified: response.headers.get("last-modified") || "",
      content_type: response.headers.get("content-type") || ""
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      error: String(error && error.message || error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function kv(commands) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) return null;
  const response = await fetch(base.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands)
  });
  if (!response.ok) throw new Error("kv " + response.status);
  return response.json();
}

async function previousReport() {
  let result = null;
  try {
    result = await kv([["GET", REPORT_KEY]]);
  } catch (error) {
    return null;
  }
  if (!result || !result[0] || !result[0].result) return null;
  try {
    return JSON.parse(result[0].result);
  } catch (error) {
    return null;
  }
}

function previousByUrl(report) {
  const map = {};
  if (!report || !Array.isArray(report.classes)) return map;
  report.classes.forEach((klass) => {
    (klass.url_checks || []).forEach((check) => {
      map[check.url] = check;
    });
  });
  return map;
}

function reviewReasons(klass, previousMap) {
  const reasons = [];
  if (klass.error) reasons.push("source.js could not be parsed");
  if (!klass.source_count) reasons.push("no source paper found");
  if (!klass.url_count) reasons.push("no live source URLs to monitor");
  (klass.url_checks || []).forEach((check) => {
    const previous = previousMap[check.url];
    if (!check.ok) reasons.push("source URL unavailable: " + check.url);
    if (previous && check.etag && previous.etag && check.etag !== previous.etag) reasons.push("source ETag changed: " + check.url);
    if (previous && check.last_modified && previous.last_modified && check.last_modified !== previous.last_modified) reasons.push("source modified date changed: " + check.url);
  });
  return unique(reasons);
}

async function buildReport() {
  const prior = await previousReport();
  const priorUrls = previousByUrl(prior);
  const classes = readSavedClasses();
  for (const klass of classes) {
    const urls = unique(klass.sources.flatMap((source) => source.urls));
    const checks = [];
    for (const url of urls.slice(0, 20)) {
      checks.push(await checkUrl(url));
    }
    klass.url_checks = checks;
    klass.review_reasons = reviewReasons(klass, priorUrls);
    klass.needs_review = klass.review_reasons.length > 0;
  }
  const report = {
    ok: true,
    checked_at: new Date().toISOString(),
    summary: {
      classes_checked: classes.length,
      classes_needing_review: classes.filter((klass) => klass.needs_review).length,
      source_urls_checked: classes.reduce((sum, klass) => sum + (klass.url_checks || []).length, 0)
    },
    classes
  };
  try {
    const saved = await kv([["SET", REPORT_KEY, JSON.stringify(report)]]);
    report.saved = Boolean(saved);
    report.storage = saved ? "kv" : "not_configured";
  } catch (error) {
    report.saved = false;
    report.storage = "error";
    report.storage_error = String(error && error.message || error);
  }
  return report;
}

module.exports = async function librarianHandler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, { ok: false, errors: ["Use GET or POST for the Librarian reserve check."] });
    return;
  }
  try {
    const report = await buildReport();
    json(res, 200, report);
  } catch (error) {
    json(res, 500, { ok: false, errors: [String(error && error.message || error)] });
  }
};
