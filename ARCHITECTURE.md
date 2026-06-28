# ARCHITECTURE.md — Masterclass Factory (Sprint 0 baseline)

Generated in Sprint 0 (audit only; **no runtime behavior changed**). One paragraph per
backend module: purpose, exports, and external calls (LLM / Tavily / GitHub / fs / KV).
Line numbers are `file:line` as of this commit. Companion docs: `BUGS.md` (known-issue
register, confirmed against code) and `scripts/smoke.js` (endpoint liveness harness).

- **Stack:** vanilla HTML/CSS/JS frontend + Node CommonJS serverless in `api/`. GitHub is the
  datastore (Git Data + Contents API). LLM is multi-provider via `api/llm.js` (default
  **Anthropic**); search is Tavily (primary) + OpenAI `web_search` (fallback). Vercel KV /
  Upstash backs the live-classroom endpoints.
- **Node:** v24.15.0 (local). `package.json` `type: "commonjs"`, single runtime dep `qrcode`.

---

## 1. Test suite — command & result

**The gate (CLAUDE.md / ENGINEERING-BUILD-PLAN.md §6), run from repo root:**

```
node test/harness.js && node test/kb-rounds.test.js && node test/kb-objectives.test.js && node test/kb-budget.test.js && node test/theme.test.js && node test/curriculum.test.js && node test/curriculum-store.test.js && node test/curriculum-build.test.js
```

**Result (clean checkout, this commit): ALL GREEN.** Per-suite totals:

| Suite | Result |
|---|---|
| `test/harness.js` | 118 passed, 0 failed |
| `test/kb-rounds.test.js` | 27 passed, 0 failed |
| `test/kb-objectives.test.js` | 12 passed, 0 failed |
| `test/kb-budget.test.js` | 16 passed, 0 failed |
| `test/theme.test.js` | 18 passed, 0 failed |
| `test/curriculum.test.js` | 30 passed, 0 failed |
| `test/curriculum-store.test.js` | 19 passed, 0 failed |
| `test/curriculum-build.test.js` | 35 passed, 0 failed |
| **Gate total** | **275 assertions, 0 failed** |

No test-runner breakage was found in the gated suites; nothing was changed to make them pass.

**Caveats discovered (see BUGS.md B12–B15) — the green is partly overstated:**
- `test/harness.js` `test()` (line 22) is **synchronous and does not await** the test body.
  Every `async () => {}` test is counted "ok" the instant it is launched; its assertions
  settle as microtasks *after* `process.exit(0)` at line 762. Async assertions are therefore
  **non-gating**. Demonstrated: "brief endpoint validates a good brief (200)" reports ok but
  the endpoint actually returns **422** for the body the test sends (see B13).
- Two test files are **not in the gate and currently fail**: `test/classify-source.test.js`
  and `test/author-plan.test.js` (they import `_internal.classifySource` / `planAuthorBatches`
  / `fastAuthorModels`, which `generate.js` no longer exports). They were excluded from the
  gate, so the gate stays green while real coverage is broken (B14).
- `package.json`'s `test` script runs only **6 of 8** gate files (omits `curriculum-store`
  and `curriculum-build`). The canonical gate is the CLAUDE.md command above, not `npm test` (B15).
- Four backend modules have **zero gate coverage** though they have passing standalone suites:
  `curriculum-coherence.js`, `curriculum-bibliography.js`, `llm.js` (adapters + BYOK). Their
  suites (`curriculum-coherence.test.js`, `curriculum-bibliography.test.js`, `llm.test.js`,
  `llm-byok.test.js`) pass but are never run by the gate.

---

## 2. Backend modules (`api/`)

### 2.1 The engine

**`api/generate.js` (~3845 lines — THE MONOLITH).** The single course-generation handler and
the de-facto research-engine→knowledge-core→renderer pipeline in one file. `module.exports` is
an `async (req,res)` handler: `OPTIONS`→204 (3487), non-`POST`→405 (3493); the `POST` path runs
parse+ledger/engine setup (3499) → brief validation against `brief.template.json` (3517) → KB
discovery/resolution `resolveKnowledgeBase` (3532, non-blocking; pauses with
`knowledge_base_review` when the floor is unmet) → `buildSourcePaper` (3617) → staged LLM
authoring `runOpenAIStages` (3628: research→curriculum→batched slides→glossary→assessment, with
deterministic fallback) → deck assembly + `repairContentDepth` (3638) → independent
source-verify + QA + quality score (3645) → gate `resolveQaOutcome` (3652) → `publishToGitHub`
(3716) → success with cost ledger. **Exports:** the handler + a large `_internal` (3796) surface
consumed by `knowledge-base.js`, `remediate.js`, and the test suites — incl.
`resolveKnowledgeBase, discoverKnowledgeBaseSources, findSourceCandidates,
normalizeDiscoveredSources, fetchUrlText, scoreKnowledgeBase, qaGate, resolveQaOutcome,
qualityAudit-helpers, assessSourceScarcity, buildChangeOrder, classTierSpec, slugify,
isPrivateAddress, assertFetchableUrl, configuredModels`, etc. **External calls:** Tavily
`tavilySearch` → `POST https://api.tavily.com/search` (762); OpenAI web search via
`requestOpenAIResponsesSearchJson` → `/v1/responses` with `web_search_preview` (623,632) and
fallback `requestOpenAISearchJson` → `/v1/chat/completions` with `web_search_options` (683,692);
LLM authoring `requestOpenAIJson` → `llm.completeJson` (1636); GitHub publish `githubRequest`
→ `https://api.github.com/...` (3383) with get-ref/get-commit/blobs/trees/commits/patch-ref
(3436–3465); `fs.readFileSync` only as a fallback in `readTemplateFile` (3316), with the
primary path decoding base64 from `template-embed.js` (3312). **No `fs` writes** — publishing
is GitHub-API only.

**`api/llm.js` (~338 lines).** Provider abstraction — the one chokepoint so any endpoint can
call a model without knowing the provider. Registry of OpenAI / xAI / Anthropic / Gemini
adapters (each: keyEnv, defaultModel, build/extract/usage). `completeJson` (236) walks a model
ladder with a per-model `AbortController` timeout and `shouldRetry` transient handling, returns
`{provider,model,text,data,usage}`; `completeText` is the `jsonMode:false` wrapper. Degrades to
the default provider when a requested one has no key. **`DEFAULT_PROVIDER = "anthropic"` (178).**
**Exports:** `completeJson, completeText, availableProviders, resolveProvider, isAvailable,
DEFAULT_PROVIDER, _internal{PROVIDERS,parseJson,stripFences,providerKey,resolveCall}`.
**External calls:** `fetch` to each provider's endpoint (built per adapter). No Tavily/GitHub/fs.
**Env:** provider keys via `envFirst` (22) — `OPENAI_API_KEY`, `XAI_API_KEY`/`GROK_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, plus optional `*_MODEL` overrides.

### 2.2 Knowledge base (resolve / seal)

**`api/knowledge-base.js` (~248 lines).** Interactive KB resolve/seal HTTP handler for wizard
step 2 — generates/publishes nothing. `POST`-only (OPTIONS 204, else 405), dispatches on
`body.mode`: **review** (default) → `resolveKnowledgeBase` (208) → `ready` or an interactive
`knowledge_base_review`; **rounds** → one `runKnowledgeBaseRound` (108) + `buildCompositionLedger`
(113) + `buildObjectiveSaturation` (118); **seal** → applies the human decision and stamps a
sealed brief. **Exports:** the handler. **External calls:** none directly — it imports the real
discovery/scoring primitives from `generate._internal` (29–42) and injects them into the kb
helpers; all LLM/Tavily/network happen transitively inside those. **Env:** none.

**`api/kb-rounds.js`.** One incremental discovery ROUND for the saturation panel; performs no
discovery itself — all primitives are **injected** via `opts.primitives` (production passes
`generate._internal`, tests pass fakes). State is carried in the request body (stateless
endpoint). `runKnowledgeBaseRound` builds a prompt, calls injected `findSourceCandidates` (228),
verifies via injected `fetchUrlText` (239), scores via injected `scoreKnowledgeBase` (272).
**Exports:** `runKnowledgeBaseRound, buildRoundCheckpoint, buildCompositionLedger,
recommendationFor, emptyState, _normPath`. **External calls / env:** none direct (all injected).

**`api/kb-objectives.js`.** Per-objective KB saturation ("weakest objective gates the class",
not averaged) with an injectable source→objective relevance mapper (default: a clearly-labeled
keyword-overlap **proxy**). Pure/deterministic. **Exports:** `buildObjectiveSaturation,
readObjective, keywordOverlapMapper, objectiveId, domainOf, _tokens`. **External calls / env:** none.

**`api/kb-budget.js` (~165 lines).** Budget governor — tracks real spend vs a human-set budget
and **notifies (never refuses)** on overage. Per-model `PRICING`, `tokenCostUsd`, `readOpenAIUsage`
(both OpenAI usage shapes), `createBudgetLedger`, `checkOverage`. Pure. **Exports:** `PRICING,
ESTIMATES, priceForModel, tokenCostUsd, readOpenAIUsage, estimateOperationUsd,
createBudgetLedger, checkOverage`. **External calls / env:** none.

### 2.3 Curriculum chain

**`api/curriculum.js` (~326 lines).** Curriculum planner. `POST` (OPTIONS; else 405): given a
subject (or a pasted syllabus to *ingest*), one LLM call produces an ordered syllabus as strict
JSON, then normalize/validate (2 attempts, lowered temp on retry; logs `CURRDIAG`). **Exports:**
handler + `_internal{emptyPlan, buildCurriculumPrompt, buildIngestPrompt, parsePlanFromLLM,
normalizePlan, validatePlan, planToBriefs}`. **External calls:** `llm.completeText` (292), model
ladder built at 264–273, timeouts `[120000, 90000]`. **Env:** `OPENAI_CURRICULUM_MODEL` (268),
`ANTHROPIC_CURRICULUM_MODEL` (270) — both optional (fall back to defaults).

**`api/curriculum-build.js` (~333 lines).** Fan-out orchestration + persistence/status endpoint.
`GET` (`?slug` → view; `?slug&class` → single brief), `POST` (`action:save` / `action:status`).
Pure core: `buildOrder` (Kahn topo-sort), `nextBuildable`, `readyBuildable`, `briefForClass`
(synthesize a contract-valid brief by deep-merging `brief.template.json` with curriculum/class
setup). **Exports:** handler + `buildOrder, nextBuildable, readyBuildable, briefForClass,
_internal`. **External calls:** GitHub only via the store (no direct fetch/LLM/Tavily/fs).
Reads query via `qparam` (req.query → manual `req.url` split) — **no `url.parse()`**, so **B11
does not apply here** (already WHATWG-clean). **Env:** none directly.

**`api/curriculum-store.js` (~435 lines).** Curriculum data model + GitHub persistence
(manifest at `curricula/<slug>/curriculum.json`; per-class status is the job state).
`normalizeSetup` (whitelist/clamp shared setup to the brief contract — **new shared fields must
be added here or they are stripped**), `normalizeManifest`, `planToManifest`, `validateManifest`,
`setClassStatus`, `manifestToBriefs`, `readManifest`/`writeManifest`. **External calls:** GitHub
Contents API via `githubRequest` → `fetch("https://api.github.com"+path)` (391); read GET (408),
write PUT (428). **Env (all in `githubConfig`, 382–385):** `GITHUB_TOKEN`,
`GITHUB_OWNER`/`VERCEL_GIT_REPO_OWNER`, `GITHUB_REPO`/`VERCEL_GIT_REPO_SLUG`, `GITHUB_BRANCH`.

**`api/curriculum-coherence.js`.** Deterministic cross-class coherence (errors: unresolved /
forward / cyclic prerequisites; warnings: duplicate objectives, weak outcome coverage). Pure;
warnings inform, never block. **Exports:** `analyzeCoherence, buildGraph, detectCycles,
_internal`. **External calls / env:** none.

**`api/curriculum-bibliography.js`.** Harvest each built class's cited sources and roll them up
into the curriculum `knowledge_core` bibliography (normalize, URL-dedupe, summarize). Pure,
non-mutating. **Exports:** `normalizeSource, dedupeKey, dedupeSources, recordClassSources,
rollUpKnowledgeCore, bibliography, summarize, _internal`. **External calls / env:** none.

### 2.4 Provider-aware support endpoints

**`api/genie.js` (~231 lines).** "Bernard" wizard assistant. `POST` (else 405): trims the brief,
prompts the LLM in JSON mode, returns `{ok, model, answer, recommendation}` (clamped
length/interaction numbers — never shortened for technical audiences). 503 only if the chosen
provider is unconfigured. **Exports:** handler. **External calls:** `llm.completeJson` (174).
**Env:** `OPENAI_API_KEY` (42, only to compose the 503 message), `OPENAI_MODEL` (54, optional).
Contains dead OpenAI-direct helpers (`KEY_PATTERN`, `openAIError`, `shouldTryNextModel`).

**`api/objectives.js`.** Drafts *provisional* learning objectives (terminal/enabling/out_of_scope).
`POST` (else 405): validates brief (422), provider-gates (503), prompts LLM in JSON mode, caps
arrays, returns `{ok, message, model, objectives}`. **Exports:** handler. **External calls:**
`validateBrief` (198), `llm.completeJson` (165). **Env:** `OPENAI_API_KEY` (116, 503 message),
`OPENAI_MODEL` (94, optional). Same dead OpenAI-direct helpers as genie.

**`api/theme.js` (~319 lines).** Class theming: maps a palette token set onto the template's CSS
vars and enforces WCAG contrast (auto-nudge). `GET`→catalog; `POST {description,engine}`→LLM
description→palette→CSS. Degrades safely (503/422/502/405). **Exports:** handler + `_internal`
(clampHex, contrastRatio, nudgeForContrast, normalizePalette, ensureLegible, themeCssOverride,
resolveThemeCss, themeCatalog, paletteFromLLMJson, themePromptMessages — `resolveThemeCss` is
consumed by `generate.js`). **External calls:** `llm.completeText` (280); optional
`kb-budget.tokenCostUsd` (286). **Env:** `OPENAI_THEME_MODEL` (277, optional default
`gpt-4o-mini`); `OPENAI_API_KEY` indirectly via `llm.isAvailable`.

**`api/providers.js`.** Read-only `GET`: lists provider id/label/availability/default-model for
the UI selector (never keys). **Exports:** handler. **External calls:** `llm.availableProviders`
(31), `llm.DEFAULT_PROVIDER` (34). **Env:** none directly (availability computed in `llm.js`).

**`api/remediate.js` (~105 lines).** On-demand KB remediation. `POST {brief}`: deep-copies the
brief, **temporarily** forces `research.owner="ai"`/`allow_web=true` (never mutates the caller's
brief), and if the floor is unmet runs Bernard's discovery to return verified candidates for
human approval. **Exports:** handler. **External calls:** delegates to
`generate._internal.discoverKnowledgeBaseSources` (76) — LLM+Tavily happen there. **Env:** none
directly (inherited via generate.js). `maxDuration 120`.

**`api/template-embed.js` (~2 lines, auto-generated, do-not-edit).** A base64 map of the published
class template files (`index.html, engine.js, navscrubber.js, api/{chat,grade,poll,words,feedback,
quality,tts}.js`) so the serverless publish path can write a full class without disk reads
(Vercel file-tracing workaround). Pure data; consumers decode. **External calls / env:** none.

### 2.5 Runtime / classroom endpoints (`api/*` → `template/api/*`)

`api/{chat,feedback,grade,poll,quality,tts,words}.js` are **one-line re-exports** of
`../template/api/*.js`; the real logic (and line numbers) live in the `template/api/` copies.
These are the deployed-class runtime, and they call **OpenAI directly** (not via `llm.js`, not
Anthropic) and use **Vercel KV / Upstash** as the live datastore.

- **`chat.js`** — Bernard tutor. `POST` only. `fetch` OpenAI `/v1/chat/completions` (template 78),
  model fallback (`gpt-5.5`→`gpt-5.4`→`gpt-4.1-mini`). **Env:** `OPENAI_API_KEY` (18, missing→503),
  `OPENAI_MODEL` (22, optional).
- **`grade.js`** — AI short-answer grader, level-calibrated. `POST` only. `fetch` OpenAI chat
  (template 105), JSON mode. **Env:** `OPENAI_API_KEY` (27, missing→503), `OPENAI_MODEL` (31).
- **`quality.js`** — class quality + participation report. `POST` only. KV pipeline (poll/words/
  feedback) (template 27,77–80) + optional `aiSummary` OpenAI chat (207). **Env:** KV vars
  (25, missing→`not_configured`, non-fatal), `OPENAI_API_KEY` (53, missing→`ai.available:false`,
  non-fatal), `OPENAI_MODEL` (54).
- **`tts.js`** — natural-voice TTS → `audio/mpeg`. `POST` only. `fetch` OpenAI `/v1/audio/speech`
  (template 26), model `gpt-4o-mini-tts`, default voice `fable`. **Env:** `OPENAI_API_KEY`
  (18, missing→503; **no key-format validation here**, raw read).
- **`poll.js`** — live poll tallies. `GET` read / `POST` vote / `POST ?reset` (admin). KV pipeline
  (template 8). **Env:** KV vars (6, missing→503), `POLL_ADMIN_KEY` (30, unset→reset disabled/403).
- **`words.js`** — word-cloud frequencies. `GET`/`POST ?w`. KV pipeline (template 7). **Env:**
  KV vars (5, missing→503).
- **`feedback.js`** — append audience feedback (RPUSH `feedback:all`). `POST` only. KV pipeline
  (template 6). **Env:** KV vars (4, missing→503).

### 2.6 Ops / utility endpoints

**`api/admin.js`.** Owner-only class-health summary. `GET` only (else 405). Timing-safe key check;
scans `classes/` on disk (`fs.readdirSync/readFileSync/statSync` 45–62). **Env:** `POLL_ADMIN_KEY`
(28, unset→**503/disabled**; wrong key→403). No network/LLM.

**`api/librarian.js`.** Source link-rot / drift monitor (Vercel cron `0 9 * * 1`). `GET`/`POST`.
Reads each class's `source.js`/`class-record.json` from disk (`fs` 61–75), HEAD-checks ≤20
URLs/class with SSRF guards (`dns.lookup` 151), diffs ETag/Last-Modified vs the previous report
in KV, flags `needs_review`, writes the new report to KV. **External calls:** generic `fetch`
HEAD (164); KV pipeline (193). **Env:** `KV_REST_API_URL`/`KV_REST_API_TOKEN` (190–191,
missing→`storage:not_configured`, report still builds, `saved:false`).

**`api/brief.js`.** Brief-contract validator. CORS; OPTIONS 204, GET metadata, **`POST` validates
the *bare* body** against `brief.template.json` (200 / 422 / 400 / 405). **`readBody` (10)
prefers `req.body` when it is an object, else parses the raw stream.** **Exports:** handler.
**External calls / env:** none. *Note: the gate test for this endpoint posts a `{brief: ...}`
wrapper, which this handler rejects — see B13.*

**`api/qr.js`.** QR SVG generator. Any method. `qrcode` package render with a hand-built SVG
fallback; always `200 image/svg+xml`. **External calls / env:** none (CPU only).

---

## 3. Environment-variable audit

Every `process.env.*` read in `api/` (and the `template/api/` runtime), where it is read, and
the failure mode if missing. **Flagged 🟠 = absence silently degrades the product** (no error to
the user); 🔴 = hard outage for that endpoint.

| Env var | Read at | Missing → |
|---|---|---|
| `ANTHROPIC_API_KEY` | `llm.js:22` (envFirst, default provider) | 🔴 Default LLM path unconfigured. `generate`/`curriculum`/`genie`/`theme`/`objectives` degrade to next available provider or surface a clear "not configured" stage error. **This is the default provider per `llm.js:178` — its absence is the most impactful.** |
| `OPENAI_API_KEY` | `generate.js:1540`, `genie.js:42`, `objectives.js:116`, `theme` (via llm), `template/api/{chat:18,grade:27,quality:53,tts:18}` | 🟠/🔴 Mixed: web-search discovery & the classroom endpoints (chat/grade/tts) hard-fail (503); 🟠 **OpenAI `web_search` fallback in `generate.js` silently yields zero candidates** (feeds the B1 15/100 signature); quality AI summary degrades non-fatally. |
| `TAVILY_API_KEY` | `generate.js:741,757` | 🟠 **Silent.** `tavilySearch` returns `[]` with no surfaced note (`generate.js:758`), so discovery quietly loses its primary provider — indistinguishable from "genuinely zero results" (root of B1). |
| `OPENAI_MODEL` | `generate.js:1566`, `genie.js:54`, `objectives.js:94`, `template/api/*` | Optional → default model ladder. |
| `OPENAI_SEARCH_MODEL` | `generate.js:590` | Optional → default search model. |
| `OPENAI_CURRICULUM_MODEL` | `curriculum.js:268` | Optional → `gpt-4o`. |
| `ANTHROPIC_CURRICULUM_MODEL` | `curriculum.js:270` | Optional → `claude-haiku-4-5-20251001`→`claude-sonnet-4-6`. |
| `OPENAI_THEME_MODEL` | `theme.js:277` | Optional → `gpt-4o-mini`. |
| `XAI_API_KEY`/`GROK_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `*_MODEL` | `llm.js` registry | Optional → that provider shows unavailable. |
| `GITHUB_TOKEN` | `generate.js:3382,3403`, `curriculum-store.js:382` | 🔴 Publish + manifest read/write fail (no datastore writes). Generation can still run but cannot publish. |
| `GITHUB_OWNER` / `VERCEL_GIT_REPO_OWNER` | `generate.js:3404`, `curriculum-store.js:383` | 🔴 Same as above (repo target unknown). On Vercel the `VERCEL_GIT_*` fallbacks usually cover this. |
| `GITHUB_REPO` / `VERCEL_GIT_REPO_SLUG` | `generate.js:3405`, `curriculum-store.js:384` | 🔴 Same. |
| `GITHUB_BRANCH` | `generate.js:3406`, `curriculum-store.js:385` | Optional → `main`. |
| `PUBLIC_BASE_URL` | `generate.js:3369` | Optional → falls back to `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` for the published class URL. |
| `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL` | `generate.js:3372–3373` | Optional (Vercel-provided) → class URL may be relative/blank if all unset. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | `librarian.js:190–191`, `template/api/{feedback,poll,words,quality}` | 🟠/🔴 Classroom interactivity (poll/words/feedback) hard-fails 503; 🟠 librarian + quality degrade to `not_configured` (report still returned, **drift monitoring silently does nothing**). |
| `POLL_ADMIN_KEY` | `admin.js:28`, `template/api/poll.js:30` | 🟠 `admin` endpoint disabled (503); poll reset disabled (403). |

**Silent-degradation flags to carry into Sprint 1/8:** `TAVILY_API_KEY` and the OpenAI
`web_search` fallback both fail *silently* in discovery (return `[]`), which is the mechanism
behind B1's 15/100 collapse. `KV_*` absence silently no-ops the librarian drift monitor.

---

## 4. Architecture seam (current vs target)

Today the research-engine → knowledge-core → renderer seam is **implicit inside `generate.js`**:
discovery (`discoverKnowledgeBaseSources`/`tavilySearch`/`requestOpenAI*Search`), core assembly
(`buildSourcePaper` + the authored deck), QA/quality (`qualityAudit`/`resolveQaOutcome`), and
publish (`publishToGitHub`) are all one file. `knowledge-base.js` + `kb-rounds.js` already model
the **interactive seal** (a brief is sealed by a human decision and never re-litigated), and
`kb-rounds.js`/`kb-objectives.js` are cleanly **dependency-injected** — the cleanest existing
example of the target seam. Sprint 3 extracts `lib/` modules behind a golden-output test; Sprint
4 makes the knowledge core a first-class sealed artifact that renderers consume (renderers never
run on an unsealed core). This section will be updated as those sprints land.

---

## 5. Smoke harness (`scripts/smoke.js`)

`node scripts/smoke.js` imports each `api/` HTTP handler and invokes it with a realistic mock
request while **stubbing every external** (global `fetch` is a canned router for OpenAI /
Anthropic / Tavily / GitHub / KV; env is set to dummy values; **nothing is published**). It
prints `{endpoint, method, ok, status, ms}`. `ok` = "responded without throwing or hanging" — a
handled 4xx/5xx still counts as ok (under fully-stubbed externals an unparseable canned model
reply legitimately degrades to a 502, which is the never-dead-end behavior we want). Latest run:
**21/21 endpoints responded, exit 0** (theme/curriculum return a graceful 502 because the stub
feeds an empty model reply; curriculum-build returns 404 for a non-existent manifest). See
`BUGS.md` for the full table and notes.
