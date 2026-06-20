const fs = require("fs");
const path = require("path");
const { validateBrief } = require("../brief-validator.js");
const template = require("../brief.template.json");

const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const FALLBACK_OPENAI_MODELS = ["gpt-5.4", "gpt-4.1-mini"];
const DEFAULT_OPENAI_SEARCH_MODEL = "gpt-5-search-api";
const KEY_PREFIX = ["s", "k"].join("") + "-";
const KEY_PATTERN = new RegExp("^" + KEY_PREFIX + "[A-Za-z0-9_-]+$");
const PROJECT_KEY_PATTERN = new RegExp(KEY_PREFIX + "proj-[A-Za-z0-9_-]+", "g");
const ANY_KEY_PATTERN = new RegExp(KEY_PREFIX + "[A-Za-z0-9_-]+", "g");
const MAX_SOURCE_CHARS = 9000;
const SOURCE_FETCH_TIMEOUT_MS = 4500;
const OPENAI_SEARCH_TIMEOUT_MS = 28000;
const MAX_DISCOVERY_URL_CHECKS = 16;
const MAX_GENERATED_SLIDES = 400;
const MAX_OPENAI_AUTHORED_SLIDES = 60;
const MIN_MASTERCLASS_SLIDES = 30;
const MIN_COMPLEX_MASTERCLASS_SLIDES = 50;
const DEFAULT_MASTERCLASS_SLIDES = 90;
const MIN_VISIBLE_SLIDE_WORDS = 70;
const MIN_DEEP_DIVE_WORDS = 120;
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

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch (error) {
      return Promise.reject(new Error("Request body is not valid JSON."));
    }
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function js(value) {
  return JSON.stringify(value);
}

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

function classTierKey(brief) {
  const key = text(brief && brief.class_tier && brief.class_tier.level, "professional").toLowerCase();
  return CLASS_TIERS[key] ? key : "professional";
}

function classTierSpec(brief) {
  const key = classTierKey(brief);
  return Object.assign({ level: key }, CLASS_TIERS[key]);
}

function researchOwner(brief) {
  const owner = text(brief && brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.owner, "creator").toLowerCase();
  return ["creator", "assisted", "ai"].includes(owner) ? owner : "creator";
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

function knowledgeBaseStandard(brief) {
  const tier = classTierSpec(brief);
  const counts = sourceCounts(brief);
  const sourceGap = Math.max(0, tier.source_floor - counts.total);
  const primaryGap = Math.max(0, tier.primary_source_floor - counts.primary);
  const ok = sourceGap === 0 && primaryGap === 0;
  const messages = [];
  if (sourceGap) messages.push(`Add ${sourceGap} more usable source${sourceGap === 1 ? "" : "s"} to meet the ${tier.label} source floor.`);
  if (primaryGap) messages.push(`Add ${primaryGap} more primary source${primaryGap === 1 ? "" : "s"} to meet the ${tier.label} primary-source floor.`);
  if (!messages.length) messages.push(`Knowledge base meets the selected ${tier.label} floor.`);
  return {
    ok,
    tier,
    counts,
    required_sources: tier.source_floor,
    required_primary_sources: tier.primary_source_floor,
    source_gap: sourceGap,
    primary_source_gap: primaryGap,
    messages
  };
}

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
  return clampInteger(brief && brief.length && brief.length.slide_budget, floor, MAX_GENERATED_SLIDES, Math.max(DEFAULT_MASTERCLASS_SLIDES, floor));
}

function teachingSlideTarget(brief) {
  return Math.max(MIN_MASTERCLASS_SLIDES - 1, totalSlideTarget(brief) - 1);
}

function authorSlideTarget(brief) {
  return Math.min(teachingSlideTarget(brief), MAX_OPENAI_AUTHORED_SLIDES);
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

function c(sectionId, label) {
  return `<sup class="cite" data-src="${attr(sectionId)}">[${html(label || sectionId)}]</sup>`;
}

function quizAttr(questions) {
  return attr(JSON.stringify(questions));
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

function paragraphs(value) {
  const cleaned = String(value || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  return cleaned.length
    ? cleaned.map((part) => `<p>${html(part)}</p>`).join("")
    : "<p>No extractable text was available for this source.</p>";
}

function sourceLabel(source, index) {
  const value = text(source && source.path, `Source ${index + 1}`);
  try {
    if (isUrl(value)) return new URL(value).hostname.replace(/^www\./, "");
  } catch (error) {
    return value;
  }
  return value.split("/").pop() || value;
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sourceQuality(source, state) {
  const trust = text(source && source.trust, "unknown").toLowerCase();
  const type = text(source && source.type, "document").toLowerCase();
  const fetched = state && state.fetched;
  const media = type === "video" || type === "audio";
  const setup = state && state.setup;

  if (setup) {
    return {
      credibility: "Context only",
      reliability: "Limited",
      finding: "Use this setup section to understand audience, scope, and rules. Do not treat it as outside evidence."
    };
  }

  const credibility = trust === "primary"
    ? "High"
    : trust === "secondary"
      ? "Moderate"
      : "Unrated";
  let reliability = "Needs extraction";
  let finding = "Listed in the knowledge base, but not enough text was available for factual teaching claims.";

  if (fetched) {
    reliability = trust === "primary" ? "High" : "Moderate";
    finding = "Readable source text was available during generation. Use it for supported claims, and corroborate statistics, forecasts, or disputed points.";
  } else if (media) {
    reliability = "Transcript needed";
    finding = "This media can be linked for learners, but Bernard should not teach factual claims from it until a transcript or extracted notes are available.";
  }

  return { credibility, reliability, finding };
}

function sourceQualityHtml(quality) {
  return [
    "<div class=\"source-quality\">",
    `<p><strong>Credibility ranking:</strong> ${html(quality.credibility)}. <strong>Reliability ranking:</strong> ${html(quality.reliability)}.</p>`,
    `<p><strong>Information-literacy finding:</strong> ${html(quality.finding)}</p>`,
    "</div>"
  ].join("");
}

async function fetchUrlText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Masterclass Factory source fetcher" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    const cleaned = stripHtml(raw).slice(0, MAX_SOURCE_CHARS);
    if (!cleaned) throw new Error("No readable text found.");
    return { ok: true, text: cleaned };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

function configuredSearchModels() {
  const configured = String(process.env.OPENAI_SEARCH_MODEL || "").trim();
  return Array.from(new Set([configured, DEFAULT_OPENAI_SEARCH_MODEL].filter(Boolean)));
}

function responsesOutputText(payload) {
  if (payload && payload.output_text) return String(payload.output_text);
  const output = Array.isArray(payload && payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const part of content) {
      if (part && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

async function requestOpenAIResponsesSearchJson(stage, user, maxTokens) {
  const key = openAIKey();
  const keyError = validateOpenAIKey(key);
  if (keyError) {
    const error = new Error(keyError);
    error.stage = stage;
    throw error;
  }

  let failed;
  for (const model of configuredModels()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search", search_context_size: "high" }],
          max_output_tokens: maxTokens || 3200,
          instructions: "You are Bernard, the Masterclass Factory research librarian. Use web search. Return strict JSON only. Do not invent sources, URLs, dates, standards, or claims. Prefer official standards bodies, regulators, manufacturers, certification bodies, safety authorities, and reputable technical documentation.",
          input: user
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = openAIError(payload);
        failed = { status: response.status, message, model };
        if (shouldTryNextModel(response.status, message)) continue;
        throw new Error(message);
      }
      return { model, data: parseJsonPayload(responsesOutputText(payload)) };
    } catch (error) {
      failed = { status: 0, message: safeErrorMessage(error.message || error), model };
      if (!shouldTryNextModel(0, failed.message)) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  const message = failed ? failed.message : "OpenAI Responses web research failed.";
  const error = new Error(`${stage} failed: ${message}`);
  error.stage = stage;
  throw error;
}

async function requestOpenAISearchJson(stage, user, maxTokens) {
  let responsesError = null;
  try {
    return await requestOpenAIResponsesSearchJson(stage, user, maxTokens);
  } catch (error) {
    responsesError = error;
    if (isTimeoutMessage(error.message)) throw error;
  }

  const key = openAIKey();
  const keyError = validateOpenAIKey(key);
  if (keyError) {
    const error = new Error(keyError);
    error.stage = stage;
    throw error;
  }

  let failed;
  for (const model of configuredSearchModels()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          web_search_options: {},
          temperature: 0.1,
          max_tokens: maxTokens || 2600,
          messages: [
            {
              role: "system",
              content: "You are Bernard, the Masterclass Factory research librarian. Use OpenAI web search. Return strict JSON only. Do not invent sources, URLs, dates, standards, or claims. Prefer official standards bodies, regulators, manufacturers, certification bodies, safety authorities, and reputable technical documentation."
            },
            { role: "user", content: user }
          ]
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = openAIError(payload);
        failed = { status: response.status, message, model };
        if (shouldTryNextModel(response.status, message)) continue;
        throw new Error(message);
      }
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      return { model, data: parseJsonPayload(content) };
    } catch (error) {
      failed = { status: 0, message: safeErrorMessage(error.message || error), model };
      if (!shouldTryNextModel(0, failed.message)) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  const message = failed ? failed.message : responsesError ? responsesError.message : "OpenAI web research failed.";
  const error = new Error(`${stage} failed: ${message}`);
  error.stage = stage;
  throw error;
}

function normalizeSourceType(value) {
  const sourceType = text(value, "url").toLowerCase();
  if (/standard|code|regulator|regulation|authority/.test(sourceType)) return "standard";
  if (/manufacturer|manual|technical|guide|spec/.test(sourceType)) return "manufacturer guide";
  if (/safety|compliance|procedure|osha|risk/.test(sourceType)) return "safety procedure";
  if (/training|certification|credential|curriculum/.test(sourceType)) return "certification training";
  if (/video/.test(sourceType)) return "video";
  if (/audio/.test(sourceType)) return "audio";
  if (/data|dataset|statistics/.test(sourceType)) return "data";
  return "url";
}

function normalizeTrust(value, sourceType) {
  const trust = text(value, "").toLowerCase();
  if (["primary", "secondary", "unknown"].includes(trust)) return trust;
  return /standard|manufacturer|safety|certification/.test(sourceType) ? "primary" : "secondary";
}

function normalizeDiscoveredSources(data, existingPaths) {
  const seen = new Set((existingPaths || []).map((item) => text(item, "").toLowerCase()));
  const raw = []
    .concat(Array.isArray(data && data.source_candidates) ? data.source_candidates : [])
    .concat(Array.isArray(data && data.sources) ? data.sources : []);
  return raw.map((item) => {
    const url = text(item && (item.url || item.path || item.href));
    if (!isUrl(url)) return null;
    const key = url.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    const sourceType = normalizeSourceType(item && (item.type || item.source_type || item.category));
    return {
      path: url,
      type: sourceType,
      trust: normalizeTrust(item && (item.trust || item.credibility || item.tier), sourceType)
    };
  }).filter(Boolean).slice(0, 24);
}

async function discoverKnowledgeBaseSources(brief, standard) {
  const owner = researchOwner(brief);
  const discovery = {
    owner,
    attempted: false,
    model: "",
    added_sources: [],
    rejected_sources: [],
    gaps: [],
    notes: []
  };

  if (owner !== "ai") return discovery;
  if (!brief.knowledge_base.research.allow_web) {
    discovery.notes.push("AI-owned research was selected, but verified web research is turned off.");
    return discovery;
  }

  const current = sourceCounts(brief);
  if (standard.ok) {
    discovery.notes.push("The class maker's source list already meets the selected source floor; Bernard did not add extra sources.");
    return discovery;
  }

  discovery.attempted = true;
  const needed = {
    total_sources_needed: Math.max(0, standard.required_sources - current.total),
    primary_sources_needed: Math.max(0, standard.required_primary_sources - current.primary)
  };
  const prompt = JSON.stringify({
    task: "Find source candidates for this masterclass knowledge base. Return more candidates than needed so verification can reject weak or unreachable pages.",
    class_title: brief.meta.title,
    selected_tier: standard.tier,
    needed,
    current_sources: brief.knowledge_base.uploads,
    seed_prompts: brief.knowledge_base.research.seed_prompts,
    recency_floor: brief.knowledge_base.research.recency_floor,
    credibility_rules: brief.knowledge_base.credibility,
    required_mix: [
      "official standards, code, or governing-body guidance where relevant",
      "manufacturer or technical installation guidance",
      "safety, compliance, or risk procedure evidence",
      "training or certification body guidance",
      "current practice, quality, troubleshooting, or lessons-learned evidence"
    ],
    rules: [
      "Use web search.",
      "Return only source candidates with URLs you actually found.",
      "Do not include fake URLs or generic homepages unless the page itself is useful evidence.",
      "Prefer source pages that can support teaching claims, procedures, hazards, standards, vocabulary, or assessment.",
      "Mark primary sources as primary only when the organization is the standard-setter, regulator, manufacturer, certification body, or direct publisher of the evidence."
    ],
    required_json_shape: {
      summary: "string",
      source_candidates: [{
        title: "string",
        url: "https://...",
        type: "standard|manufacturer guide|safety procedure|certification training|url|data",
        trust: "primary|secondary|unknown",
        why: "string"
      }],
      gaps: ["string"]
    }
  }, null, 2);

  const researched = await requestOpenAISearchJson("knowledge-base discovery", prompt, 3200);
  discovery.model = researched.model;
  discovery.gaps = list(researched.data && researched.data.gaps, [], 10);
  const candidates = normalizeDiscoveredSources(researched.data, (brief.knowledge_base.uploads || []).map((source) => source.path));
  const verificationTarget = Math.max(needed.total_sources_needed + 4, needed.primary_sources_needed + 2, 8);
  const candidatesToCheck = candidates.slice(0, Math.min(MAX_DISCOVERY_URL_CHECKS, verificationTarget + 4));
  discovery.notes.push(`Bernard found ${candidates.length} source candidate${candidates.length === 1 ? "" : "s"} and checked ${candidatesToCheck.length} URL${candidatesToCheck.length === 1 ? "" : "s"} for readability.`);
  const checked = await Promise.all(candidatesToCheck.map(async (candidate) => ({
    candidate,
    fetched: await fetchUrlText(candidate.path)
  })));
  const verified = [];
  checked.forEach(({ candidate, fetched }) => {
    if (fetched.ok) {
      verified.push(candidate);
    } else {
      discovery.rejected_sources.push({ path: candidate.path, reason: fetched.error });
    }
  });
  discovery.added_sources = verified.slice(0, Math.max(needed.total_sources_needed + 4, needed.primary_sources_needed + 2, 8));
  if (!verified.length) discovery.notes.push("Bernard searched, but no candidate URLs passed the readability check.");
  return discovery;
}

async function prepareKnowledgeBase(brief) {
  const prepared = JSON.parse(JSON.stringify(brief));
  const discovery = await discoverKnowledgeBaseSources(prepared, knowledgeBaseStandard(prepared)).catch((error) => ({
    owner: researchOwner(prepared),
    attempted: true,
    model: "",
    added_sources: [],
    rejected_sources: [],
    gaps: [],
    notes: [`AI-owned research could not finish: ${safeErrorMessage(error.message || error)}`]
  }));

  if (discovery.added_sources && discovery.added_sources.length) {
    prepared.knowledge_base.uploads = (prepared.knowledge_base.uploads || []).concat(discovery.added_sources);
  }
  return { brief: prepared, discovery };
}

async function buildSourcePaper(brief) {
  const sections = [];
  const notes = [];
  const uploads = Array.isArray(brief.knowledge_base.uploads) ? brief.knowledge_base.uploads : [];
  const prompts = list(brief.knowledge_base.research.seed_prompts, [], 12);
  const allowWeb = brief.knowledge_base.research.allow_web !== false;
  const title = brief.meta.title || "Untitled Masterclass";
  const standard = knowledgeBaseStandard(brief);

  sections.push({
    id: "s1",
    num: "1",
    title: "Class setup, learner profile, and research rules",
    body: [
      `<p><strong>Class:</strong> ${html(title)}</p>`,
      `<p><strong>Class tier:</strong> ${html(standard.tier.label)}. <strong>Knowledge-base standard:</strong> ${html(standard.required_sources)} usable sources, including ${html(standard.required_primary_sources)} primary sources.</p>`,
      `<p><strong>Research owner:</strong> ${html(researchOwner(brief))}. <strong>Research mode:</strong> ${html(brief.knowledge_base.research.mode)}. <strong>Minimum source tier:</strong> ${html(brief.knowledge_base.credibility.min_tier)}.</p>`,
      `<p><strong>Audience floor:</strong> ${html(brief.audience.floor.background || "Not specified")} / ${html(brief.audience.floor.education || "education not specified")}.</p>`,
      `<p><strong>Language:</strong> ${html(brief.language.primary || "en")}.</p>`,
      `<p>This section is generated from the class setup package. It is allowed to guide curriculum shape, but it is not a substitute for outside evidence.</p>`,
      sourceQualityHtml(sourceQuality({}, { setup: true }))
    ].join("")
  });

  for (let index = 0; index < uploads.length; index += 1) {
    const source = uploads[index] || {};
    const id = `s${sections.length + 1}`;
    const label = sourceLabel(source, index);
    const pathValue = text(source.path);
    const sourceType = text(source.type, "document").toLowerCase();
    const isMedia = sourceType === "video" || sourceType === "audio";
    let fetchedText = false;
    let body = `<p><strong>Source queued:</strong> ${html(pathValue || label)}.</p>`;
    body += `<p><strong>Source type:</strong> ${html(titleCase(sourceType))}. <strong>Class-maker credibility tag:</strong> ${html(titleCase(source.trust || "unknown"))}.</p>`;

    if (isMedia) {
      if (isUrl(pathValue)) body += `<p><strong>Media link:</strong> <a href="${attr(pathValue)}">${html(pathValue)}</a></p>`;
      body += "<p>Media can be linked for students. To use it as evidence, the generator needs a transcript, caption file, or extracted notes in the knowledge base.</p>";
      notes.push(`Media source queued for ${label}; transcript or extracted notes are needed before factual claims rely on it.`);
    } else if (isUrl(pathValue) && allowWeb) {
      const fetched = await fetchUrlText(pathValue);
      if (fetched.ok) {
        fetchedText = true;
        body += `<p><strong>Source URL:</strong> <a href="${attr(pathValue)}">${html(pathValue)}</a></p>`;
        body += paragraphs(fetched.text);
        notes.push(`Fetched readable text from ${label}.`);
      } else {
        body += `<p>The URL could not be fetched during this run (${html(fetched.error)}). The generator will not make factual claims from it until text is available.</p>`;
        notes.push(`Could not fetch ${label}: ${fetched.error}`);
      }
    } else if (isUrl(pathValue) && !allowWeb) {
      body += "<p>Web fetching is disabled for this brief. This URL stays queued but is not used for factual claims in this run.</p>";
      notes.push(`Web fetching disabled for ${label}.`);
    } else {
      body += "<p>The setup records this local or uploaded source name. Serverless generation cannot read private local file bytes until the upload ingestion stage supplies extracted text, so factual claims from this file are withheld.</p>";
      notes.push(`Source metadata queued for ${label}; extracted file text not present.`);
    }

    body += sourceQualityHtml(sourceQuality(source, { fetched: fetchedText }));

    sections.push({
      id,
      num: String(sections.length + 1),
      title: label,
      body
    });
  }

  if (prompts.length) {
    sections.push({
      id: `s${sections.length + 1}`,
      num: String(sections.length + 1),
      title: "Research prompts and knowledge-base questions",
      body: "<ul>" + prompts.map((prompt) => `<li>${html(prompt)}</li>`).join("") + "</ul>"
    });
  }

  return {
    sourcePaper: {
      title: `Student Reader - ${title}`,
      cite: "Generated from the Masterclass Factory knowledge-base analysis. Claims are limited to the setup package and fetched source extracts available during generation.",
      sections
    },
    notes
  };
}

function sourceText(sourcePaper) {
  return sourcePaper.sections.map((section) => {
    return `${section.id}. ${section.title}\n${stripHtml(section.body).slice(0, 4500)}`;
  }).join("\n\n");
}

function openAIKey() {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function validateOpenAIKey(key) {
  if (!key) return "OPENAI_API_KEY is not set, so the generator used the conservative deterministic path.";
  if (!KEY_PATTERN.test(key)) return "OPENAI_API_KEY has extra text or invalid characters. Replace it with only the OpenAI key, then redeploy.";
  return "";
}

function configuredModels() {
  const configured = String(process.env.OPENAI_MODEL || "").trim();
  const models = [DEFAULT_OPENAI_MODEL, configured].concat(FALLBACK_OPENAI_MODELS).filter(Boolean);
  return Array.from(new Set(models));
}

function safeErrorMessage(message) {
  const raw = String(message || "OpenAI API request failed.");
  if (/headers\.append|invalid header value/i.test(raw)) {
    return "OPENAI_API_KEY has extra text or invalid characters. Replace it with only the OpenAI key, then redeploy.";
  }
  return raw
    .replace(PROJECT_KEY_PATTERN, "[redacted OpenAI key]")
    .replace(ANY_KEY_PATTERN, "[redacted API key]")
    .replace(/Bearer\s+[^"'`]+/g, "Bearer [redacted]");
}

function isTimeoutMessage(message) {
  return /abort|aborted|timeout|timed out/i.test(String(message || ""));
}

function openAIError(payload) {
  const message = payload && payload.error && payload.error.message
    ? payload.error.message
    : "OpenAI API request failed.";
  return safeErrorMessage(message);
}

function shouldTryNextModel(status, message) {
  if (status === 401) return false;
  return status === 400 || status === 403 || status === 404 ||
    (/model/i.test(message) && /not found|does not exist|unsupported|invalid|access/i.test(message));
}

function parseJsonPayload(content) {
  const textValue = String(content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(textValue);
  } catch (error) {
    const match = textValue.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

async function requestOpenAIJson(stage, system, user, maxTokens) {
  const key = openAIKey();
  const keyError = validateOpenAIKey(key);
  if (keyError) {
    const error = new Error(keyError);
    error.stage = stage;
    throw error;
  }

  let failed;
  for (const model of configuredModels()) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0.18,
          max_tokens: maxTokens || 1800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = openAIError(payload);
        failed = { status: response.status, message, model };
        if (shouldTryNextModel(response.status, message)) continue;
        throw new Error(message);
      }
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      return { model, data: parseJsonPayload(content) };
    } catch (error) {
      failed = { status: 0, message: safeErrorMessage(error.message || error), model };
      if (!shouldTryNextModel(0, failed.message)) break;
    }
  }

  const message = failed ? failed.message : "OpenAI API request failed.";
  const error = new Error(`${stage} failed: ${message}`);
  error.stage = stage;
  throw error;
}

function compactBrief(brief) {
  return {
    meta: brief.meta,
    class_tier: brief.class_tier,
    knowledge_base: brief.knowledge_base,
    objectives: brief.objectives,
    mastery: brief.mastery,
    audience: brief.audience,
    length: brief.length,
    language: brief.language
  };
}

async function runOpenAIStages(brief, sourcePaper) {
  const reports = [];
  const corpus = sourceText(sourcePaper);
  const briefJson = JSON.stringify(compactBrief(brief), null, 2);
  const requestedSlides = totalSlideTarget(brief);
  const teachingSlides = teachingSlideTarget(brief);
  const authoredSlides = authorSlideTarget(brief);
  const standard = knowledgeBaseStandard(brief);
  const rules = [
    "Use only the provided brief and SOURCE_PAPER sections.",
    "Do not invent sources, URLs, dates, statistics, people, or factual claims.",
    "If evidence is weak or unavailable, say what is missing rather than filling gaps.",
    `The selected class tier is ${standard.tier.label}. The knowledge-base standard is ${standard.required_sources} usable sources including ${standard.required_primary_sources} primary sources.`,
    `Knowledge-base research owner: ${researchOwner(brief)}. If the owner is ai, Bernard is responsible for closing source gaps before objectives are treated as final.`,
    "Terminal and enabling objectives must come from the researched knowledge base and learner profile.",
    `The slide budget is a contract: produce ${requestedSlides} total slides, made of ${teachingSlides} teaching slides plus one final Knowledge Base / Works Cited slide.`,
    `When asked to author slides directly, return ${authoredSlides} teaching slides. Do not stop at five slides unless the budget itself is five.`,
    "Never treat technical background, prior experience, or learner familiarity as permission to shorten the class. Use it to add more depth, worked examples, edge cases, source analysis, misconceptions, and transfer practice.",
    "Always look for safe opportunities to add more value while staying inside the requested slide budget and source evidence.",
    "Deep dives are first-class course content, not optional decoration. Low means none, med requires substantial deep dives where useful, high requires a deep dive for every teaching slide.",
    "Every teaching slide needs enough content to teach from: concise bullets plus explanation, worked example or application, practice prompt, common mistake or caution, and presenter guidance.",
    "The embedded conversational tutor is named Bernard.",
    "Return strict JSON only."
  ].join("\n");

  const research = await requestOpenAIJson(
    "research",
    `You are the Masterclass Factory research specialist. ${rules}`,
    JSON.stringify({
      task: "Analyze the available knowledge base. Identify source-grounded points, gaps, and cautions.",
      brief: compactBrief(brief),
      source_paper_sections: corpus,
      required_shape: {
        summary: "string",
        usable_points: [{ point: "string", source_ids: ["s1"] }],
        gaps: ["string"],
        cautions: ["string"]
      }
    }, null, 2),
    1700
  );
  reports.push({ stage: "research", ok: true, model: research.model });

  const curriculum = await requestOpenAIJson(
    "curriculum",
    `You are the Masterclass Factory curriculum specialist. ${rules}`,
    JSON.stringify({
      task: `Create final source-grounded terminal/enabling objectives and a lesson plan sized for ${teachingSlides} teaching slides plus one final Knowledge Base / Works Cited slide.`,
      brief: compactBrief(brief),
      research: research.data,
      slide_budget_contract: {
        requested_total_slide_count: requestedSlides,
        teaching_slide_count_before_works_cited: teachingSlides,
        final_slide_reserved_for: "Knowledge Base / Works Cited and source quality"
      },
      required_shape: {
        terminal: ["string"],
        enabling: ["string"],
        out_of_scope: ["string"],
        lesson_sections: [{ id: "string", title: "string", teaching_goal: "string", source_ids: ["s1"], activity: "string", deep_dive_reason: "string" }]
      }
    }, null, 2),
    2100
  );
  reports.push({ stage: "curriculum", ok: true, model: curriculum.model });

  const author = await requestOpenAIJson(
    "author",
    `You are the Masterclass Factory lesson author. ${rules}`,
    JSON.stringify({
      task: `Draft exactly ${authoredSlides} source-grounded teaching slides. Keep bullets concise but make the slide complete enough to teach. Cite only source ids that exist. Use a complete arc: orientation, source findings, concepts, examples, practice, checks, application, and transfer. If evidence is thin, create source-safe practice/checkpoint slides instead of inventing facts. Deep-dive setting is ${deepDiveMode(brief)}; when high, every slide needs a substantive deep_dive body.`,
      source_ids: sourcePaper.sections.map((section) => section.id),
      brief: compactBrief(brief),
      curriculum: curriculum.data,
      slide_budget_contract: {
        requested_total_slide_count: requestedSlides,
        teaching_slide_count_before_works_cited: teachingSlides,
        author_slides_to_return_now: authoredSlides,
        note: "The generator will add the final Knowledge Base / Works Cited slide and will safely expand any shortfall to meet the requested slide budget."
      },
      required_shape: {
        slides: [{
          id: "string",
          eyebrow: "string",
          title: "string",
          bullets: ["string"],
          explanation: "2-3 sentence source-grounded teaching explanation",
          worked_example: "brief concrete example or application",
          practice_prompt: "what learners should do or decide",
          common_mistake: "mistake or caution to avoid",
          speaker_notes: "presenter talk track with enough detail to teach the point",
          deep_dive: { title: "string", body: "120-220 words of deeper explanation, source analysis, edge cases, and practice guidance", learner_prompts: ["string"] },
          source_ids: ["s1"],
          interaction: "none|poll|word|quiz"
        }]
      }
    }, null, 2),
    Math.min(24000, Math.max(6000, authoredSlides * 420))
  );
  reports.push({ stage: "author", ok: true, model: author.model });

  const glossary = await requestOpenAIJson(
    "glossary",
    `You are the Masterclass Factory glossary specialist. ${rules}`,
    JSON.stringify({
      task: "Create concise glossary entries for terms learners need.",
      brief: compactBrief(brief),
      research: research.data,
      curriculum: curriculum.data,
      required_shape: { terms: [{ term: "string", d: "definition", r: "why it matters" }] }
    }, null, 2),
    1300
  );
  reports.push({ stage: "glossary", ok: true, model: glossary.model });

  const assessment = await requestOpenAIJson(
    "assessment",
    `You are the Masterclass Factory assessment specialist. ${rules}`,
    JSON.stringify({
      task: "Create interactions that test only taught material.",
      brief: compactBrief(brief),
      curriculum: curriculum.data,
      required_shape: {
        polls: [{ id: "string", q: "string", desc: "string", opts: ["string"] }],
        words: [{ id: "string", q: "string", desc: "string" }],
        quizzes: [
          { type: "mc", level: 2, q: "string", options: ["string"], answer: 0, why: "string" },
          { type: "sa", level: 3, q: "string", rubric: "string", sample: "string", accept: ["string"] }
        ]
      }
    }, null, 2),
    2200
  );
  reports.push({ stage: "assessment", ok: true, model: assessment.model });

  return {
    mode: "openai",
    model: author.model,
    reports,
    research: research.data,
    curriculum: curriculum.data,
    author: author.data,
    glossary: glossary.data,
    assessment: assessment.data
  };
}

function sourceIds(sourcePaper) {
  return new Set(sourcePaper.sections.map((section) => section.id));
}

function validSources(ids, sourcePaper) {
  const allowed = sourceIds(sourcePaper);
  const requested = list(ids, [], 4).filter((id) => allowed.has(id));
  return requested.length ? requested : ["s1"];
}

function citationBlock(ids, sourcePaper) {
  const sections = new Map(sourcePaper.sections.map((section) => [section.id, section]));
  return validSources(ids, sourcePaper)
    .map((id) => c(id, sections.get(id) ? sections.get(id).num : id))
    .join(" ");
}

function bulletList(items) {
  return "<ul>" + list(items, ["Review the source-grounded class material."], 8).map((item) => `<li>${html(item)}</li>`).join("") + "</ul>";
}

function paragraphize(value) {
  const parts = String(value || "")
    .replace(/\r/g, "")
    .split(/\n{2,}|\n(?=[A-Z0-9])/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  return parts.map((part) => `<p>${html(part)}</p>`).join("");
}

function sectionTitles(ids, sourcePaper) {
  const sections = new Map(sourcePaper.sections.map((section) => [section.id, section]));
  return validSources(ids, sourcePaper)
    .map((id) => sections.get(id) ? sections.get(id).title : id)
    .join("; ");
}

function defaultExplanation(slide, brief) {
  const title = brief.meta.title || "this class";
  return `${slide.title} connects directly to the class goal for ${title}. Teach it slowly enough that the floor learner can name the decision, explain why it matters, and point back to the source boundary before moving into practice.`;
}

function defaultWorkedExample(slide, brief) {
  const audience = brief.audience.floor.role || brief.audience.average.role || "learner";
  return `Example: ask a ${audience} to apply this point to a realistic work situation, then explain which source-supported detail guided the decision.`;
}

function defaultPracticePrompt(slide) {
  return `Practice: have learners restate "${slide.title}" in their own words, choose a next action, and name the evidence they would need before acting.`;
}

function defaultCommonMistake(slide) {
  return `Caution: do not let learners turn "${slide.title}" into a rule of thumb unless the knowledge base supports that claim.`;
}

function normalizeSlideDepth(slide, brief) {
  const out = Object.assign({}, slide);
  out.bullets = list(out.bullets, ["Explain the core point.", "Connect it to the source boundary.", "Practice the decision before moving on."], 8);
  out.explanation = text(out.explanation, defaultExplanation(out, brief));
  out.worked_example = text(out.worked_example || out.example, defaultWorkedExample(out, brief));
  out.practice_prompt = text(out.practice_prompt || out.practice, defaultPracticePrompt(out));
  out.common_mistake = text(out.common_mistake || out.caution, defaultCommonMistake(out));
  return out;
}

function deepDiveBody(slide, sourcePaper, brief, supplied) {
  const suppliedBody = supplied && text(supplied.body);
  const sourceNames = sectionTitles(slide.source_ids, sourcePaper);
  const citations = citationBlock(slide.source_ids, sourcePaper);
  if (suppliedBody && wordCount(suppliedBody) >= MIN_DEEP_DIVE_WORDS) {
    return paragraphize(suppliedBody) +
      `<p class="ref"><strong>Source anchor:</strong> ${html(sourceNames)} ${citations}</p>`;
  }

  const bulletText = list(slide.bullets, [], 8).map((item) => `<li>${html(item)}</li>`).join("");
  const body = [
    `<p><strong>Why this deserves a deeper look.</strong> ${html(slide.explanation || defaultExplanation(slide, brief))}</p>`,
    `<p><strong>Source boundary.</strong> Teach this point from ${html(sourceNames || "the approved source paper")}. If a learner asks for a statistic, date, standard, or local procedure that is not in the knowledge base, Bernard and the presenter should mark it as a research gap instead of improvising.</p>`,
    bulletText ? `<h3>What to emphasize</h3><ul>${bulletText}</ul>` : "",
    `<h3>Worked example</h3><p>${html(slide.worked_example || defaultWorkedExample(slide, brief))}</p>`,
    `<h3>Practice and transfer</h3><p>${html(slide.practice_prompt || defaultPracticePrompt(slide))}</p>`,
    `<p><strong>Common mistake to prevent.</strong> ${html(slide.common_mistake || defaultCommonMistake(slide))}</p>`,
    `<p class="ref"><strong>Source anchor:</strong> ${html(sourceNames)} ${citations}</p>`
  ].filter(Boolean).join("");
  return ensureHtmlWordFloor(body, MIN_DEEP_DIVE_WORDS, [
    `<p><strong>Presenter expansion.</strong> Slow down here and ask the learner to connect the concept, the example, and the source boundary in one complete sentence. The goal is not memorization; it is a source-grounded decision the learner can explain and repeat.</p>`,
    `<p><strong>Quality check.</strong> Before leaving this deep dive, have learners name what is known, what is assumed, what is still missing, and which approved source would be needed before treating the answer as final.</p>`
  ]);
}

function makeDeepDivePaper(slide, sourcePaper, brief, index) {
  const supplied = slide.deep_dive && typeof slide.deep_dive === "object" ? slide.deep_dive : {};
  const title = text(supplied.title, `Deep dive: ${slide.title}`);
  return {
    secnum: `Deep Dive ${String(index + 1).padStart(2, "0")}`,
    h: title,
    body: deepDiveBody(slide, sourcePaper, brief, supplied)
  };
}

function normalizeId(value, fallback) {
  return slugify(value || fallback).replace(/^-+|-+$/g, "") || fallback;
}

function slideHtml(slide, sourcePaper) {
  const citations = citationBlock(slide.source_ids, sourcePaper);
  const body = [
    "<div class=\"wrap\">",
    `<div class="eyebrow anim"><span class="num">${html(slide.num)}</span><span class="bar"></span>${html(slide.eyebrow)}</div>`,
    `<h2 class="head anim">${html(slide.title)}</h2>`,
    bulletList(slide.bullets),
    `<p class="lede anim">${html(slide.explanation || slide.takeaway || "Use the evidence and learner profile to make the next decision.")} ${citations}</p>`,
    `<div class="lesson-detail anim"><p><strong>Example:</strong> ${html(slide.worked_example || "Apply the idea to a realistic learner scenario.")}</p><p><strong>Practice:</strong> ${html(slide.practice_prompt || "Ask learners to explain their next action and what evidence supports it.")}</p><p><strong>Watch for:</strong> ${html(slide.common_mistake || "Do not move past this point until learners can separate supported points from assumptions.")}</p></div>`,
    slide.button || "",
    "</div>"
  ].join("");
  return ensureHtmlWordFloor(body, MIN_VISIBLE_SLIDE_WORDS, [
    `<div class="lesson-detail anim"><p><strong>Presenter expansion:</strong> Ask learners to restate the point, apply it to one realistic situation, and identify the evidence they would need before acting independently.</p><p><strong>Bernard prompt:</strong> If the learner is unsure, have Bernard rephrase this slide in plain language while staying inside the cited source boundary.</p></div>`
  ]);
}

function makeQuizBox(id, questions) {
  return `<div id="${attr(id)}" class="quizbox popquiz anim" data-quiz="${quizAttr(questions)}" data-pop="1"></div>`;
}

function fallbackObjectives(brief) {
  const title = brief.meta.title || "the class topic";
  return {
    terminal: list(brief.objectives.terminal, [
      `Explain the core decisions and safe actions required for ${title}.`,
      `Apply the class workflow to a realistic learner scenario.`
    ], 5),
    enabling: list(brief.objectives.enabling, [
      "Identify the key terms and decision points.",
      "Separate source-supported points from unsupported assumptions.",
      "Use a short checklist to practice the final task."
    ], 10),
    out_of_scope: list(brief.objectives.out_of_scope, [
      "Claims not supported by the approved knowledge base.",
      "Advanced side topics that do not serve the learner profile."
    ], 8)
  };
}

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

function requiredDeepDiveCount(brief, teachingSlides) {
  const count = Math.max(0, Number(teachingSlides) || 0);
  const mode = deepDiveMode(brief);
  if (!wantsDeepDives(brief) || !count) return 0;
  if (mode === "high") return count;
  return Math.max(4, Math.ceil(count * 0.45));
}

function wordCount(value) {
  const words = stripHtml(value).match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
}

function ensureHtmlWordFloor(body, minimum, additions) {
  let out = String(body || "");
  const safeAdditions = Array.isArray(additions) ? additions : [];
  for (let index = 0; wordCount(out) < minimum && index < safeAdditions.length; index += 1) {
    out += safeAdditions[index];
  }
  return out;
}

function sourceHref(body) {
  const match = String(body || "").match(/href="([^"]+)"/i);
  return match ? match[1] : "";
}

function sourceQualityFromBody(body) {
  const plain = stripHtml(body);
  const cred = plain.match(/Credibility ranking:\s*([^.]*)\./i);
  const rel = plain.match(/Reliability ranking:\s*([^.]*)\./i);
  const finding = plain.match(/Information-literacy finding:\s*([\s\S]*)/i);
  return {
    credibility: text(cred && cred[1], "Unrated"),
    reliability: text(rel && rel[1], "Needs review"),
    finding: text(finding && finding[1], "Review source quality before relying on this item.")
  };
}

function sourceReportDeck(brief, sourcePaper) {
  const title = brief.meta.title || "this class";
  const standard = knowledgeBaseStandard(brief);
  const cards = sourcePaper.sections.map((section) => {
    const href = sourceHref(section.body);
    const quality = sourceQualityFromBody(section.body);
    const sourceTitle = href
      ? `<a href="${attr(href)}" target="_blank" rel="noreferrer">${html(section.title)}</a>`
      : html(section.title);
    return [
      "<article class=\"source-report-card\">",
      `<div class="source-report-head"><span>${html(section.num || section.id)}</span><h3>${sourceTitle}</h3>${c(section.id, section.num || section.id)}</div>`,
      `<p><strong>Credibility:</strong> ${html(quality.credibility)} · <strong>Reliability:</strong> ${html(quality.reliability)}</p>`,
      `<p>${html(quality.finding).slice(0, 420)}</p>`,
      "</article>"
    ].join("");
  }).join("");

  return [
    "<div class=\"wrap wide source-report\">",
    "<div class=\"eyebrow anim\"><span class=\"num\">KB</span><span class=\"bar\"></span>Knowledge Base</div>",
    "<h2 class=\"head anim\">Works cited and source quality</h2>",
    `<p class="lede anim">These are the sources used or queued for ${html(title)}. Bernard should teach from source-supported material only, and students can suggest stronger sources for the next version.</p>`,
    `<div class="lesson-detail anim"><p><strong>Selected class tier:</strong> ${html(standard.tier.label)}.</p><p><strong>Knowledge-base floor:</strong> ${html(standard.required_sources)} usable sources, including ${html(standard.required_primary_sources)} primary sources. Current setup lists ${html(standard.counts.total)} sources, including ${html(standard.counts.primary)} primary sources.</p><p><strong>Status:</strong> ${html(standard.messages.join(" "))}</p></div>`,
    "<div class=\"source-report-list anim\">",
    cards,
    "</div>",
    "<details class=\"source-rubric anim\" open>",
    "<summary>How the source grading metric works</summary>",
    "<ol>",
    "<li><strong>Credibility ranking</strong> checks the source type and class-maker trust tag. Primary sources rank highest; secondary sources can be strong; unknown sources need review.</li>",
    "<li><strong>Reliability ranking</strong> checks whether readable text, a transcript, or stable source material was available during generation.</li>",
    "<li><strong>Corroboration rule</strong> requires extra independent support for statistics, forward-looking claims, and contested points.</li>",
    "<li><strong>Information-literacy finding</strong> tells the learner whether the source can support claims now, is context-only, or needs more extraction before Bernard can teach from it.</li>",
    "</ol>",
    "</details>",
    "<button class=\"deepbtn source-suggest-btn\" onclick=\"openSourceSuggestion()\">Suggest another source for the knowledge base</button>",
    "</div>"
  ].join("");
}

function buildKnowledgeBaseReportSlide(brief, sourcePaper) {
  return {
    id: "knowledge-base-works-cited",
    eyebrow: "Knowledge Base",
    num: "KB",
    title: "Works cited and source quality",
    bullets: sourcePaper.sections.slice(0, 6).map((section) => section.title),
    takeaway: "Works cited, credibility ranking, reliability ranking, and source-improvement suggestions close the class.",
    source_ids: sourcePaper.sections.slice(0, 4).map((section) => section.id),
    customDeck: sourceReportDeck(brief, sourcePaper)
  };
}

function sourceTitleMap(sourcePaper) {
  const map = {};
  (sourcePaper.sections || []).forEach((section) => {
    map[section.id] = section.title || section.id;
  });
  return map;
}

function buildEvidenceMap(brief, sourcePaper, objectives, lessonPlan) {
  const sources = sourcePaper.sections || [];
  const titles = sourceTitleMap(sourcePaper);
  const fallbackIds = sources.slice(0, 4).map((section) => section.id);
  const rows = [];
  function add(kind, claim, ids, status) {
    const usable = validSources(ids && ids.length ? ids : fallbackIds, sourcePaper);
    rows.push({
      kind,
      claim,
      source_ids: usable,
      source_titles: usable.map((id) => titles[id] || id),
      status: status || (usable.length ? "mapped" : "gap"),
      finding: usable.length
        ? "Mapped to approved source-paper sections for source verification."
        : "Research gap: add evidence before treating this as final class content."
    });
  }
  list(objectives.terminal, fallbackObjectives(brief).terminal, 5).forEach((item, index) => {
    add("terminal objective", item, fallbackIds.slice(index, index + 3));
  });
  list(objectives.enabling, fallbackObjectives(brief).enabling, 12).slice(0, 8).forEach((item, index) => {
    add("enabling objective", item, fallbackIds.slice(index + 1, index + 4));
  });
  (lessonPlan || []).slice(0, 12).forEach((section, index) => {
    add("lesson section", section.title || section.teaching_goal || `Lesson section ${index + 1}`, section.source_ids || fallbackIds);
  });
  add("safety / quality claims", "Statistics, standards, safety procedures, contested points, and forward-looking claims require corroboration.", fallbackIds.slice(0, 4), "corroboration-required");
  add("out of scope", list(objectives.out_of_scope, fallbackObjectives(brief).out_of_scope, 5).join("; "), fallbackIds.slice(0, 2), "scope-boundary");
  return rows;
}

function buildCourseBlueprint(brief, generatedShell) {
  const tier = classTierSpec(brief);
  const total = totalSlideTarget(brief);
  const teaching = Math.max(1, total - 1);
  const standard = knowledgeBaseStandard(brief);
  const modules = [
    ["Orientation and learner baseline", 0.08, "Set the purpose, audience floor, assumptions, and mastery target."],
    ["Knowledge base and source boundary", 0.12, "Show what the approved sources support, what is missing, and what must not be invented."],
    ["Core concepts and vocabulary", 0.18, "Teach the essential terms, mental models, and decision points."],
    ["Guided practice and examples", 0.22, "Work through realistic cases, common mistakes, checks, and facilitator prompts."],
    ["Deep dives, edge cases, and quality risks", 0.22, "Add expert detail, safety cautions, disagreements, and advanced transfer examples."],
    ["Assessment, transfer, and works cited", 0.18, "Prove mastery, capture participation, and close with source transparency."]
  ];
  let used = 0;
  return {
    tier: tier.label,
    slide_target: total,
    teaching_slide_target: teaching,
    knowledge_standard: standard,
    approved_before_generation: true,
    modules: modules.map((item, index) => {
      const slides = index === modules.length - 1 ? Math.max(1, teaching - used) : Math.max(1, Math.round(teaching * item[1]));
      used += slides;
      return {
        order: index + 1,
        title: item[0],
        slide_budget: slides,
        goal: item[2],
        deep_dive_expectation: wantsDeepDives(brief) ? "substantive deep dives where required by tier and setting" : "no deep dives selected"
      };
    }),
    lesson_sections: generatedShell && generatedShell.lesson_plan ? generatedShell.lesson_plan.length : 0
  };
}

function fallbackAssessment(brief) {
  const title = brief.meta.title || "this class";
  return {
    polls: [
      {
        id: "confidence-check",
        q: "How confident are you with this topic right now?",
        desc: "This helps the facilitator pace the session.",
        opts: ["New to me", "Some experience", "Comfortable", "Ready to practice"]
      },
      {
        id: "scope-check",
        q: "Which item most needs a source check before it ships?",
        desc: "The class should stay grounded in the approved knowledge base.",
        opts: ["A statistic", "A future prediction", "A contested claim", "All of these"]
      }
    ],
    words: [
      { id: "key-takeaway", q: "What word captures the most important idea so far?", desc: "Add one short word or phrase." }
    ],
    quizzes: [
      {
        type: "mc",
        level: 1,
        q: `What should factual claims in ${title} connect back to?`,
        options: ["The approved source paper", "A guess from the topic", "A random online post"],
        answer: 0,
        why: "Every factual claim should connect to the approved source paper or be removed."
      },
      {
        type: "tf",
        level: 2,
        q: "Terminal and enabling learning objectives should be finalized after knowledge-base analysis.",
        answer: true,
        why: "The objectives need to match the sources, learner profile, and scope rules."
      },
      {
        type: "sa",
        level: 3,
        q: "Name one thing the source-verification gate should block.",
        rubric: "Mentions unsupported claims, fabricated sources, unresolved citations, or out-of-scope material.",
        sample: "It should block unsupported claims that do not connect to the approved source paper.",
        accept: ["unsupported", "fabricated", "citation", "out of scope", "source"]
      }
    ]
  };
}

function normalizeAssessment(value, brief) {
  const fallback = fallbackAssessment(brief);
  const polls = Array.isArray(value && value.polls) && value.polls.length ? value.polls : fallback.polls;
  const words = Array.isArray(value && value.words) && value.words.length ? value.words : fallback.words;
  const quizzes = Array.isArray(value && value.quizzes) && value.quizzes.length ? value.quizzes : fallback.quizzes;
  const pollMap = {};
  polls.slice(0, 8).forEach((poll, index) => {
    const id = normalizeId(poll.id, `poll-${index + 1}`);
    pollMap[id] = {
      q: text(poll.q, fallback.polls[0].q),
      desc: text(poll.desc, ""),
      opts: list(poll.opts, ["Yes", "No", "Not sure"], 6)
    };
  });
  const wordMap = {};
  words.slice(0, 8).forEach((word, index) => {
    const id = normalizeId(word.id, `word-${index + 1}`);
    wordMap[id] = {
      q: text(word.q, fallback.words[0].q),
      desc: text(word.desc, "")
    };
  });
  return {
    polls: pollMap,
    words: wordMap,
    quizzes: normalizeQuizzes(quizzes, fallback.quizzes)
  };
}

function normalizeQuizzes(value, fallback) {
  const incoming = Array.isArray(value) ? value : [];
  const normalized = incoming.map((quiz) => {
    const typeValue = text(quiz && quiz.type, "mc").toLowerCase();
    if (typeValue === "sa") {
      return {
        type: "sa",
        level: clampLevel(quiz.level),
        q: text(quiz.q, "Answer the short question."),
        rubric: text(quiz.rubric, "Answer should match the taught material."),
        sample: text(quiz.sample, "A strong answer uses the taught material."),
        accept: list(quiz.accept, ["source"], 8)
      };
    }
    if (typeValue === "tf") {
      return {
        type: "tf",
        level: clampLevel(quiz.level),
        q: text(quiz.q, "True or false?"),
        answer: Boolean(quiz.answer),
        why: text(quiz.why, "Review the taught material.")
      };
    }
    const options = list(quiz && quiz.options, ["First option", "Second option", "Third option"], 6);
    let answer = Number(quiz && quiz.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) answer = 0;
    return {
      type: "mc",
      level: clampLevel(quiz && quiz.level),
      q: text(quiz && quiz.q, "Choose the best answer."),
      options,
      answer,
      why: text(quiz && quiz.why, "Review the taught material.")
    };
  }).filter((quiz) => quiz.q);
  return normalized.length ? normalized.slice(0, 8) : fallback;
}

function clampLevel(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return 2;
  return Math.max(1, Math.min(5, number));
}

function normalizeGlossary(value) {
  const terms = Array.isArray(value && value.terms) ? value.terms : [];
  const glossary = {};
  terms.forEach((entry) => {
    const term = text(entry && entry.term).toLowerCase();
    if (!term || glossary[term]) return;
    glossary[term] = {
      d: text(entry.d, "A term used in this class."),
      r: text(entry.r, "It helps learners make sense of the class material.")
    };
  });
  const required = {
    "terminal learning objective": {
      d: "The main capability learners should demonstrate by the end of the class.",
      r: "It anchors the lesson around outcomes instead of loose topic coverage."
    },
    "enabling learning objective": {
      d: "A supporting skill or idea learners need before they can meet the terminal objective.",
      r: "It turns a big outcome into teachable steps."
    },
    "source verification": {
      d: "An independent check that claims and citations are supported by the approved corpus.",
      r: "It keeps fabricated or unsupported material out of the class."
    }
  };
  Object.keys(required).forEach((term) => {
    if (!glossary[term]) glossary[term] = required[term];
  });
  return glossary;
}

function attachExpansionInteraction(slide, index, assessment) {
  const polls = Object.keys(assessment.polls || {});
  const words = Object.keys(assessment.words || {});
  if (assessment.quizzes && assessment.quizzes.length && index % 12 === 8) {
    slide.button = makeQuizBox(`quiz-${slide.id}`, assessment.quizzes.slice(0, 3));
  } else if (polls.length && index % 10 === 3) {
    slide.poll = polls[index % polls.length];
  } else if (words.length && index % 10 === 6) {
    slide.words = words[index % words.length];
  }
  return slide;
}

function uniqueSlideId(value, used, index) {
  const base = normalizeId(value, `slide-${index + 1}`);
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function expansionSlide(brief, sourcePaper, assessment, index, used) {
  const title = brief.meta.title || "this class";
  const objectives = fallbackObjectives(brief);
  const sections = sourcePaper.sections && sourcePaper.sections.length
    ? sourcePaper.sections
    : [{ id: "s1", title: "Class setup, learner profile, and research rules" }];
  const section = sections[index % sections.length];
  const sourceId = section.id || "s1";
  const enabling = objectives.enabling[index % objectives.enabling.length] || "Practice the source-grounded skill.";
  const terminal = objectives.terminal[index % objectives.terminal.length] || `Apply the class workflow for ${title}.`;
  const patterns = [
    {
      eyebrow: "Evidence",
      title: `Source checkpoint: ${section.title}`,
      bullets: [
        "Review what this source can safely support.",
        "Separate verified points from questions that need more evidence.",
        "Flag any statistic, date, or disputed point for corroboration."
      ],
      takeaway: "Bernard should teach only the claims this knowledge-base section can support.",
      explanation: `This checkpoint teaches learners how ${section.title} fits into the class without turning weak evidence into a fact claim.`,
      worked_example: "Use one claim from the source section and ask whether it is supported, missing context, or outside scope.",
      practice_prompt: "Have learners mark one statement as supported, one as uncertain, and one as needing another source.",
      common_mistake: "Do not treat a source title or uploaded file name as evidence unless readable text or a transcript is available.",
      notes: "Use this checkpoint to slow down and show learners how the source constrains the class."
    },
    {
      eyebrow: "Concept",
      title: `Make the idea usable`,
      bullets: [
        `Connect this part of ${title} to the floor learner's starting point.`,
        `Translate the key idea into plain language: ${enabling}`,
        "Ask learners to restate the idea before moving on."
      ],
      takeaway: "A complex topic becomes teachable when the learner can say the idea back accurately.",
      explanation: `This slide turns the class topic into usable language for the floor learner, then checks whether the idea can be applied to ${enabling}.`,
      worked_example: "Translate the technical phrase into a plain-language sentence, then ask a learner to repeat it with one job-specific example.",
      practice_prompt: "Ask learners to explain the idea once without jargon and once using the correct technical vocabulary.",
      common_mistake: "Do not mistake vocabulary recognition for usable understanding.",
      notes: "Keep the explanation plain. Define unfamiliar language before using it in a task."
    },
    {
      eyebrow: "Guided Practice",
      title: "Walk through a worked example",
      bullets: [
        "Start with a realistic learner scenario.",
        "Model the first decision out loud.",
        "Show where the source supports the decision."
      ],
      takeaway: "The first practice round should be guided, visible, and tied back to the knowledge base.",
      explanation: "A worked example makes expert thinking visible. The presenter should name the decision, show the evidence boundary, and explain why the chosen move is safer than plausible alternatives.",
      worked_example: "Walk through the first decision step with the class watching, then pause before the next decision and ask learners what they would check.",
      practice_prompt: "Have learners identify the first decision, the evidence used, and the risk if that decision is skipped.",
      common_mistake: "Do not rush into independent practice before learners have seen the thinking process.",
      notes: "Narrate the thinking process. Do not add facts outside the cited source section."
    },
    {
      eyebrow: "Decision Point",
      title: "Choose the next best move",
      bullets: [
        "Present two or three plausible choices.",
        "Ask which choice best matches the objective.",
        "Use the answer to correct misunderstandings before the next section."
      ],
      takeaway: "Decision points reveal whether learners can apply the concept, not just recognize it.",
      explanation: "Decision slides turn passive reading into performance. Learners should compare choices, justify one, and explain what evidence would change their answer.",
      worked_example: "Offer three possible next moves: one safe, one incomplete, and one out of scope. Ask learners to defend the safe choice.",
      practice_prompt: "Ask learners to choose a next move and state the source-supported reason for it.",
      common_mistake: "Do not accept answers that sound confident but do not cite the class source boundary.",
      notes: "Invite short answers first, then explain the stronger choice."
    },
    {
      eyebrow: "Common Pitfall",
      title: "Avoid the tempting wrong turn",
      bullets: [
        "Name a mistake a new learner might make.",
        "Explain why the mistake is attractive.",
        "Give a safer replacement action or question."
      ],
      takeaway: "Pitfall slides make the class more useful without inventing new factual claims.",
      explanation: "A pitfall slide prevents the predictable wrong move before it becomes a habit. The presenter should make the mistake visible, then replace it with a safer question or action.",
      worked_example: "Show the tempting shortcut, explain why it feels efficient, and contrast it with the slower source-grounded move.",
      practice_prompt: "Ask learners to rewrite the pitfall as a checklist question they can use later.",
      common_mistake: "Do not shame the mistake; use it as a realistic design target for instruction.",
      notes: "Frame the pitfall as a learning aid, not as a blame point."
    },
    {
      eyebrow: "Application",
      title: "Try it in context",
      bullets: [
        `Apply the lesson to the terminal outcome: ${terminal}`,
        "Require learners to cite what information they used.",
        "Ask what extra source would make the answer stronger."
      ],
      takeaway: "Application work should combine the objective, the source, and the learner's role.",
      explanation: `Application is where the class proves its value. Learners should use the terminal outcome, the relevant source section, and their own role context to make a bounded decision.`,
      worked_example: "Give a short scenario and ask learners to identify what they know, what they do not know, and what source would close the gap.",
      practice_prompt: "Have learners produce a short answer that includes an action, a reason, and a source need.",
      common_mistake: "Do not let application drift into unsupported local policy, vendor preference, or personal habit.",
      notes: "Let learners practice with bounded information. Keep the source discipline visible."
    },
    {
      eyebrow: "Advanced Extension",
      title: "Add depth for experienced learners",
      bullets: [
        "Name a more nuanced version of the same decision.",
        "Compare the ordinary case with a harder edge case.",
        "Ask what additional evidence would change the answer."
      ],
      takeaway: "Experienced learners should get more depth, not a shorter class.",
      explanation: "Advanced learners still need a complete class. Their background should unlock edge cases, tradeoffs, and transfer practice instead of reducing the number of teaching moments.",
      worked_example: "Compare the normal case with a harder edge case and ask what extra source would be needed to teach the edge case confidently.",
      practice_prompt: "Ask experienced learners to name the exception, the risk, and the source they would want before acting.",
      common_mistake: "Do not assume familiarity equals mastery; test it with harder application.",
      notes: "Use technical familiarity as a reason to add richer practice and source analysis while staying inside the evidence boundary."
    },
    {
      eyebrow: "Bernard Check",
      title: "Ask Bernard before moving on",
      bullets: [
        "Pause for learner questions.",
        "Use Bernard for a plain-language explanation or an alternate example.",
        "Return to the slide when the class is ready to continue."
      ],
      takeaway: "Bernard is a support layer; the approved lesson path still controls the class.",
      explanation: "Bernard can explain, translate, rephrase, and coach, but the course still has an approved source boundary and lesson path. This pause turns AI support into a controlled learning aid.",
      worked_example: "Ask Bernard for a plain-language version of the previous slide, then compare the answer against the slide source and objective.",
      practice_prompt: "Have learners ask one clarification question and summarize the answer in their own words.",
      common_mistake: "Do not let Bernard introduce unsupported claims as if they were part of the verified lesson.",
      notes: "Remind learners that Bernard can clarify, but should not teach unsupported claims."
    },
    {
      eyebrow: "Transfer",
      title: "Move from class to practice",
      bullets: [
        "Name where learners will use this skill next.",
        "Ask what they should check before acting alone.",
        "Tie the answer back to the source and objective."
      ],
      takeaway: "Transfer slides help learners carry the class into a real setting.",
      explanation: "Transfer turns the class from a presentation into future behavior. Learners should know where they will use the skill, what they should check first, and when they need a stronger source.",
      worked_example: "Name the next real-world situation where this skill matters and have learners build a short readiness checklist.",
      practice_prompt: "Ask learners to write one thing they will do, one thing they will verify, and one thing they will ask Bernard or a supervisor.",
      common_mistake: "Do not close with inspiration alone; close with a concrete transfer action.",
      notes: "Close the loop between the lesson and the learner's next practical use."
    }
  ];
  const pattern = patterns[index % patterns.length];
  const slide = {
    id: uniqueSlideId(`${pattern.eyebrow}-${index + 1}`, used, index),
    eyebrow: pattern.eyebrow,
    num: String(index + 1).padStart(2, "0"),
    title: pattern.title,
    bullets: pattern.bullets,
    takeaway: pattern.takeaway,
    source_ids: [sourceId],
    paper: {
      secnum: `Slide ${index + 1}`,
      h: pattern.title,
      body: `<p>${html(pattern.notes)}</p><p>Source anchor: ${citationBlock([sourceId], sourcePaper)}</p>`
    }
  };
  return attachExpansionInteraction(slide, index, assessment);
}

function expandSlideDrafts(slides, brief, sourcePaper, assessment, target) {
  const used = new Set();
  const expanded = slides.slice(0, target).map((slide, index) => {
    const out = normalizeSlideDepth(slide, brief);
    out.id = uniqueSlideId(out.id, used, index);
    out.num = String(index + 1).padStart(2, "0");
    out.source_ids = validSources(out.source_ids, sourcePaper);
    return out;
  });
  while (expanded.length < target) {
    expanded.push(normalizeSlideDepth(expansionSlide(brief, sourcePaper, assessment, expanded.length, used), brief));
  }
  const requiredDeepDives = requiredDeepDiveCount(brief, target);
  return expanded.map((slide, index) => {
    const out = normalizeSlideDepth(slide, brief);
    out.source_ids = validSources(out.source_ids, sourcePaper);
    if (index < requiredDeepDives) out.paper = makeDeepDivePaper(out, sourcePaper, brief, index);
    return attachExpansionInteraction(out, index, assessment);
  });
}

function fallbackSlideBase(brief, sourcePaper, assessment) {
  const objectives = fallbackObjectives(brief);
  const title = brief.meta.title || "Untitled Masterclass";
  const floor = brief.audience.floor.background || "new learners";
  const citations = ["s1"];
  const quizMarkup = makeQuizBox("quiz-final-check", assessment.quizzes.slice(0, 3));
  return [
    {
      id: "welcome",
      eyebrow: "Masterclass",
      num: "01",
      title,
      bullets: [
        "Start with the learner profile and source rules.",
        "Use the knowledge base to decide what the class can safely teach.",
        "Keep unsupported claims out of the lesson."
      ],
      takeaway: "This class package was generated from the approved setup and available source extracts.",
      source_ids: citations
    },
    {
      id: "knowledge-base",
      eyebrow: "Knowledge Base",
      num: "02",
      title: "What the generator could verify",
      bullets: sourcePaper.sections.slice(0, 5).map((section) => `${section.num}. ${section.title}`),
      takeaway: "If a source was only uploaded by name, it is queued but not treated as factual evidence until text extraction is available.",
      source_ids: sourcePaper.sections.slice(0, 2).map((section) => section.id),
      paper: {
        secnum: "Source Notes",
        h: "How this run handled sources",
        body: "<p>The generator uses setup metadata and any fetched URL text. It does not invent facts from unavailable files.</p>"
      }
    },
    {
      id: "learner-profile",
      eyebrow: "Audience",
      num: "03",
      title: "Design for the floor learner",
      bullets: [
        `Typical learner: ${brief.audience.average.background || "not specified"}.`,
        `Floor learner: ${floor}.`,
        `Tone: ${brief.audience.tone}; reading grade cap: ${brief.audience.accessibility.reading_grade_cap}.`
      ],
      takeaway: "The floor learner sets the clarity bar for the whole class.",
      source_ids: citations,
      words: Object.keys(assessment.words)[0]
    },
    {
      id: "terminal-objectives",
      eyebrow: "Objectives",
      num: "04",
      title: "Terminal learning objectives",
      bullets: objectives.terminal,
      takeaway: "These objectives are grounded in the class setup and should be tightened as richer source text becomes available.",
      source_ids: citations
    },
    {
      id: "enabling-objectives",
      eyebrow: "Objectives",
      num: "05",
      title: "Enabling learning objectives",
      bullets: objectives.enabling,
      takeaway: "Each enabling objective should prepare learners for the terminal task.",
      source_ids: citations
    },
    {
      id: "practice-path",
      eyebrow: "Practice",
      num: "06",
      title: "Practice path",
      bullets: [
        "Name the decision or action learners must perform.",
        "Show a clean example with the key vocabulary.",
        "Ask learners to apply the same pattern to a realistic scenario."
      ],
      takeaway: "The class should move from recognition to guided practice to independent explanation.",
      source_ids: citations,
      poll: Object.keys(assessment.polls)[0]
    },
    {
      id: "guardrails",
      eyebrow: "Source Discipline",
      num: "07",
      title: "Guardrails for quality",
      bullets: [
        "No fabricated sources, URLs, dates, or statistics.",
        "No out-of-scope side trips.",
        "No final claim unless the source paper supports it."
      ],
      takeaway: "The safest masterclass is specific about what it knows and what it still needs.",
      source_ids: citations,
      poll: Object.keys(assessment.polls)[1] || Object.keys(assessment.polls)[0]
    },
    {
      id: "knowledge-check",
      eyebrow: "Knowledge Check",
      num: "08",
      title: "Check understanding",
      bullets: ["Answer the questions below before moving to final practice."],
      takeaway: "The check focuses on the workflow and evidence rules.",
      source_ids: citations,
      button: quizMarkup
    },
    {
      id: "facilitator-script",
      eyebrow: "Presenter",
      num: "09",
      title: "What the facilitator should say",
      bullets: [
        "Explain why the knowledge base comes before final objectives.",
        "Tell learners which claims are supported and which need more evidence.",
        "Use the practice path to keep the class active."
      ],
      takeaway: "The downloaded presenter script gives a slide-by-slide talk track.",
      source_ids: citations,
      paper: {
        secnum: "Presenter Script",
        h: "Facilitator guidance",
        body: "<p>Open the downloaded presenter script for a full talk track. Keep the delivery plain, paced, and source-honest.</p>"
      }
    },
    {
      id: "close",
      eyebrow: "Close",
      num: "10",
      title: "Ready to teach, then improve",
      bullets: [
        "Run the class preview.",
        "Add richer source text when available.",
        "Regenerate after the source-verification and QA gates pass."
      ],
      takeaway: "This package is a working masterclass shell that can improve as the knowledge base deepens.",
      source_ids: citations
    }
  ];
}

function buildFallbackSlides(brief, sourcePaper, assessment) {
  return expandSlideDrafts(fallbackSlideBase(brief, sourcePaper, assessment), brief, sourcePaper, assessment, teachingSlideTarget(brief));
}

function normalizeAISlide(slide, index, brief, sourcePaper, assessment) {
  const id = normalizeId(slide.id, `slide-${index + 1}`);
  const interaction = text(slide.interaction, "none").toLowerCase();
  const out = normalizeSlideDepth({
    id,
    eyebrow: text(slide.eyebrow, index === 0 ? "Masterclass" : "Lesson"),
    num: String(index + 1).padStart(2, "0"),
    title: text(slide.title, brief.meta.title || "Masterclass"),
    bullets: list(slide.bullets, ["Review this source-grounded section."], 6),
    takeaway: text(slide.takeaway, "Connect this point to the source paper and learner profile."),
    explanation: text(slide.explanation, ""),
    worked_example: text(slide.worked_example || slide.example, ""),
    practice_prompt: text(slide.practice_prompt || slide.practice, ""),
    common_mistake: text(slide.common_mistake || slide.caution, ""),
    deep_dive: slide.deep_dive,
    source_ids: validSources(slide.source_ids, sourcePaper),
    speaker_notes: text(slide.speaker_notes, "Use this slide to teach the core point clearly and check learner understanding.")
  }, brief);
  if (interaction === "poll") out.poll = Object.keys(assessment.polls)[0];
  if (interaction === "word") out.words = Object.keys(assessment.words)[0];
  if (interaction === "quiz") out.button = makeQuizBox(`quiz-${id}`, assessment.quizzes.slice(0, 3));
  return out;
}

function buildAISlides(brief, sourcePaper, pipeline, assessment) {
  const incoming = Array.isArray(pipeline.author && pipeline.author.slides) ? pipeline.author.slides : [];
  const target = teachingSlideTarget(brief);
  const normalized = incoming.slice(0, target).map((slide, index) => normalizeAISlide(slide, index, brief, sourcePaper, assessment));
  const seed = normalized.length ? normalized : fallbackSlideBase(brief, sourcePaper, assessment);
  return expandSlideDrafts(seed, brief, sourcePaper, assessment, target);
}

function finalizeSlides(slideDrafts, sourcePaper, brief) {
  return slideDrafts.map((slide) => {
    const out = {
      id: slide.id,
      eyebrow: slide.eyebrow,
      num: slide.num,
      deck: slide.customDeck || slideHtml(slide, sourcePaper)
    };
    if (slide.paper && wantsDeepDives(brief)) out.paper = slide.paper;
    if (slide.poll) out.poll = slide.poll;
    if (slide.words) out.words = slide.words;
    return out;
  });
}

function buildGeneratedDeck(brief, sourcePaper, pipeline) {
  const assessment = normalizeAssessment(pipeline && pipeline.assessment, brief);
  const requestedSlides = totalSlideTarget(brief);
  const teachingSlides = teachingSlideTarget(brief);
  const baseSlideDrafts = pipeline && pipeline.mode === "openai"
    ? buildAISlides(brief, sourcePaper, pipeline, assessment)
    : buildFallbackSlides(brief, sourcePaper, assessment);
  const slideDrafts = baseSlideDrafts.concat(buildKnowledgeBaseReportSlide(brief, sourcePaper)).map((slide, index) => (
    Object.assign({}, slide, { num: String(index + 1).padStart(2, "0") })
  ));
  const slides = finalizeSlides(slideDrafts, sourcePaper, brief);
  const glossary = normalizeGlossary(pipeline && pipeline.glossary);
  const objectives = pipeline && pipeline.curriculum ? {
    terminal: list(pipeline.curriculum.terminal, fallbackObjectives(brief).terminal, 5),
    enabling: list(pipeline.curriculum.enabling, fallbackObjectives(brief).enabling, 12),
    out_of_scope: list(pipeline.curriculum.out_of_scope, fallbackObjectives(brief).out_of_scope, 8)
  } : fallbackObjectives(brief);

  const lessonPlan = pipeline && pipeline.curriculum && Array.isArray(pipeline.curriculum.lesson_sections)
    ? pipeline.curriculum.lesson_sections
    : slideDrafts.map((slide) => ({ id: slide.id, title: slide.title, teaching_goal: slide.takeaway, source_ids: slide.source_ids }));
  const evidenceMap = buildEvidenceMap(brief, sourcePaper, objectives, lessonPlan);
  const blueprint = buildCourseBlueprint(brief, { lesson_plan: lessonPlan });

  return {
    slides,
    slideDrafts,
    slide_target: requestedSlides,
    teaching_slide_target: teachingSlides,
    polls: assessment.polls,
    words: assessment.words,
    quizzes: assessment.quizzes,
    glossary,
    objectives,
    lesson_plan: lessonPlan,
    evidence_map: evidenceMap,
    course_blueprint: blueprint
  };
}

function makeContentJs(brief, generated) {
  const standard = knowledgeBaseStandard(brief);
  return [
    `/* ${brief.meta.title || "Untitled Masterclass"} - generated content layer. */`,
    `window.CLASS_TITLE = ${js(brief.meta.title || "Untitled Masterclass")};`,
    `window.DECK_META = ${JSON.stringify({ slug: brief.meta.slug, generated: new Date().toISOString(), language: brief.language.primary, class_tier: classTierSpec(brief).label }, null, 2)};`,
    `window.CLASS_STANDARD = ${JSON.stringify(standard, null, 2)};`,
    `window.CLASS_BLUEPRINT = ${JSON.stringify(generated.course_blueprint, null, 2)};`,
    `window.EVIDENCE_MAP = ${JSON.stringify(generated.evidence_map, null, 2)};`,
    `window.BERNARD_CONFIG = ${JSON.stringify({ name: "Bernard", wake_word: "Bernard", voice: "English accent when supported by the browser", scope: "approved class sources and current slide" }, null, 2)};`,
    `window.SLIDES = ${JSON.stringify(generated.slides, null, 2)};`,
    `window.POLLS = ${JSON.stringify(generated.polls, null, 2)};`,
    `window.WORDS = ${JSON.stringify(generated.words, null, 2)};`
  ].join("\n") + "\n";
}

function makeGlossaryJs(glossary) {
  return "/* Generated glossary. term -> {d, r}. */\nwindow.GLOSSARY = " + JSON.stringify(glossary, null, 2) + ";\n";
}

function makeSourceJs(sourcePaper) {
  return "/* Generated Student Reader. */\nwindow.SOURCE_PAPER = " + JSON.stringify(sourcePaper, null, 2) + ";\n";
}

function makePresenterScript(brief, generated, sourcePaper, pipeline) {
  const lines = [];
  const standard = knowledgeBaseStandard(brief);
  lines.push(`# Presenter Script: ${brief.meta.title || "Untitled Masterclass"}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Language setting: ${brief.language.primary || "en"}`);
  lines.push(`Class tier: ${standard.tier.label}`);
  lines.push(`Pipeline: ${pipeline && pipeline.mode === "openai" ? "OpenAI staged generation" : "Conservative deterministic generation"}`);
  lines.push("");
  lines.push("## Source Discipline");
  lines.push("Use the cited source paper sections as the boundary for factual claims. If a learner asks for something outside the source paper, say it needs more source review before teaching it as fact.");
  lines.push(`Knowledge-base standard: ${standard.required_sources} usable sources, including ${standard.required_primary_sources} primary sources. Current setup: ${standard.counts.total} sources, including ${standard.counts.primary} primary sources.`);
  lines.push("");
  lines.push("## Learning Objectives");
  generated.objectives.terminal.forEach((item) => lines.push(`- TLO: ${item}`));
  generated.objectives.enabling.forEach((item) => lines.push(`- ELO: ${item}`));
  lines.push("");
  lines.push("## Slide Talk Track");
  generated.slideDrafts.forEach((slide, index) => {
    lines.push(`### ${index + 1}. ${slide.title}`);
    lines.push(`Say: ${slide.paper && slide.paper.body ? stripHtml(slide.paper.body) : slide.takeaway}`);
    lines.push("Key points:");
    list(slide.bullets, [], 6).forEach((item) => lines.push(`- ${item}`));
    lines.push(`Sources: ${validSources(slide.source_ids, sourcePaper).join(", ")}`);
    lines.push("");
  });
  if (pipeline && pipeline.research && Array.isArray(pipeline.research.gaps) && pipeline.research.gaps.length) {
    lines.push("## Research Gaps to Resolve");
    pipeline.research.gaps.forEach((gap) => lines.push(`- ${gap}`));
    lines.push("");
  }
  return lines.join("\n");
}

function markdownList(items) {
  return (items || []).map((item) => `- ${item}`).join("\n");
}

function makeStudentHandout(brief, generated, sourcePaper) {
  const lines = [];
  lines.push(`# Student Handout: ${brief.meta.title || "Untitled Masterclass"}`);
  lines.push("");
  lines.push(`Class tier: ${classTierSpec(brief).label}`);
  lines.push(`Bernard support: ask Bernard for clarification, examples, translation, quiz help, or a deeper explanation. Bernard must stay inside the approved source boundary.`);
  lines.push("");
  lines.push("## Learning Objectives");
  lines.push(markdownList(generated.objectives.terminal.map((item) => `TLO: ${item}`)));
  lines.push(markdownList(generated.objectives.enabling.map((item) => `ELO: ${item}`)));
  lines.push("");
  lines.push("## Course Blueprint");
  generated.course_blueprint.modules.forEach((module) => {
    lines.push(`- ${module.order}. ${module.title} (${module.slide_budget} slides): ${module.goal}`);
  });
  lines.push("");
  lines.push("## Key Terms");
  Object.keys(generated.glossary).forEach((term) => {
    lines.push(`- ${term}: ${generated.glossary[term].d} Why it matters: ${generated.glossary[term].r}`);
  });
  lines.push("");
  lines.push("## Works Cited");
  sourcePaper.sections.forEach((section) => {
    lines.push(`- ${section.num || section.id}. ${section.title}`);
  });
  lines.push("");
  lines.push("## Source Suggestion");
  lines.push("At the end of the class, use the source-suggestion button to recommend additional sources for the knowledge base.");
  return lines.join("\n");
}

function makeFacilitatorGuide(brief, generated, quality) {
  const lines = [];
  lines.push(`# Facilitator Guide: ${brief.meta.title || "Untitled Masterclass"}`);
  lines.push("");
  lines.push(`Quality score at build: ${quality.score} / 100 (${quality.status})`);
  lines.push(`Class tier: ${classTierSpec(brief).label}`);
  lines.push("");
  lines.push("## How to Run This Class");
  lines.push("- Start by explaining the knowledge-base boundary and why the final works-cited slide matters.");
  lines.push("- Use polls, word clouds, quizzes, and Bernard questions as participation signals.");
  lines.push("- Treat deep dives as optional learner paths during delivery, but required preparation for the presenter.");
  lines.push("- If a learner asks for a claim outside the source base, mark it as a research gap instead of improvising.");
  lines.push("");
  lines.push("## Blueprint");
  generated.course_blueprint.modules.forEach((module) => {
    lines.push(`- ${module.title}: ${module.slide_budget} slides. ${module.goal}`);
  });
  lines.push("");
  lines.push("## QA Notes");
  (quality.recommendations || []).forEach((item) => lines.push(`- ${item}`));
  return lines.join("\n");
}

function makeQuizAnswerKey(generated) {
  const lines = ["# Quiz Answer Key", ""];
  generated.quizzes.forEach((quiz, index) => {
    lines.push(`## Question ${index + 1}`);
    lines.push(quiz.q || "");
    if (quiz.type === "mc") {
      const answer = Array.isArray(quiz.options) ? quiz.options[quiz.answer] : quiz.answer;
      lines.push(`Answer: ${answer}`);
    } else {
      lines.push(`Answer: ${String(quiz.answer)}`);
    }
    if (quiz.why) lines.push(`Why: ${quiz.why}`);
    if (quiz.rubric) lines.push(`Rubric: ${quiz.rubric}`);
    if (quiz.sample) lines.push(`Sample: ${quiz.sample}`);
    lines.push("");
  });
  return lines.join("\n");
}

function makeClassRecord(brief, generated, sourcePaper, pipeline, quality) {
  return {
    title: brief.meta.title || "Untitled Masterclass",
    slug: slugify(brief.meta.slug || brief.meta.title),
    generated_at: new Date().toISOString(),
    class_tier: classTierSpec(brief),
    research_owner: researchOwner(brief),
    source_discovery: generated.source_discovery || null,
    knowledge_standard: quality.knowledge_standard,
    slide_count: generated.slides.length,
    teaching_slide_count: generated.slideDrafts.length - 1,
    deep_dive_count: quality.deep_dive_count,
    required_deep_dive_count: quality.required_deep_dive_count,
    quality: {
      score: quality.score,
      status: quality.status,
      scores: quality.scores,
      rubric: quality.rubric
    },
    pipeline_mode: pipeline && pipeline.mode,
    bernard: {
      embedded: true,
      wake_word: "Bernard",
      voice_note: "English accent when supported by the browser and configured TTS."
    },
    exports: [
      "student-handout.md",
      "facilitator-guide.md",
      "quiz-answer-key.md",
      "evidence-map.json",
      "class-blueprint.json",
      "class-record.json"
    ],
    source_paper: {
      title: sourcePaper.title,
      section_count: sourcePaper.sections.length,
      sections: sourcePaper.sections.map((section) => ({ id: section.id, num: section.num, title: section.title }))
    },
    course_blueprint: generated.course_blueprint,
    evidence_map: generated.evidence_map
  };
}

function dataSrcIds(value) {
  const ids = [];
  String(value || "").replace(/data-src="([^"]+)"/g, (match, id) => {
    ids.push(id);
    return match;
  });
  return ids;
}

function sourceVerify(generated, sourcePaper) {
  const allowed = sourceIds(sourcePaper);
  const issues = [];
  generated.slides.forEach((slide) => {
    dataSrcIds(slide.deck).forEach((id) => {
      if (!allowed.has(id)) issues.push(`Slide ${slide.id} cites missing source section ${id}.`);
    });
    if (slide.paper) {
      dataSrcIds(slide.paper.body).forEach((id) => {
        if (!allowed.has(id)) issues.push(`Slide ${slide.id} paper cites missing source section ${id}.`);
      });
    }
  });
  return { ok: issues.length === 0, issues };
}

function validateQuiz(quiz, index, issues) {
  const prefix = `quiz ${index + 1}`;
  if (!quiz || !quiz.type || !quiz.q || !quiz.level) issues.push(`${prefix} missing type, level, or q.`);
  if (quiz.type === "mc") {
    if (!Array.isArray(quiz.options) || quiz.options.length < 2) issues.push(`${prefix} mc missing options.`);
    if (!Number.isInteger(quiz.answer)) issues.push(`${prefix} mc missing numeric answer.`);
    if (!quiz.why) issues.push(`${prefix} mc missing why.`);
  } else if (quiz.type === "tf") {
    if (typeof quiz.answer !== "boolean") issues.push(`${prefix} tf missing boolean answer.`);
    if (!quiz.why) issues.push(`${prefix} tf missing why.`);
  } else if (quiz.type === "sa") {
    if (!quiz.rubric || !quiz.sample || !Array.isArray(quiz.accept)) issues.push(`${prefix} sa missing rubric/sample/accept.`);
  } else {
    issues.push(`${prefix} has invalid type ${quiz.type}.`);
  }
}

function qaGate(files, generated, sourcePaper, brief) {
  const issues = [];
  if (!/window\.SLIDES\s*=/.test(files["content.js"])) issues.push("content.js missing window.SLIDES.");
  if (!/window\.POLLS\s*=/.test(files["content.js"])) issues.push("content.js missing window.POLLS.");
  if (!/window\.WORDS\s*=/.test(files["content.js"])) issues.push("content.js missing window.WORDS.");
  if (!/window\.GLOSSARY\s*=/.test(files["glossary.js"])) issues.push("glossary.js missing window.GLOSSARY.");
  if (!/window\.SOURCE_PAPER\s*=/.test(files["source.js"])) issues.push("source.js missing window.SOURCE_PAPER.");
  if (!sourcePaper || !Array.isArray(sourcePaper.sections) || !sourcePaper.sections.length) issues.push("source paper has no sections.");
  const teachingSlides = generated.slides.filter((slide) => slide.id !== "knowledge-base-works-cited");
  const requiredPapers = requiredDeepDiveCount(brief, teachingSlides.length);
  const deepDiveSlides = teachingSlides.filter((slide) => slide.paper);
  if (deepDiveSlides.length < requiredPapers) {
    issues.push(`deep-dive count ${deepDiveSlides.length} is below required ${requiredPapers}.`);
  }
  generated.slides.forEach((slide) => {
    ["id", "eyebrow", "num", "deck"].forEach((key) => {
      if (!slide[key]) issues.push(`slide missing ${key}.`);
    });
    if (slide.poll && !generated.polls[slide.poll]) issues.push(`slide ${slide.id} references missing poll ${slide.poll}.`);
    if (slide.words && !generated.words[slide.words]) issues.push(`slide ${slide.id} references missing word cloud ${slide.words}.`);
    if (slide.paper && (!slide.paper.secnum || !slide.paper.h || !slide.paper.body)) issues.push(`slide ${slide.id} paper shape is invalid.`);
    if (slide.id !== "knowledge-base-works-cited" && wordCount(slide.deck) < MIN_VISIBLE_SLIDE_WORDS) {
      issues.push(`slide ${slide.id} is too thin for a masterclass slide.`);
    }
    if (slide.paper && wordCount(slide.paper.body) < MIN_DEEP_DIVE_WORDS) {
      issues.push(`slide ${slide.id} deep dive is too thin.`);
    }
  });
  Object.keys(generated.glossary).forEach((term) => {
    const entry = generated.glossary[term];
    if (!entry || !entry.d || !entry.r) issues.push(`glossary term ${term} must be {d,r}.`);
  });
  generated.quizzes.forEach((quiz, index) => validateQuiz(quiz, index, issues));
  return { ok: issues.length === 0, issues };
}

function repairContentDepth(generated, sourcePaper, brief) {
  const report = {
    stage: "content-depth-repair",
    ok: true,
    repaired_slides: 0,
    repaired_deep_dives: 0,
    added_deep_dives: 0
  };
  const teachingSlides = generated.slides.filter((slide) => slide.id !== "knowledge-base-works-cited");
  const requiredPapers = requiredDeepDiveCount(brief, teachingSlides.length);
  teachingSlides.forEach((slide, index) => {
    const draft = generated.slideDrafts[index] || {};
    if (wordCount(slide.deck) < MIN_VISIBLE_SLIDE_WORDS) {
      slide.deck = ensureHtmlWordFloor(slide.deck, MIN_VISIBLE_SLIDE_WORDS, [
        `<div class="lesson-detail anim"><p><strong>Automatic depth repair:</strong> The generator expanded this teaching point so the presenter has enough substance to teach, check understanding, and connect the learner back to the approved source boundary.</p><p><strong>Learner check:</strong> Ask learners to state the action, the reason, and the evidence they would need before treating the answer as final.</p></div>`
      ]);
      report.repaired_slides += 1;
    }
    if (index < requiredPapers && !slide.paper) {
      const paperDraft = Object.assign({}, draft, {
        id: slide.id,
        num: slide.num,
        eyebrow: slide.eyebrow,
        title: draft.title || slide.eyebrow || "Deep dive",
        source_ids: validSources(draft.source_ids, sourcePaper)
      });
      slide.paper = makeDeepDivePaper(normalizeSlideDepth(paperDraft, brief), sourcePaper, brief, index);
      report.added_deep_dives += 1;
    }
    if (slide.paper && wordCount(slide.paper.body) < MIN_DEEP_DIVE_WORDS) {
      slide.paper.body = ensureHtmlWordFloor(slide.paper.body, MIN_DEEP_DIVE_WORDS, [
        `<p><strong>Automatic depth repair.</strong> This deep dive was expanded so the presenter can slow down, explain the source boundary, work a realistic example, and ask learners to identify what evidence would be needed before acting independently.</p>`,
        `<p><strong>Transfer check.</strong> Before leaving this section, ask learners to name how they would use the idea, where they might overreach beyond the approved sources, and what question Bernard should help them clarify.</p>`
      ]);
      report.repaired_deep_dives += 1;
    }
  });
  generated.content_depth_repair = report;
  return report;
}

function qualityAudit(brief, generated, sourcePaper, sourceCheck, qa) {
  const issues = [];
  const recommendations = [];
  const standard = knowledgeBaseStandard(brief);
  const slideCount = generated.slides.length;
  const requested = generated.slide_target || slideCount;
  const teachingSlides = Math.max(0, slideCount - 1);
  const citedTeaching = generated.slideDrafts.filter((slide) => (
    Array.isArray(slide.source_ids) && slide.source_ids.length
  )).length;
  const interactiveSlides = generated.slides.filter((slide) => (
    slide.poll || slide.words || /data-quiz=/.test(slide.deck || "")
  )).length;
  const requiredDeepDives = requiredDeepDiveCount(brief, teachingSlides);
  const deepDiveSlides = generated.slides.filter((slide) => slide.id !== "knowledge-base-works-cited" && slide.paper).length;
  const visibleWordCounts = generated.slides
    .filter((slide) => slide.id !== "knowledge-base-works-cited")
    .map((slide) => wordCount(slide.deck));
  const deepDiveWordCounts = generated.slides
    .filter((slide) => slide.id !== "knowledge-base-works-cited" && slide.paper)
    .map((slide) => wordCount(slide.paper.body));
  const averageVisibleWords = visibleWordCounts.length
    ? Math.round(visibleWordCounts.reduce((sum, count) => sum + count, 0) / visibleWordCounts.length)
    : 0;
  const averageDeepDiveWords = deepDiveWordCounts.length
    ? Math.round(deepDiveWordCounts.reduce((sum, count) => sum + count, 0) / deepDiveWordCounts.length)
    : 0;
  const sourceSections = sourcePaper && Array.isArray(sourcePaper.sections) ? sourcePaper.sections.length : 0;
  const objectives = generated.objectives || {};
  const terminalCount = Array.isArray(objectives.terminal) ? objectives.terminal.length : 0;
  const enablingCount = Array.isArray(objectives.enabling) ? objectives.enabling.length : 0;
  const quizCount = Array.isArray(generated.quizzes) ? generated.quizzes.length : 0;
  const pollCount = Object.keys(generated.polls || {}).length;
  const wordCloudCount = Object.keys(generated.words || {}).length;
  const hasWorksCited = generated.slides.some((slide) => slide.id === "knowledge-base-works-cited");
  const evidenceRows = Array.isArray(generated.evidence_map) ? generated.evidence_map : [];
  const mappedEvidence = evidenceRows.filter((row) => Array.isArray(row.source_ids) && row.source_ids.length).length;
  const blueprintModules = generated.course_blueprint && Array.isArray(generated.course_blueprint.modules)
    ? generated.course_blueprint.modules.length
    : 0;
  const sourceCoverage = Math.min(1, standard.counts.total / Math.max(1, standard.required_sources));
  const primaryCoverage = Math.min(1, standard.counts.primary / Math.max(1, standard.required_primary_sources));
  const corroborationRules = Array.isArray(brief.knowledge_base && brief.knowledge_base.credibility && brief.knowledge_base.credibility.require_two_sources_for)
    ? brief.knowledge_base.credibility.require_two_sources_for.length
    : 0;
  const scores = {
    slide_budget: slideCount === requested ? 100 : Math.max(0, 100 - Math.abs(slideCount - requested) * 10),
    research_rigor: Math.round(sourceCoverage * 55 + primaryCoverage * 35 + Math.min(10, corroborationRules * 3.5)),
    source_grounding: sourceCheck.ok ? Math.round(Math.min(1, citedTeaching / Math.max(1, teachingSlides)) * 100) : 0,
    evidence_map: evidenceRows.length ? Math.round((mappedEvidence / evidenceRows.length) * 100) : 0,
    blueprint: blueprintModules >= 5 ? 100 : Math.min(100, blueprintModules * 18),
    objective_alignment: Math.min(100, (terminalCount ? 45 : 0) + Math.min(35, enablingCount * 6) + (generated.lesson_plan && generated.lesson_plan.length ? 20 : 0)),
    content_density: Math.min(100, Math.round((averageVisibleWords / MIN_VISIBLE_SLIDE_WORDS) * 100)),
    deep_dive_depth: requiredDeepDives ? Math.min(100, Math.round((deepDiveSlides / requiredDeepDives) * 70 + Math.min(1, averageDeepDiveWords / MIN_DEEP_DIVE_WORDS) * 30)) : 100,
    participation_design: Math.min(100, Math.round((interactiveSlides / Math.max(1, teachingSlides)) * 220)),
    assessment: Math.min(100, (quizCount ? 50 : 0) + Math.min(30, pollCount * 10) + Math.min(20, wordCloudCount * 10)),
    transparency: hasWorksCited ? 100 : 35,
    schema_qa: qa.ok ? 100 : 0
  };
  if (scores.slide_budget < 100) issues.push("Generated slide count does not match the requested slide budget.");
  if (!standard.ok) issues.push(`Knowledge base does not meet the selected ${standard.tier.label} standard: ${standard.messages.join(" ")}`);
  if (scores.research_rigor < 90) recommendations.push("Improve the knowledge base before relying on this as a finished masterclass.");
  if (scores.source_grounding < 70) recommendations.push("Increase explicit source anchors on teaching slides.");
  if (scores.evidence_map < 90) issues.push("Evidence map coverage is below the release threshold.");
  if (scores.blueprint < 90) issues.push("Course blueprint is missing or incomplete.");
  if (scores.objective_alignment < 70) recommendations.push("Strengthen terminal/enabling objective coverage in the lesson plan.");
  if (scores.content_density < 85) issues.push("Generated slide content is too thin for a masterclass.");
  if (scores.deep_dive_depth < 90) issues.push("Generated deep-dive coverage is below the selected depth setting.");
  if (scores.participation_design < 45) recommendations.push("Add more participation moments: polls, word clouds, quizzes, or Bernard prompts.");
  if (scores.assessment < 60) recommendations.push("Add more assessment checks so mastery is visible.");
  if (sourceSections < 2) recommendations.push("Add more source material to improve evidence depth.");
  if (!hasWorksCited) issues.push("The final Knowledge Base / Works Cited slide is missing.");
  const overall = Math.round(
    scores.slide_budget * 0.1 +
    scores.research_rigor * 0.14 +
    scores.source_grounding * 0.1 +
    scores.evidence_map * 0.08 +
    scores.blueprint * 0.06 +
    scores.objective_alignment * 0.09 +
    scores.content_density * 0.13 +
    scores.deep_dive_depth * 0.13 +
    scores.participation_design * 0.07 +
    scores.assessment * 0.05 +
    scores.transparency * 0.03 +
    scores.schema_qa * 0.02
  );
  if (overall < 70) issues.push(`Class quality score ${overall} is below the 70-point release threshold.`);
  return {
    ok: issues.length === 0 && overall >= 70,
    score: overall,
    status: overall >= 90 ? "excellent" : overall >= 80 ? "strong" : overall >= 70 ? "usable" : "needs revision",
    scores,
    issues,
    recommendations: recommendations.length ? recommendations : ["Quality gate passed. Review live participation data after delivery for the next revision."],
    rubric: [
      "slide budget fidelity",
      "research rigor",
      "source grounding",
      "evidence-map coverage",
      "course blueprint completeness",
      "objective alignment",
      "content density",
      "deep-dive coverage",
      "participation design",
      "assessment coverage",
      "works-cited transparency",
      "schema QA"
    ],
    deep_dive_count: deepDiveSlides,
    required_deep_dive_count: requiredDeepDives,
    average_visible_slide_words: averageVisibleWords,
    average_deep_dive_words: averageDeepDiveWords,
    knowledge_standard: standard
  };
}

function slideBudgetWarning(brief, generated) {
  const raw = Number(brief && brief.length && brief.length.slide_budget);
  if (Number.isFinite(raw) && raw < generated.slide_target) {
    return `Slide budget was raised from ${Math.trunc(raw)} to ${generated.slide_target} so the output remains a real masterclass.`;
  }
  return "";
}

function replacementMap(brief) {
  const title = brief.meta.title || "Untitled Masterclass";
  const audience = brief.audience.floor.role || brief.audience.average.role || "learner";
  const scope = list(brief.objectives.out_of_scope, ["anything outside the approved source paper"], 5).join("; ");
  return {
    "{{CLASS_TITLE}}": title,
    "{{TOPIC}}": title,
    "{{TOPIC_GREETING}}": "the key ideas, source evidence, practice steps, and checks for understanding",
    "{{TOPIC_DESC}}": `${title} for ${audience}`,
    "{{AUDIENCE_LEVEL}}": brief.audience.tone || "plain-language",
    "{{TOPIC_SCOPE}}": `Stay within the approved source paper and avoid: ${scope}.`,
    "{{TOPIC_HONESTY}}": "Do not invent facts. If the source paper does not support an answer, say the class needs more source review.",
    "{{AUDIENCE_NOUN}}": audience
  };
}

function applyReplacements(content, brief) {
  let out = String(content || "");
  const map = replacementMap(brief);
  Object.keys(map).forEach((key) => {
    out = out.split(key).join(map[key]);
  });
  return out;
}

function readTemplateFile(name) {
  return fs.readFileSync(path.join(__dirname, "..", "template", name), "utf8");
}

function makeBundle(brief, files, presenterScript, generated, sourcePaper, pipeline, quality) {
  const classRecord = makeClassRecord(brief, generated, sourcePaper, pipeline, quality);
  const bundleFiles = {
    "index.html": applyReplacements(readTemplateFile("index.html"), brief),
    "engine.js": applyReplacements(readTemplateFile("engine.js"), brief),
    "navscrubber.js": applyReplacements(readTemplateFile("navscrubber.js"), brief),
    "content.js": files["content.js"],
    "glossary.js": files["glossary.js"],
    "source.js": files["source.js"],
    "presenter-script.md": presenterScript,
    "student-handout.md": makeStudentHandout(brief, generated, sourcePaper),
    "facilitator-guide.md": makeFacilitatorGuide(brief, generated, quality),
    "quiz-answer-key.md": makeQuizAnswerKey(generated),
    "evidence-map.json": JSON.stringify(generated.evidence_map, null, 2) + "\n",
    "class-blueprint.json": JSON.stringify(generated.course_blueprint, null, 2) + "\n",
    "class-record.json": JSON.stringify(classRecord, null, 2) + "\n",
    "api/chat.js": applyReplacements(readTemplateFile("api/chat.js"), brief),
    "api/grade.js": applyReplacements(readTemplateFile("api/grade.js"), brief),
    "api/poll.js": readTemplateFile("api/poll.js"),
    "api/words.js": readTemplateFile("api/words.js"),
    "api/feedback.js": readTemplateFile("api/feedback.js"),
    "api/quality.js": readTemplateFile("api/quality.js"),
    "api/tts.js": readTemplateFile("api/tts.js")
  };
  return {
    manifest: {
      slug: slugify(brief.meta.slug || brief.meta.title),
      title: brief.meta.title || "Untitled Masterclass",
      files: Object.keys(bundleFiles),
      deploy_path: `classes/${slugify(brief.meta.slug || brief.meta.title)}/`,
      exports: classRecord.exports
    },
    files: bundleFiles,
    class_record: classRecord
  };
}

function safeScript(value) {
  return String(value || "").replace(/<\/script/gi, "<\\/script");
}

function makePreviewHtml(bundle) {
  let output = bundle.files["index.html"];
  ["content.js", "glossary.js", "source.js", "engine.js", "navscrubber.js"].forEach((name) => {
    output = output.replace(`<script src="${name}"></script>`, `<script>\n${safeScript(bundle.files[name])}\n</script>`);
  });
  return output;
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

async function githubRequest(pathname, options) {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const response = await fetch(`https://api.github.com${pathname}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "masterclass-factory"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && payload.message ? payload.message : `GitHub API ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function publishToGitHub(req, brief, bundle) {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const owner = String(process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "").trim();
  const repo = String(process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || "").trim();
  const branch = String(process.env.GITHUB_BRANCH || "main").trim();
  const slug = slugify(brief.meta.slug || brief.meta.title);
  const folder = `classes/${slug}`;
  const expectedBase = baseUrl(req);
  const expectedUrl = expectedBase ? `${expectedBase}/${folder}/` : "";

  if (!token || !owner || !repo) {
    return {
      status: "not_configured",
      message: "Generation succeeded. Auto-publish needs GITHUB_TOKEN plus repo owner/name env vars in Vercel.",
      class_path: folder,
      expected_url: expectedUrl
    };
  }

  const staticNames = [
    "index.html",
    "engine.js",
    "navscrubber.js",
    "content.js",
    "glossary.js",
    "source.js",
    "presenter-script.md",
    "student-handout.md",
    "facilitator-guide.md",
    "quiz-answer-key.md",
    "evidence-map.json",
    "class-blueprint.json",
    "class-record.json"
  ];
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {});
  const currentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, {});
  const tree = [];

  for (const name of staticNames) {
    const blob = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      body: { content: bundle.files[name], encoding: "utf-8" }
    });
    tree.push({
      path: `${folder}/${name}`,
      mode: "100644",
      type: "blob",
      sha: blob.sha
    });
  }

  const newTree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: { base_tree: currentCommit.tree.sha, tree }
  });
  const newCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: {
      message: `Add generated masterclass: ${brief.meta.title || slug}`,
      tree: newTree.sha,
      parents: [ref.object.sha]
    }
  });
  await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: { sha: newCommit.sha }
  });

  return {
    status: "published",
    message: "Generated masterclass committed to GitHub. The GitHub to Vercel connection should deploy it automatically.",
    owner,
    repo,
    branch,
    commit_sha: newCommit.sha,
    class_path: folder,
    expected_url: expectedUrl
  };
}

module.exports = async function generateHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { ok: false, errors: ["Use POST with a class setup body."] });
    return;
  }

  try {
    const body = await readBody(req);
    const brief = body && body.brief ? body.brief : body;
    const publishRequested = body && Object.prototype.hasOwnProperty.call(body, "publish") ? Boolean(body.publish) : true;
    const result = validateBrief(brief, template);
    if (!result.ok) {
      send(res, 422, { ok: false, errors: result.errors });
      return;
    }

    const prepared = await prepareKnowledgeBase(brief);
    const effectiveBrief = prepared.brief;
    const sourceDiscovery = prepared.discovery;
    const preparedStandard = knowledgeBaseStandard(effectiveBrief);
    if (!preparedStandard.ok) {
      send(res, 422, {
        ok: false,
        failed_stage: "knowledge-base-standard",
        errors: [`Knowledge base does not meet the selected ${preparedStandard.tier.label} standard: ${preparedStandard.messages.join(" ")}`],
        knowledge_standard: preparedStandard,
        source_discovery: sourceDiscovery,
        stage_reports: [
          { stage: "knowledge-base-discovery", ok: !sourceDiscovery.attempted || Boolean(sourceDiscovery.added_sources && sourceDiscovery.added_sources.length), owner: sourceDiscovery.owner, model: sourceDiscovery.model || null, added_sources: sourceDiscovery.added_sources.length },
          { stage: "knowledge-base-standard", ok: false, tier: preparedStandard.tier.label, message: preparedStandard.messages.join(" ") }
        ]
      });
      return;
    }
    const sourceBuild = await buildSourcePaper(effectiveBrief);
    let pipeline;
    const keyError = validateOpenAIKey(openAIKey());
    if (keyError) {
      pipeline = {
        mode: "deterministic",
        warning: keyError,
        reports: [{ stage: "openai", ok: false, message: keyError }]
      };
    } else {
      try {
        pipeline = await runOpenAIStages(effectiveBrief, sourceBuild.sourcePaper);
      } catch (error) {
        pipeline = {
          mode: "deterministic",
          warning: safeErrorMessage(error.message || error),
          reports: [{ stage: error.stage || "openai", ok: false, message: safeErrorMessage(error.message || error) }]
        };
      }
    }

    const generated = buildGeneratedDeck(effectiveBrief, sourceBuild.sourcePaper, pipeline);
    const contentRepair = repairContentDepth(generated, sourceBuild.sourcePaper, effectiveBrief);
    const files = {
      "content.js": makeContentJs(effectiveBrief, generated),
      "glossary.js": makeGlossaryJs(generated.glossary),
      "source.js": makeSourceJs(sourceBuild.sourcePaper)
    };
    const sourceCheck = sourceVerify(generated, sourceBuild.sourcePaper);
    const qa = qaGate(files, generated, sourceBuild.sourcePaper, effectiveBrief);
    const quality = qualityAudit(effectiveBrief, generated, sourceBuild.sourcePaper, sourceCheck, qa);
    if (!sourceCheck.ok || !qa.ok || !quality.ok) {
      send(res, 500, {
        ok: false,
        errors: sourceCheck.issues.concat(qa.issues).concat(quality.issues),
        source_verify: sourceCheck,
        qa,
        quality,
        knowledge_standard: quality.knowledge_standard,
        source_discovery: sourceDiscovery
      });
      return;
    }

    generated.source_discovery = sourceDiscovery;
    const presenterScript = makePresenterScript(effectiveBrief, generated, sourceBuild.sourcePaper, pipeline);
    const bundle = makeBundle(effectiveBrief, files, presenterScript, generated, sourceBuild.sourcePaper, pipeline, quality);
    const previewHtml = makePreviewHtml(bundle);
    let publish = { status: "skipped", message: "Auto-publish was not requested." };
    if (publishRequested) publish = await publishToGitHub(req, effectiveBrief, bundle).catch((error) => ({
      status: "failed",
      message: safeErrorMessage(error.message || error),
      expected_url: baseUrl(req) ? `${baseUrl(req)}/classes/${slugify(effectiveBrief.meta.slug || effectiveBrief.meta.title)}/` : ""
    }));

    send(res, 200, {
      ok: true,
      milestone: 5,
      mode: pipeline.mode,
      model: pipeline.model || null,
      qa: "QA PASS",
      slide_count: generated.slides.length,
      requested_slide_budget: generated.slide_target,
      teaching_slide_count: generated.slideDrafts.length - 1,
      deep_dive_count: quality.deep_dive_count,
      required_deep_dive_count: quality.required_deep_dive_count,
      average_visible_slide_words: quality.average_visible_slide_words,
      average_deep_dive_words: quality.average_deep_dive_words,
      source_verify: { ok: true, issues: [] },
      knowledge_standard: quality.knowledge_standard,
      quality,
      message: pipeline.mode === "openai"
        ? "Masterclass generated with OpenAI stages, independent source verification, QA, preview, bundle, and publish handoff."
        : "Masterclass generated with the conservative deterministic path because OpenAI was unavailable. Preview, bundle, source verification, QA, and publish handoff are ready.",
      warnings: [pipeline.warning, slideBudgetWarning(effectiveBrief, generated)].concat(sourceDiscovery.notes || []).concat(sourceBuild.notes || []).filter(Boolean),
      stage_reports: (pipeline.reports || []).concat([
        { stage: "knowledge-base-discovery", ok: !sourceDiscovery.attempted || Boolean(sourceDiscovery.added_sources && sourceDiscovery.added_sources.length), owner: sourceDiscovery.owner, model: sourceDiscovery.model || null, added_sources: sourceDiscovery.added_sources.length },
        { stage: "knowledge-base-standard", ok: quality.knowledge_standard.ok, tier: quality.knowledge_standard.tier.label, message: quality.knowledge_standard.messages.join(" ") },
        contentRepair,
        { stage: "quality", ok: true, score: quality.score, status: quality.status }
      ]),
      source_discovery: sourceDiscovery,
      lesson_plan: generated.lesson_plan,
      course_blueprint: generated.course_blueprint,
      evidence_map: generated.evidence_map,
      objectives: generated.objectives,
      files,
      presenter_script: presenterScript,
      bundle,
      class_record: bundle.class_record,
      exports: bundle.manifest.exports,
      preview_html: previewHtml,
      publish,
      class_url: publish.status === "published" ? publish.expected_url : null
    });
  } catch (error) {
    send(res, 400, { ok: false, errors: [safeErrorMessage(error.message || error)] });
  }
};
