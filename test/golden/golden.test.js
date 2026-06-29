/* eslint-disable no-console */
/* ============================================================================
   test/golden/golden.test.js — Sprint 3 BEHAVIOR-PRESERVING safety net.
   ----------------------------------------------------------------------------
   Drives the REAL generate() handler with a fixed brief and FULLY STUBBED
   externals (OpenAI/Tavily/GitHub/DNS/source fetch + frozen Date), captures the
   complete response to test/golden/class.json, and asserts it is byte-identical
   on every run. This is the gate for the generate.js decomposition: extract a
   module, re-run this — any diff means behavior changed.

   Run:            node test/golden/golden.test.js
   (Re)capture:    UPDATE_GOLDEN=1 node test/golden/golden.test.js
============================================================================ */

const fs = require("fs");
const path = require("path");

const GOLDEN_PATH = path.join(__dirname, "class.json");
const FIXED_ISO = "2026-01-01T00:00:00.000Z";

// --- 1. Freeze Date (deterministic timestamps AND timing) -------------------
const RealDate = Date;
const FIXED_MS = new RealDate(FIXED_ISO).getTime();
global.Date = class extends RealDate {
  constructor(...args) { if (args.length === 0) { super(FIXED_MS); } else { super(...args); } }
  static now() { return FIXED_MS; }
};

// --- 2. Deterministic env (set BEFORE requiring generate.js) -----------------
process.env.OPENAI_API_KEY = "sk-proj-" + "g".repeat(80);
process.env.TAVILY_API_KEY = "tvly-golden-key";
process.env.GITHUB_TOKEN = "ghp_golden";
process.env.GITHUB_OWNER = "areos";
process.env.GITHUB_REPO = "masterclass-factory";
process.env.GITHUB_BRANCH = "main";
process.env.PUBLIC_BASE_URL = "https://golden.example";
delete process.env.OPENAI_MODEL;        // use the default model ladder deterministically
delete process.env.OPENAI_SEARCH_MODEL;

// --- 3. Stub DNS so the SSRF guard resolves instantly to a public IP --------
const dns = require("dns");
dns.promises.lookup = async () => [{ address: "93.184.216.34", family: 4 }];

// --- 4. Stub fetch with deterministic, stage-aware canned responses ---------
function jsonResp(obj) {
  const body = JSON.stringify(obj);
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => obj,
    text: async () => body,
    arrayBuffer: async () => Buffer.from(body)
  };
}

// A fixed 12-source result (5 primary by host: loc.gov / *.gov / *.edu),
// enough to clear the standard floor (8 total / 2 primary) in one round.
function cannedTavily() {
  const hosts = [
    "www.loc.gov", "agency.gov", "state.gov", "biology.university.edu", "nih.gov",
    "khanacademy.org", "britannica.com", "nationalgeographic.org", "bbc.co.uk",
    "sciencedirect.com", "nature.com", "jstor.org"
  ];
  return { results: hosts.map((h, i) => ({ url: "https://" + h + "/photosynthesis/" + (i + 1), title: "Source " + (i + 1) + " on photosynthesis", content: "Stub source content " + (i + 1) + " about light reactions and the Calvin cycle." })) };
}

// Stage-aware canned OpenAI authoring content, keyed off the task string and
// (for authoring) the explicit slide-number range — so it is independent of
// batch completion order.
function cannedOpenAI(user) {
  const task = String((user && user.task) || "");
  if (/Analyze the available knowledge base/.test(task)) {
    return { summary: "Photosynthesis converts light energy into chemical energy in chloroplasts.", usable_points: [{ point: "Light-dependent reactions occur in the thylakoid membranes.", source_ids: ["s1"] }, { point: "The Calvin cycle fixes carbon in the stroma.", source_ids: ["s2"] }], gaps: [], cautions: ["Avoid conflating the two stages."] };
  }
  if (/lesson plan sized|terminal\/enabling objectives/.test(task)) {
    return {
      terminal: ["Explain how photosynthesis converts light energy into chemical energy"],
      enabling: ["Describe the light-dependent reactions", "Describe the Calvin cycle", "Identify inputs and outputs"],
      out_of_scope: [],
      lesson_sections: [
        { id: "sec1", title: "Orientation", teaching_goal: "Orient learners to photosynthesis", source_ids: ["s1"], activity: "discuss", deep_dive_reason: "context" },
        { id: "sec2", title: "Light-dependent reactions", teaching_goal: "Explain the light stage", source_ids: ["s1"], activity: "worked example", deep_dive_reason: "mechanism" },
        { id: "sec3", title: "Calvin cycle", teaching_goal: "Explain carbon fixation", source_ids: ["s2"], activity: "practice", deep_dive_reason: "mechanism" }
      ]
    };
  }
  if (/Draft teaching slides/.test(task)) {
    const ab = (user.slide_budget_contract && user.slide_budget_contract.authoring_batch) || { from: 1, to: 1 };
    const slides = [];
    for (let n = ab.from; n <= ab.to; n += 1) {
      slides.push({
        id: "slide-" + n,
        eyebrow: "Photosynthesis",
        title: "Teaching slide " + n,
        bullets: ["Key point A for slide " + n, "Key point B for slide " + n],
        explanation: "A source-grounded teaching explanation for slide " + n + " covering the relevant stage of photosynthesis.",
        worked_example: "Worked example " + n + ": trace energy from photons to glucose.",
        practice_prompt: "Practice prompt " + n + ": label the inputs and outputs.",
        common_mistake: "Common mistake " + n + ": confusing the light reactions with the Calvin cycle.",
        speaker_notes: "Presenter notes for slide " + n + " with enough detail to teach the point.",
        deep_dive: { title: "Deep dive " + n, body: ("Deeper source-grounded explanation, edge cases, and practice guidance for slide " + n + ". ").repeat(4).trim(), learner_prompts: ["Prompt " + n + " for the learner"] },
        source_ids: ["s1"],
        interaction: "none"
      });
    }
    return { slides };
  }
  if (/glossary/.test(task)) {
    return { terms: [{ term: "Chlorophyll", d: "The green pigment that absorbs light.", r: "It drives the light-dependent reactions." }, { term: "Stroma", d: "The fluid space of the chloroplast.", r: "It is where the Calvin cycle runs." }] };
  }
  if (/Create interactions/.test(task)) {
    return {
      polls: [{ id: "p1", q: "Where do the light reactions occur?", desc: "", opts: ["Thylakoid membrane", "Stroma"] }],
      words: [{ id: "w1", q: "One word for an input to photosynthesis", desc: "" }],
      quizzes: [{ type: "mc", level: 2, q: "What is the main carbohydrate output?", options: ["Glucose", "Protein"], answer: 0, why: "Photosynthesis produces glucose." }]
    };
  }
  return {};
}

function cannedGithub() {
  // One generic shape that satisfies every git-data read/write publishToGitHub
  // makes (ref → commit → blobs → tree → commit → patch).
  return { sha: "goldensha000", object: { sha: "goldensha000" }, tree: { sha: "goldentree000" }, commit: { sha: "goldencommit000" } };
}

async function stubFetch(url, opts) {
  const u = String(url);
  if (u.includes("api.tavily.com")) return jsonResp(cannedTavily());
  if (u.includes("api.openai.com/v1/chat/completions")) {
    let user = {};
    try { user = JSON.parse(JSON.parse(opts.body).messages[1].content); } catch (e) { /* ignore */ }
    return jsonResp({ choices: [{ message: { content: JSON.stringify(cannedOpenAI(user)) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });
  }
  if (u.includes("api.openai.com/v1/responses")) {
    return jsonResp({ output_text: "{}", usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u.includes("api.github.com")) return jsonResp(cannedGithub());
  // Source-verify fetch (fetchUrlText) — a reachable page with extractable text.
  const html = "<html><body>" + "Source page text about photosynthesis, light reactions, and the Calvin cycle. ".repeat(10) + "</body></html>";
  return { ok: true, status: 200, headers: { get: () => "text/html" }, json: async () => ({}), text: async () => html, arrayBuffer: async () => Buffer.from(html) };
}
global.fetch = stubFetch;

// --- 5. Fixed brief (standard tier, AI-owned web research, small deck) -------
const BRIEF = {
  meta: { title: "Introduction to Photosynthesis", slug: "introduction-to-photosynthesis", created: "2026-01-01", engine_contract: "v-texas" },
  class_tier: { level: "standard" },
  knowledge_base: {
    uploads: [],
    research: { owner: "ai", mode: "grounded", seed_prompts: ["light-dependent reactions"], allow_web: true, recency_floor: "2015-01-01" },
    credibility: { min_tier: "secondary", require_two_sources_for: ["statistics", "contested points"] }
  },
  objectives: { terminal: ["Explain how photosynthesis converts light energy into chemical energy"], enabling: ["Describe the light-dependent reactions", "Describe the Calvin cycle"], out_of_scope: [] },
  mastery: { target_level: 3, granularity: "working", deep_dive_density: "med", field_disagreement: false },
  audience: {
    average: { age_band: "adult", education: "secondary", background: "general science", technical: "mixed", role: "student" },
    floor: { age_band: "adult", education: "secondary", background: "none", technical: "non", role: "student" },
    gender_mix: "", tone: "plain", accessibility: { reading_grade_cap: 9 }
  },
  length: { minutes: 45, slide_budget: 12, interaction_budget: { polls: 2, word_clouds: 4, quizzes: 1, final_test: true } },
  language: { primary: "en", localize_ui_strings: true, glossary_in_primary: true }
};

function mockReq(body) {
  const payload = JSON.stringify(body);
  return {
    method: "POST",
    url: "/api/generate",
    headers: { host: "golden.example", "content-type": "application/json" },
    body: body,
    on(event, cb) { if (event === "data") cb(Buffer.from(payload)); if (event === "end") setImmediate(cb); return this; },
    socket: { remoteAddress: "127.0.0.1" }
  };
}
function mockRes() {
  return {
    statusCode: 0, headers: {}, body: null, ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(p) { if (p != null) this.body = (this.body || "") + p; this.ended = true; }
  };
}

// --- 6. Minimal deep diff to point at the FIRST divergence -------------------
function firstDiff(a, b, p) {
  p = p || "";
  if (a === b) return null;
  const ta = typeof a, tb = typeof b;
  if (ta !== tb || a === null || b === null || ta !== "object") {
    return { path: p || "(root)", golden: a, actual: b };
  }
  if (Array.isArray(a) !== Array.isArray(b)) return { path: p, golden: "array?" + Array.isArray(a), actual: "array?" + Array.isArray(b) };
  if (Array.isArray(a) && a.length !== b.length) return { path: p + ".length", golden: a.length, actual: b.length };
  const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], p ? p + "." + k : k);
    if (d) return d;
  }
  return null;
}

(async function () {
  const gen = require("../../api/generate.js");
  const res = mockRes();
  // Silence the in-build KBDIAG/PROGRESS console.log noise so the suite output
  // shows only the golden verdict. (console.error is left intact.)
  const realLog = console.log;
  console.log = function () {};
  try {
    await gen(mockReq({ brief: BRIEF, publish: true }), res);
  } finally {
    console.log = realLog;
  }

  if (res.statusCode !== 200) {
    console.log("GOLDEN: FAIL — handler returned " + res.statusCode + " (expected 200)");
    console.log(String(res.body).slice(0, 800));
    process.exit(1);
  }
  const out = JSON.parse(res.body);

  const exists = fs.existsSync(GOLDEN_PATH);
  if (!exists || process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log((exists ? "UPDATED" : "CREATED") + " golden snapshot -> " + path.relative(process.cwd(), GOLDEN_PATH));
    console.log("  ok=" + out.ok + " mode=" + out.mode + " model=" + out.model +
      " slides=" + out.slide_count + " requested=" + out.requested_slide_budget +
      " quality=" + (out.quality && out.quality.score) + " publish=" + (out.publish && out.publish.status));
    process.exit(0);
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
  const a = JSON.stringify(golden);
  const b = JSON.stringify(out);
  if (a === b) {
    console.log("GOLDEN: identical — generate() output is byte-for-byte unchanged.");
    console.log("  ok=" + out.ok + " mode=" + out.mode + " slides=" + out.slide_count +
      " quality=" + (out.quality && out.quality.score) + " publish=" + (out.publish && out.publish.status) +
      " bytes=" + b.length);
    process.exit(0);
  }
  console.log("GOLDEN: DIFFERENT — generate() output changed. The refactor altered behavior.");
  const d = firstDiff(golden, out);
  if (d) {
    console.log("  first diff at: " + d.path);
    console.log("    golden: " + JSON.stringify(d.golden).slice(0, 200));
    console.log("    actual: " + JSON.stringify(d.actual).slice(0, 200));
  }
  console.log("  (golden bytes=" + a.length + " actual bytes=" + b.length + ")");
  process.exit(1);
})().catch((error) => {
  console.error("GOLDEN: harness crashed:", error);
  process.exit(1);
});
