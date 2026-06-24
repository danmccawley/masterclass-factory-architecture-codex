// api/curriculum.js
//
// Curriculum planner (Phase 1). A teacher describes a subject; an LLM proposes a
// structured syllabus — an ordered list of CLASSES, each with a title, a one-line
// scope, and terminal/enabling objectives shaped exactly like brief.template.json.
// The plan is reviewable/editable. Each class maps cleanly onto the existing
// brief -> KB -> generate pipeline (planToBriefs), which is how Phase 2 will
// build the classes. This module is pure + deterministic except the HTTP handler,
// which is the one LLM call (quality confirmed on a live read).
"use strict";

let budget = null;
const llm = require("./llm.js");
function asSystemUser(messages) {
  let system = "", user = "";
  (messages || []).forEach(function (m) {
    if (!m) return;
    if (m.role === "system") system += (system ? "\n" : "") + (m.content || "");
    else user += (user ? "\n" : "") + (m.content || "");
  });
  return { system: system, user: user };
}
try { budget = require("./kb-budget.js"); } catch (e) { budget = null; }

function clampInt(v, lo, hi, dflt) {
  let n = Math.trunc(Number(v));
  if (!isFinite(n)) n = dflt;
  return Math.max(lo, Math.min(hi, n));
}
function asStringArray(v, max) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (let i = 0; i < v.length && out.length < (max || 12); i += 1) {
    const s = String(v[i] == null ? "" : v[i]).trim();
    if (s) out.push(s.slice(0, 240));
  }
  return out;
}
function cleanText(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 160); }
// Mirror the store/canvas slugify so planner-proposed prerequisite links line up
// with the slugs assigned on save and the checkboxes drawn in the canvas.
function slugify(t) {
  return String(t == null ? "" : t).toLowerCase().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/\.+/g, "").slice(0, 80) || "class";
}

// The plan the wizard renders and the orchestrator consumes.
// { subject, audience, level, notes, classes:[ { order, title, summary,
//   objectives:{ terminal[], enabling[] }, suggested_minutes } ] }
function emptyPlan(input) {
  input = input || {};
  return {
    subject: cleanText(input.subject, 200),
    audience: cleanText(input.audience, 160) || "general learners",
    level: cleanText(input.level, 80) || "introductory",
    notes: "",
    classes: []
  };
}

// Build the messages that ask the model for a syllabus as strict JSON.
function buildCurriculumPrompt(input) {
  input = input || {};
  const subject = cleanText(input.subject, 200);
  const audience = cleanText(input.audience, 160) || "general learners";
  const level = cleanText(input.level, 80) || "introductory";
  const scope = cleanText(input.scope, 400);
  const count = input.count ? clampInt(input.count, 1, 40, 8) : 0;
  const countLine = count
    ? "Produce exactly " + count + " classes."
    : "Choose a sensible number of classes (typically 5-12) so each is a single coherent ~45-60 minute class, not a whole course crammed into one.";
  return [
    { role: "system", content:
      "You are a curriculum designer. Given a subject, design a sequenced syllabus as an ordered list of individual CLASSES that build on each other. " +
      countLine + " " +
      "Each class must be narrow enough to teach well in one sitting. Return ONLY a JSON object (no prose, no code fences) of the form: " +
      "{\"level\":\"...\",\"notes\":\"one or two sentences on the overall arc\",\"classes\":[{\"title\":\"...\",\"summary\":\"one sentence on what this class covers\",\"terminal\":[\"1-3 terminal objectives, what the learner can DO after\"],\"enabling\":[\"2-5 enabling objectives, the steps to get there\"],\"prerequisites\":[\"exact titles of the EARLIER classes this one directly builds on\"],\"suggested_minutes\":45}]}. " +
      "For each class, set prerequisites to the exact titles of the earlier classes it directly depends on — reference ONLY classes that appear before it in the list; the first class has none, and most classes build on the one or two immediately before them. " +
      "Objectives must be concrete and measurable. Order classes from foundational to advanced." },
    { role: "user", content:
      "Subject: " + subject + "\nAudience: " + audience + "\nLevel: " + level +
      (scope ? ("\nScope / emphasis / constraints: " + scope) : "") }
  ];
}

// Parse the model response (which may be fenced or prose-wrapped) into an object.
function parsePlanFromLLM(text) {
  let s = String(text || "").trim().replace(/```json|```/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (e) { return null; }
}

// Coerce an arbitrary parsed object into a valid, ordered plan. Tolerant of
// missing/garbage fields: drops empty classes, fills defaults, renumbers order.
function normalizePlan(raw, input) {
  const plan = emptyPlan(input);
  if (raw && typeof raw === "object") {
    if (raw.level) plan.level = cleanText(raw.level, 80);
    if (raw.notes) plan.notes = cleanText(raw.notes, 400);
    const list = Array.isArray(raw.classes) ? raw.classes : (Array.isArray(raw.syllabus) ? raw.syllabus : []);
    list.forEach(function (c) {
      if (!c || typeof c !== "object") return;
      const title = cleanText(c.title || c.name, 160);
      if (!title) return; // a class with no title is not a class
      const terminal = asStringArray(c.terminal || (c.objectives && c.objectives.terminal), 3);
      const enabling = asStringArray(c.enabling || (c.objectives && c.objectives.enabling), 6);
      // Resolve prerequisites against EARLIER classes only. Because we process in
      // order, classes after this one aren't in plan.classes yet, so a forward
      // reference simply can't resolve — the sequence stays acyclic by design.
      const earlierSlugs = {};
      plan.classes.forEach(function (pc) { earlierSlugs[slugify(pc.title)] = true; });
      const prerequisites = [];
      asStringArray(c.prerequisites || c.prereqs || c.builds_on || c.depends_on, 12).forEach(function (p) {
        const s = slugify(p);
        if (earlierSlugs[s] && prerequisites.indexOf(s) < 0) prerequisites.push(s);
      });
      plan.classes.push({
        order: plan.classes.length + 1,
        title: title,
        slug: slugify(title),
        summary: cleanText(c.summary || c.scope || c.description, 240),
        objectives: { terminal: terminal, enabling: enabling },
        prerequisites: prerequisites,
        suggested_minutes: clampInt(c.suggested_minutes || c.minutes, 10, 240, 45)
      });
    });
  }
  return plan;
}

// Is this plan usable? Never throws; returns actionable reasons.
function validatePlan(plan) {
  const errors = [];
  if (!plan || !Array.isArray(plan.classes) || !plan.classes.length) {
    errors.push("The plan has no classes.");
    return { ok: false, errors: errors };
  }
  plan.classes.forEach(function (c, i) {
    if (!c.title) errors.push("Class " + (i + 1) + " has no title.");
    if (!c.objectives || !c.objectives.terminal.length) errors.push("Class " + (i + 1) + " (\"" + (c.title || "?") + "\") has no terminal objective.");
  });
  return { ok: errors.length === 0, errors: errors };
}

// Bridge to the existing pipeline: each class -> a partial brief (overrides that
// the orchestrator deep-merges onto brief.template.json before brief->KB->generate).
// Shapes match the strict brief contract exactly (objectives are flat string arrays).
function planToBriefs(plan) {
  if (!plan || !Array.isArray(plan.classes)) return [];
  return plan.classes.map(function (c) {
    return {
      order: c.order,
      brief: {
        meta: { title: c.title },
        objectives: {
          terminal: c.objectives.terminal.slice(),
          enabling: c.objectives.enabling.slice(),
          out_of_scope: []
        },
        length: { minutes: c.suggested_minutes }
      }
    };
  });
}

// ---- HTTP handler: subject -> plan ----
module.exports = async function curriculumHandler(req, res) {
  function send(status, body) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.end(JSON.stringify(body));
  }
  if (req.method === "OPTIONS") { send(204, {}); return; }
  if (req.method !== "POST") { send(405, { ok: false, error: "method not allowed" }); return; }

  let body = "";
  await new Promise((resolve) => { req.on("data", (c) => { body += c; }); req.on("end", resolve); });
  let parsed = {};
  try { parsed = JSON.parse(body || "{}"); } catch (e) { parsed = {}; }
  const subject = cleanText(parsed.subject, 200);
  if (!subject) { send(422, { ok: false, error: "subject required" }); return; }

  const engine = (parsed.engine && typeof parsed.engine === "object") ? parsed.engine : {};
  const provider = llm.resolveProvider(engine.provider);
  if (!llm.isAvailable(provider)) {
    send(503, { ok: false, error: provider === "openai"
      ? "curriculum planner needs OPENAI_API_KEY on the server"
      : "curriculum planner needs an API key for the selected provider on the server" });
    return;
  }
  const model = provider === "openai" ? (process.env.OPENAI_CURRICULUM_MODEL || "gpt-4o") : (engine.model || undefined);
  try {
    const su = asSystemUser(buildCurriculumPrompt(parsed));
    const result = await llm.completeText({
      provider: provider, model: model, stage: "curriculum",
      system: su.system, user: su.user, temperature: 0.5, timeoutMs: 45000
    });
    let usd = null;
    if (budget && budget.tokenCostUsd && result.usage) {
      try { usd = budget.tokenCostUsd(result.usage.input_tokens, result.usage.output_tokens, result.model); } catch (e) {}
    }
    const plan = normalizePlan(parsePlanFromLLM(result.text), parsed);
    const check = validatePlan(plan);
    if (!check.ok) { send(502, { ok: false, error: "the planner returned an unusable plan", details: check.errors }); return; }
    send(200, {
      ok: true,
      plan: plan,
      class_count: plan.classes.length,
      cost_usd: (typeof usd === "number" ? Math.round(usd * 1e6) / 1e6 : null),
      note: "Review and edit the plan. Each class can then be built through the normal pipeline."
    });
  } catch (e) {
    send(502, { ok: false, error: "curriculum request failed: " + (e && e.message ? e.message : "unknown") });
  }
};

module.exports._internal = {
  emptyPlan: emptyPlan,
  buildCurriculumPrompt: buildCurriculumPrompt,
  parsePlanFromLLM: parsePlanFromLLM,
  normalizePlan: normalizePlan,
  validatePlan: validatePlan,
  planToBriefs: planToBriefs
};
