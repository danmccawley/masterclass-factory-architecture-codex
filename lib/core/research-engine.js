// lib/core/research-engine.js
//
// The research engine: the source-discovery cascade extracted from
// api/generate.js (Sprint 3, module 5 — step 3 of 3, behavior-preserving). This
// is the layer that finds, verifies, and reasons about knowledge-base sources:
//   - SSRF-guarded URL fetch/verification (isPrivateAddress, assertFetchableUrl,
//     fetchUrlText[Once])
//   - the OpenAI web_search cascade (requestOpenAI*SearchJson, configuredSearchModels)
//   - the Tavily search client (tavilySearch[Once], classifyByHost)
//   - the unified finder + discovery loop (findSourceCandidates, openAIWebSearchSafe,
//     normalizeDiscoveredSources, discoverKnowledgeBaseSources, prepareKnowledgeBase)
//   - scarcity diagnosis + change-order/resolution menu (highestMetTier,
//     assessSourceScarcity, buildChangeOrder, buildResolutionOptions)
//
// Dependency direction (acyclic; requires NOTHING back from generate.js):
//   util, cost, diagnostics, openai  ->  research-engine  ->  generate
//
// STRICTLY behavior-preserving: every function body and the research-private
// constants are moved verbatim. Gated by test/golden/golden.test.js.
"use strict";

const {
  clampInteger, text, list, isUrl, stripHtml,
  sourceCounts, knowledgeBaseStandard, researchOwner, CLASS_TIERS
} = require("../util.js");
const {
  safeErrorMessage, isTransientFailure, isTimeoutMessage, kbdiag, safeHost,
  discoveryDelay, DISCOVERY_RETRY_BACKOFF_MS
} = require("./diagnostics.js");
const {
  openAIKey, validateOpenAIKey, openAIKeyUsable, configuredModels,
  openAIError, shouldTryNextModel, parseJsonPayload,
  DEFAULT_OPENAI_MODEL, FALLBACK_OPENAI_MODELS, DEFAULT_OPENAI_SEARCH_MODEL
} = require("./openai.js");
const { recordOpenAISpend, recordTavilySpend } = require("../cost.js");

// Research-private budgets. TAVILY_SEARCH_TIMEOUT_MS is defined inline below,
// next to the Tavily client it guards.
const MAX_SOURCE_CHARS = 9000;
const SOURCE_FETCH_TIMEOUT_MS = 9000;
const OPENAI_SEARCH_TIMEOUT_MS = 22000;
const MAX_DISCOVERY_URL_CHECKS = 16;
// Cap discovery rounds so the serverless function stays under its execution
// timeout. Each round is one OpenAI web-search call plus up to MAX_DISCOVERY_URL_CHECKS fetches.
const MAX_DISCOVERY_ROUNDS = 3;
// Overall wall-clock budget for the whole discovery phase. Sits comfortably
// inside knowledge-base.js maxDuration (120s) so one slow provider can never
// consume the entire function; rounds stop early when this is reached.
const DISCOVERY_TIME_BUDGET_MS = 100000;

// SSRF guard. Source URLs can be supplied by the caller (knowledge_base.uploads)
// or by Bernard's web search, so before the server fetches one we confirm it is a
// public http(s) host. We resolve the hostname and reject loopback, private,
// link-local, and cloud-metadata addresses to prevent the generator from being
// used to read internal services.
function isPrivateAddress(ip) {
  const v = String(ip || "");
  if (v === "::1" || v === "::" || v === "0.0.0.0") return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(v)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(v)) return true;
  // IPv4-mapped IPv6 — strip prefix and re-test
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const ipv4 = mapped ? mapped[1] : v;
  const m = ipv4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 127) return true;                        // loopback
  if (a === 0) return true;                          // this-network
  if (a === 169 && b === 254) return true;           // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT 100.64.0.0/10
  return false;
}

async function assertFetchableUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (error) {
    throw new Error("Source URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) source URLs are allowed.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") {
    throw new Error("Source URL points to a non-public host.");
  }
  // If the host is a literal IP, check it directly; otherwise resolve it.
  if (isPrivateAddress(host)) {
    throw new Error("Source URL points to a private address.");
  }
  try {
    const dns = require("dns").promises;
    const records = await dns.lookup(host, { all: true });
    if (records.some((record) => isPrivateAddress(record.address))) {
      throw new Error("Source URL resolves to a private address.");
    }
  } catch (error) {
    if (/private address/.test(error.message)) throw error;
    // DNS failure: let the fetch attempt surface the network error normally.
  }
}

// One verification attempt. Returns a TYPED result and never throws. The
// `transient` flag tells the caller whether the failure is worth a retry (abort/
// timeout/5xx) vs a hard answer (404/410, or an SSRF reject) that must not be.
async function fetchUrlTextOnce(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    await assertFetchableUrl(url); // SSRF guard — stays a hard reject.
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A realistic browser identity. Many legitimate publishers and .gov
        // sites (Reuters, etc.) return 403 to obvious bot user-agents, which was
        // causing valid, found sources to be thrown away at verification.
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      }
    });

    // 404/410 = the resource genuinely is not there → HARD reject (don't cite
    // dead links, don't retry).
    if (response.status === 404 || response.status === 410) {
      return { ok: false, transient: false, error: `HTTP ${response.status}` };
    }
    // 5xx = server hiccup → TRANSIENT; a retry may succeed and it should not be
    // recorded as a permanently dead link.
    if (response.status >= 500) {
      return { ok: false, transient: true, error: `HTTP ${response.status}` };
    }

    // 401/403/406/429 = the server RESPONDED and the page exists; it just declined
    // our scraper (bot protection / paywall / rate limit). A human or browser can
    // reach it, so it is a valid citation. Accept it as reachable without full text.
    if (!response.ok) {
      return { ok: true, text: "", reachable_only: true, note: `Reachable (HTTP ${response.status}); full text not extractable by the verifier.` };
    }

    const raw = await response.text();
    const cleaned = stripHtml(raw).slice(0, MAX_SOURCE_CHARS);
    // 2xx but no extractable text (e.g. JS-rendered page) is still a reachable,
    // citable source — accept it rather than discard a real page.
    if (!cleaned) {
      return { ok: true, text: "", reachable_only: true, note: "Reachable; page rendered no static text for the verifier." };
    }
    return { ok: true, text: cleaned };
  } catch (error) {
    const msg = safeErrorMessage(error.message || error);
    // SSRF / non-public-host rejections are HARD (never retry, never cite).
    const hard = /private address|non-public host|only http|not allowed/i.test(msg);
    return { ok: false, transient: !hard && isTransientFailure(0, msg), error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

// Verify a candidate URL, with ONE retry on a transient failure. Always returns
// a typed result; never throws to the round. A transient failure that survives
// the retry stays `transient:true` so callers can leave the URL retryable rather
// than blacklisting it.
async function fetchUrlText(url) {
  let res = await fetchUrlTextOnce(url);
  if (!res.ok && res.transient) {
    await discoveryDelay(DISCOVERY_RETRY_BACKOFF_MS);
    const retry = await fetchUrlTextOnce(url);
    kbdiag({ stage: "source_fetch", host: safeHost(url), outcome: retry.ok ? "recovered_on_retry" : "transient_failure_after_retry" });
    res = retry;
  }
  return res;
}

function configuredSearchModels() {
  const configured = String(process.env.OPENAI_SEARCH_MODEL || "").trim();
  // Try the dedicated search model first if configured/available, then fall back
  // to the regular models so web research never hard-fails just because the
  // special search model name isn't enabled on this account.
  return Array.from(new Set([configured, DEFAULT_OPENAI_SEARCH_MODEL, DEFAULT_OPENAI_MODEL].concat(FALLBACK_OPENAI_MODELS).filter(Boolean)));
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
          tools: [{ type: "web_search_preview", search_context_size: "medium" }],
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
      recordOpenAISpend(payload, model);
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
      recordOpenAISpend(payload, model);
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

// ---------------------------------------------------------------------------
// Fast, reliable source discovery via a dedicated search API (Tavily).
//
// OpenAI's hosted web_search tool has been hanging/timing out, which both
// produced empty knowledge bases AND pushed the whole /api/generate function
// past the Vercel time limit (504 -> non-JSON -> a hard "blocked" dead-end).
// A dedicated search API returns candidate URLs in ~1-2s, so discovery can
// never stall the function. When TAVILY_API_KEY is set this becomes the
// primary finder; OpenAI web search is only a fallback when no key is present.
// ---------------------------------------------------------------------------
const TAVILY_SEARCH_TIMEOUT_MS = 12000;

function tavilyConfigured() {
  return Boolean(String(process.env.TAVILY_API_KEY || "").trim());
}

// Infer a source type + trust level from the host. Government, standards, and
// education domains are treated as primary; everything else as secondary.
function classifyByHost(url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { host = ""; }
  const primary = /\.gov(\.[a-z]{2})?$|\.gov\.|\.mil$|\.edu$|\.edu\.|europa\.eu$|who\.int$|un\.org$|iso\.org$|nist\.gov$|loc\.gov$|stlouisfed\.org$/.test(host);
  let type = "url";
  if (/\.gov|\.mil|iso\.org|nist|standard|regulat/.test(host)) type = "standard";
  else if (/\.edu/.test(host)) type = "certification training";
  return { trust: primary ? "primary" : "secondary", type };
}

// One Tavily call. Returns a TYPED result ({ ok, status, transient, candidates,
// error }) and never throws — a 5xx/429/abort is reported, not swallowed as an
// indistinguishable "zero results" (the old behavior that hid the B1 abort).
async function tavilySearchOnce(query, maxResults, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: String(query || "").slice(0, 380),
        search_depth: "basic",
        max_results: clampInteger(maxResults || 8, 1, 12),
        include_answer: false,
        include_raw_content: false
      })
    });
    if (!response.ok) {
      return { ok: false, status: response.status, transient: isTransientFailure(response.status, ""), candidates: [], error: `HTTP ${response.status}` };
    }
    const payload = await response.json().catch(() => ({}));
    recordTavilySpend(1);
    const results = Array.isArray(payload && payload.results) ? payload.results : [];
    const candidates = results.map((r) => {
      const url = text(r && r.url, "");
      const klass = classifyByHost(url);
      return {
        title: text(r && r.title, url),
        url,
        type: klass.type,
        trust: klass.trust,
        why: text(r && r.content, "").slice(0, 300)
      };
    }).filter((c) => isUrl(c.url));
    return { ok: true, status: 200, transient: false, candidates };
  } catch (error) {
    const msg = safeErrorMessage(error.message || error);
    return { ok: false, status: 0, transient: isTransientFailure(0, msg), candidates: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Tavily search with ONE retry on a transient failure, then degrade to an empty
// array — never throws. Each attempt/outcome is logged with a KBDIAG marker so a
// transient abort is visible in the logs instead of looking like "no results".
async function tavilySearch(query, maxResults) {
  const key = String(process.env.TAVILY_API_KEY || "").trim();
  if (!key) return [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await tavilySearchOnce(query, maxResults, key);
    if (res.ok) {
      if (attempt > 0) kbdiag({ stage: "tavily", outcome: "recovered_on_retry", attempt: attempt + 1, candidates: res.candidates.length });
      return res.candidates;
    }
    kbdiag({ stage: "tavily", outcome: res.transient ? "transient_failure" : "hard_failure", attempt: attempt + 1, status: res.status, error: res.error || null });
    if (!res.transient) break; // a hard 4xx will not improve with a retry
    if (attempt === 0) await discoveryDelay(DISCOVERY_RETRY_BACKOFF_MS);
  }
  return []; // degrade — the cascade (OpenAI) and the round handle an empty result
}

// Unified candidate finder. Prefers the fast search API; falls back to the
// OpenAI web-search path only when no search key is configured. Returns the
// same { model, data: { summary, source_candidates, gaps } } shape the
// discovery loop already understands.
async function findSourceCandidates(prompt, brief, standard, needed) {
  if (tavilyConfigured()) {
    const title = text(brief && brief.meta && brief.meta.title, "").trim();
    const queries = [];
    if (title) {
      queries.push(`${title} overview key facts`);
      if (needed && needed.primary_sources_needed > 0) {
        queries.push(`${title} official source government OR standards OR primary documentation`);
      } else {
        queries.push(`${title} authoritative guide reference`);
      }
    }
    const seeds = list(brief && brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.seed_prompts, [], 2);
    seeds.forEach((s) => { if (text(s, "")) queries.push(`${title} ${text(s, "")}`.trim()); });

    // The queries are independent, so run them with Promise.allSettled: one
    // query timing out can never discard the candidates the others returned.
    const seen = new Set();
    const candidates = [];
    const settled = await Promise.allSettled(queries.slice(0, 3).map((q) => tavilySearch(q, 8)));
    settled.forEach((r) => {
      const batch = r.status === "fulfilled" && Array.isArray(r.value) ? r.value : [];
      batch.forEach((c) => {
        if (c.url && !seen.has(c.url)) { seen.add(c.url); candidates.push(c); }
      });
    });
    if (candidates.length) {
      return { model: "tavily-search", data: { summary: `Found ${candidates.length} candidate source(s) via search API.`, source_candidates: candidates, gaps: [] } };
    }
    // Tavily configured but returned nothing (empty or fully degraded) — fall
    // through to the OpenAI web-search cascade below.
  }
  return await openAIWebSearchSafe(prompt);
}

// Cascade fallback: OpenAI web search, hardened so it NEVER throws into the
// round. One retry on a transient failure, then degrade to a typed empty result
// (the B1 fix at this layer — a web_search abort used to throw and break the
// whole discovery loop). Every outcome is logged with a KBDIAG marker.
async function openAIWebSearchSafe(prompt) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const out = await requestOpenAISearchJson("knowledge-base discovery", prompt, 3200);
      if (attempt > 0) kbdiag({ stage: "openai_web_search", outcome: "recovered_on_retry", attempt: attempt + 1 });
      return out;
    } catch (error) {
      const msg = safeErrorMessage(error.message || error);
      const transient = isTransientFailure(0, msg);
      kbdiag({ stage: "openai_web_search", outcome: transient ? "transient_failure" : "hard_failure", attempt: attempt + 1, error: msg });
      if (!transient || attempt === 1) {
        return { model: "", data: { summary: "Web search degraded; no candidates this attempt.", source_candidates: [], gaps: [] } };
      }
      await discoveryDelay(DISCOVERY_RETRY_BACKOFF_MS);
    }
  }
  return { model: "", data: { summary: "Web search degraded.", source_candidates: [], gaps: [] } };
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
  if (brief.knowledge_base.research.allow_web === false) {
    discovery.notes.push("AI-owned research was selected, but verified web research is turned off.");
    return discovery;
  }

  const current = sourceCounts(brief);
  if (standard.ok) {
    discovery.notes.push("The class maker's source list already meets the selected source floor; Bernard did not add extra sources.");
    return discovery;
  }

  discovery.attempted = true;
  discovery.rounds = 0;

  // Overall wall-clock budget so one slow provider can never consume the whole
  // function. Rounds stop early when this is reached, keeping whatever verified.
  const discoveryDeadline = Date.now() + DISCOVERY_TIME_BUDGET_MS;

  // Sources accepted during this run, plus a memory of dead URLs so later
  // rounds don't re-propose pages that already failed the readability check.
  const accepted = [];
  const acceptedPaths = new Set((brief.knowledge_base.uploads || []).map((source) => source.path));
  const deadPaths = new Set();

  // Recompute the remaining gap against the original uploads + everything
  // verified so far this run.
  const remaining = () => {
    const haveTotal = current.total + accepted.length;
    const havePrimary = current.primary + accepted.filter((source) => source.trust === "primary").length;
    return {
      total_sources_needed: Math.max(0, standard.required_sources - haveTotal),
      primary_sources_needed: Math.max(0, standard.required_primary_sources - havePrimary)
    };
  };

  for (let round = 0; round < MAX_DISCOVERY_ROUNDS; round += 1) {
    const needed = remaining();
    if (needed.total_sources_needed === 0 && needed.primary_sources_needed === 0) break;
    if (Date.now() > discoveryDeadline) {
      discovery.notes.push("Discovery time budget reached; stopping with the sources verified so far.");
      discovery.time_budget_reached = true;
      break;
    }
    discovery.rounds = round + 1;

    const prompt = JSON.stringify({
      task: "Find source candidates for this masterclass knowledge base. Return more candidates than needed so verification can reject weak or unreachable pages.",
      class_title: brief.meta.title,
      selected_tier: standard.tier,
      needed,
      round: round + 1,
      current_sources: brief.knowledge_base.uploads,
      already_accepted_urls: Array.from(acceptedPaths),
      already_rejected_urls: Array.from(deadPaths),
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
        "Do NOT return any URL listed in already_accepted_urls or already_rejected_urls.",
        "Do not include fake URLs or generic homepages unless the page itself is useful evidence.",
        round > 0
          ? "Earlier rounds came up short. Broaden the search: try adjacent terms, the governing body's own site, regional regulators, manufacturer documentation portals, and certification curricula."
          : "Prefer source pages that can support teaching claims, procedures, hazards, standards, vocabulary, or assessment.",
        needed.primary_sources_needed > 0
          ? `Prioritize PRIMARY sources this round; ${needed.primary_sources_needed} more primary source(s) are required.`
          : "Mark primary sources as primary only when the organization is the standard-setter, regulator, manufacturer, certification body, or direct publisher of the evidence."
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

    // findSourceCandidates is hardened to never throw (Tavily + OpenAI cascade
    // both degrade to a typed empty result). The try/catch is a defensive
    // backstop only; a degraded round yields zero candidates and continues
    // rather than collapsing the build.
    let researched;
    try {
      researched = await findSourceCandidates(prompt, brief, standard, needed);
    } catch (error) {
      researched = { model: "", data: { source_candidates: [], gaps: [] } };
      discovery.notes.push(`Round ${round + 1} search degraded: ${safeErrorMessage(error.message || error)}`);
    }
    if (researched.model) discovery.model = researched.model;
    discovery.gaps = list(researched.data && researched.data.gaps, [], 10);

    const seenPaths = Array.from(acceptedPaths).concat(Array.from(deadPaths));
    const candidates = normalizeDiscoveredSources(researched.data, seenPaths)
      .filter((candidate) => !acceptedPaths.has(candidate.path) && !deadPaths.has(candidate.path));

    const verificationTarget = Math.max(needed.total_sources_needed + 4, needed.primary_sources_needed + 2, 8);
    const candidatesToCheck = candidates.slice(0, Math.min(MAX_DISCOVERY_URL_CHECKS, verificationTarget + 4));
    discovery.notes.push(`Round ${round + 1}: Bernard found ${candidates.length} new candidate${candidates.length === 1 ? "" : "s"} and checked ${candidatesToCheck.length} URL${candidatesToCheck.length === 1 ? "" : "s"} for readability.`);

    if (!candidatesToCheck.length) {
      // Empty AFTER the per-provider retries inside findSourceCandidates means
      // the providers genuinely surfaced nothing new — stop early rather than
      // burn more rounds. (Transient blips are already retried one level down.)
      discovery.notes.push(`Round ${round + 1}: no new candidates to verify; stopping early.`);
      break;
    }

    // Promise.allSettled so a single fetch abort/timeout cannot discard the
    // sources that DID verify this round (a partial result is success).
    const settled = await Promise.allSettled(candidatesToCheck.map((candidate) => fetchUrlText(candidate.path)));
    settled.forEach((res, i) => {
      const candidate = candidatesToCheck[i];
      const fetched = res.status === "fulfilled"
        ? res.value
        : { ok: false, transient: true, error: safeErrorMessage((res.reason && res.reason.message) || res.reason || "fetch failed") };
      if (fetched.ok) {
        accepted.push(candidate);
        acceptedPaths.add(candidate.path);
      } else if (fetched.transient) {
        // Transient verification failure: leave the URL retryable (do NOT mark
        // it dead), so a later round can try it again. Not a rejection.
        discovery.notes.push(`Round ${round + 1}: a source check timed out transiently (${safeHost(candidate.path)}); left for a later round.`);
      } else {
        deadPaths.add(candidate.path);
        discovery.rejected_sources.push({ path: candidate.path, reason: fetched.error });
      }
    });
  }

  discovery.added_sources = accepted;
  discovery.evidence_limited = !accepted.length && current.total === 0;
  const finalGap = remaining();
  if (!accepted.length) {
    discovery.notes.push("Bernard searched across multiple rounds, but no candidate URLs passed the readability check.");
  } else if (finalGap.total_sources_needed || finalGap.primary_sources_needed) {
    discovery.notes.push(`Bernard added ${accepted.length} verified source${accepted.length === 1 ? "" : "s"} over ${discovery.rounds} round${discovery.rounds === 1 ? "" : "s"}, but the floor is still short by ${finalGap.total_sources_needed} usable and ${finalGap.primary_sources_needed} primary.`);
  }
  // Consolidated discovery KBDIAG so the whole external-call path is grep-able
  // from one marker, alongside the handler's KBDIAG.
  kbdiag({
    stage: "discovery_complete",
    rounds: discovery.rounds || 0,
    added: accepted.length,
    rejected: discovery.rejected_sources.length,
    model: discovery.model || "",
    evidence_limited: Boolean(discovery.evidence_limited),
    time_budget_reached: Boolean(discovery.time_budget_reached)
  });
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

// Highest tier whose source floor is already met by the current brief.
function highestMetTier(brief) {
  const order = ["expert", "professional", "standard", "briefing"];
  const counts = sourceCounts(brief);
  for (const key of order) {
    const tier = CLASS_TIERS[key];
    if (counts.total >= tier.source_floor && counts.primary >= tier.primary_source_floor) {
      return Object.assign({ level: key }, tier);
    }
  }
  return null;
}

// Diagnose WHY the floor is unmet, so the system can tell "obscure topic, the
// evidence barely exists" apart from "nobody added sources / research was off."
// The distinction drives whether we recommend a change order or just ask for input.
function assessSourceScarcity(discovery, brief) {
  const webAllowed = brief.knowledge_base && brief.knowledge_base.research && brief.knowledge_base.research.allow_web !== false;
  const keyOk = openAIKeyUsable();

  if (!discovery || !discovery.attempted) {
    return {
      kind: !keyOk ? "no_research_capability" : (!webAllowed ? "research_disabled" : "not_attempted"),
      genuinely_scarce: false,
      verified_found: 0,
      candidate_pool: 0,
      rounds: 0
    };
  }

  const verified = (discovery.added_sources || []).length;
  const rejected = (discovery.rejected_sources || []).length;
  const pool = verified + rejected; // everything Bernard surfaced across all rounds
  const rounds = discovery.rounds || 0;

  // Genuine scarcity: real multi-round web search surfaced very few candidates at
  // all. If the pool was large but verification rejected most, the bottleneck is
  // reachability (often transient), not the topic.
  if (rounds >= 2 && pool <= Math.max(3, verified + 2)) {
    return { kind: "topic_scarce", genuinely_scarce: true, verified_found: verified, candidate_pool: pool, rounds };
  }
  if (pool > verified && verified < 3) {
    return { kind: "verification_bottleneck", genuinely_scarce: false, verified_found: verified, candidate_pool: pool, rounds };
  }
  return { kind: "partial_progress", genuinely_scarce: rounds >= 2, verified_found: verified, candidate_pool: pool, rounds };
}

// Build a human-readable CHANGE ORDER: situation, challenges, a concrete
// recommendation, and the approval token needed to proceed. This is what the
// system presents when an obscure topic can't meet the requested bar.
function buildChangeOrder(brief, standard, discovery, scarcity, metTier) {
  const counts = standard.counts;
  const briefingFloor = CLASS_TIERS.briefing;
  const canMeetBriefing = counts.total >= briefingFloor.source_floor && counts.primary >= briefingFloor.primary_source_floor;

  // Decide the recommended action.
  let action, recommended_tier, summary;
  if (metTier) {
    action = "lower_tier";
    recommended_tier = metTier.level;
    summary = `Build a ${metTier.label} now (its ${metTier.source_floor}/${metTier.primary_source_floor} floor is met) instead of holding out for ${standard.tier.label}.`;
  } else if (scarcity.genuinely_scarce && counts.total > 0) {
    action = "evidence_limited_proceed";
    recommended_tier = canMeetBriefing ? "briefing" : (brief.class_tier && brief.class_tier.level) || "briefing";
    summary = `This topic is genuinely source-scarce. Recommend building an evidence-limited ${CLASS_TIERS[recommended_tier].label} on the ${counts.total} verified source(s) found, with scope, confidence, and "where evidence is thin" disclosed throughout — rather than waiting for sources that do not appear to exist publicly.`;
  } else if (scarcity.kind === "verification_bottleneck") {
    action = "retry_or_supply";
    recommended_tier = (brief.class_tier && brief.class_tier.level) || "professional";
    summary = `Bernard found candidate sources but most could not be fetched this run (often a temporary network/paywall issue). Recommend a retry, or supply one or two reachable sources directly.`;
  } else {
    action = "supply_sources";
    recommended_tier = (brief.class_tier && brief.class_tier.level) || "professional";
    summary = scarcity.kind === "no_research_capability"
      ? "AI research is not connected, so no automated sourcing was possible. Recommend adding sources, or connecting OpenAI so Bernard can search."
      : scarcity.kind === "research_disabled"
        ? "Web research is turned off for this class. Recommend enabling it so Bernard can search, or adding sources directly."
        : "Recommend adding one or more sources, or enabling AI-owned web research.";
  }

  const challenges = [];
  challenges.push(`Requested bar: ${standard.tier.label} (${standard.required_sources} usable / ${standard.required_primary_sources} primary).`);
  challenges.push(`Verified evidence on hand: ${counts.total} usable / ${counts.primary} primary.`);
  if (scarcity.kind === "topic_scarce") challenges.push(`Across ${scarcity.rounds} rounds of web search, only ${scarcity.candidate_pool} candidate source(s) surfaced at all — the public evidence base for this topic is thin.`);
  if (scarcity.kind === "verification_bottleneck") challenges.push(`${scarcity.candidate_pool} candidates were found but ${(discovery.rejected_sources || []).length} could not be fetched/verified this run.`);
  (discovery && discovery.gaps || []).slice(0, 6).forEach((g) => challenges.push(`Gap: ${g}`));

  const tradeoffs = [];
  if (action === "evidence_limited_proceed") {
    tradeoffs.push("The class will be narrower than a full masterclass and will say so plainly.");
    tradeoffs.push("Every claim stays tied to the verified sources; thin areas are flagged as open questions, not asserted.");
    tradeoffs.push("It carries an explicit evidence-limited label so learners and auditors see the scope.");
  } else if (action === "lower_tier") {
    tradeoffs.push(`Depth and source breadth match ${metTier.label}, not ${standard.tier.label}.`);
  }

  return {
    situation: `A ${standard.tier.label} was requested for "${brief.meta.title || "this class"}", but the available verified evidence does not meet that floor.`,
    diagnosis: scarcity.kind,
    genuinely_scarce: scarcity.genuinely_scarce,
    challenges,
    recommendation: { action, recommended_tier, summary, tradeoffs },
    what_bernard_tried: (discovery && discovery.notes) || ["Automated discovery was not available for this run."],
    rejected_sources: (discovery && discovery.rejected_sources) || [],
    how_to_approve: action === "evidence_limited_proceed"
      ? "Re-POST with accept_change_order:true to build the evidence-limited class, or accept_tier:'<level>' for a specific tier."
      : action === "lower_tier"
        ? `Re-POST with accept_tier:'${recommended_tier}' to build at the recommended tier.`
        : "Add sources or enable research, then start the generator again. Or re-POST with accept_change_order:true to proceed evidence-limited on what was found.",
    approval_tokens: {
      // The human can ALWAYS choose to proceed evidence-limited as long as there
      // is at least one usable source to build from — not only when the system
      // judged the topic "genuinely scarce". The system still recommends adding
      // sources, but the final call is the human's (no dead ends, always an
      // override path).
      accept_change_order: counts.total > 0,
      accept_tier: metTier ? metTier.level : (canMeetBriefing ? "briefing" : null)
    },
    score: standard.score,
    options: buildResolutionOptions(brief, standard, metTier, canMeetBriefing, counts)
  };
}

// The concrete, always-present menu the human chooses from. Mirrors the
// approval tokens but as labeled, render-ready choices. Never empty: even with
// zero sources, "add a source", "search again", and "ask Bernard" remain.
function buildResolutionOptions(brief, standard, metTier, canMeetBriefing, counts) {
  const options = [];
  // PRIMARY, always first: build it anyway. The human is the only off-switch,
  // so a build is always one click away regardless of source count (even zero).
  options.push({
    id: "proceed_anyway",
    label: counts.total > 0
      ? `Build it anyway (score ${standard.score.score}/100, ${counts.total} source${counts.total === 1 ? "" : "s"})`
      : "Build it anyway (no verified sources yet)",
    detail: counts.total > 0
      ? `Creates the class now on the ${counts.total} verified source(s) and clearly flags it as evidence-limited below the ${standard.tier.label} bar. Recommended only if you accept the lighter evidence.`
      : "Creates the class now with no verified sources. It will be clearly flagged as evidence-limited / unsourced. The factory never blocks — this is your call.",
    token: { proceed_anyway: true },
    kind: "build",
    primary: true
  });
  if (metTier && metTier.level !== standard.tier.level) {
    options.push({
      id: "lower_tier",
      label: `Build a ${metTier.label} instead (its floor is fully met)`,
      detail: `Your evidence fully satisfies the ${metTier.label} bar (${metTier.source_floor}/${metTier.primary_source_floor}). No evidence-limited flag needed.`,
      token: { accept_tier: metTier.level },
      kind: "build"
    });
  } else if (canMeetBriefing && (!metTier || metTier.level !== "briefing")) {
    options.push({
      id: "lower_tier_briefing",
      label: "Build a Briefing instead (its floor is met)",
      detail: "Your evidence meets the Briefing bar (4/1). A focused, fully-supported short class.",
      token: { accept_tier: "briefing" },
      kind: "build"
    });
  }
  options.push({
    id: "search_again",
    label: "Have Bernard search again first",
    detail: "Run another round of web research before building, optionally with guidance you provide.",
    token: null,
    kind: "research"
  });
  options.push({
    id: "add_source",
    label: "Add a specific source or URL first",
    detail: "Paste a standard, regulator page, manufacturer guide, or certification document, then build.",
    token: null,
    kind: "input"
  });
  options.push({
    id: "ask_bernard",
    label: "Ask Bernard (describe what you want)",
    detail: "Talk it through — refine the search, explain the gap, or get help adding a source. Any re-search is confirmed with you first.",
    token: null,
    kind: "conversational"
  });
  options.push({
    id: "decline_build",
    label: "Don't build yet — let me work on sources",
    detail: "Stops here so you can add sources or adjust the setup. This is the only thing that prevents a build.",
    token: null,
    kind: "decline"
  });
  return options;
}

module.exports = {
  isPrivateAddress: isPrivateAddress,
  assertFetchableUrl: assertFetchableUrl,
  fetchUrlTextOnce: fetchUrlTextOnce,
  fetchUrlText: fetchUrlText,
  configuredSearchModels: configuredSearchModels,
  responsesOutputText: responsesOutputText,
  requestOpenAIResponsesSearchJson: requestOpenAIResponsesSearchJson,
  requestOpenAISearchJson: requestOpenAISearchJson,
  tavilyConfigured: tavilyConfigured,
  classifyByHost: classifyByHost,
  tavilySearchOnce: tavilySearchOnce,
  tavilySearch: tavilySearch,
  findSourceCandidates: findSourceCandidates,
  openAIWebSearchSafe: openAIWebSearchSafe,
  normalizeSourceType: normalizeSourceType,
  normalizeTrust: normalizeTrust,
  normalizeDiscoveredSources: normalizeDiscoveredSources,
  discoverKnowledgeBaseSources: discoverKnowledgeBaseSources,
  prepareKnowledgeBase: prepareKnowledgeBase,
  highestMetTier: highestMetTier,
  assessSourceScarcity: assessSourceScarcity,
  buildChangeOrder: buildChangeOrder,
  buildResolutionOptions: buildResolutionOptions
};
