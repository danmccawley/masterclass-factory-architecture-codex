# Masterclass Factory — Full-Stack Engineering Build Plan

**Status:** living reference. **Stack:** vanilla HTML/CSS/JS frontend + Node (CommonJS) serverless on Vercel, GitHub as datastore. **Persona:** "Bernard."

This document is the single source of truth for the rebuild. It contains the product principles, the current and target architecture, the repository map, the target scaffolding, the engineering conventions, the testing/ops strategy, the known-issue register, and the **master sprint list — each sprint with a paste-ready Claude Code prompt.** Reference it by name in future conversations ("run Sprint 3 from the build plan").

---

## 0. How to use this document

1. Keep `CLAUDE.md` (Section 5, condensed) at the repo root so Claude Code reads the rules automatically every session.
2. Work **one sprint at a time, in order.** Do not start a sprint until the previous sprint's acceptance criteria and tests are green and committed.
3. For each sprint: paste its prompt into Claude Code → review the plan it proposes → review each diff → run the test gate → commit → confirm the Vercel deploy reaches `READY`.
4. Update the **Known-issue register** (Section 8) as bugs are closed.

---

## 1. Product overview & principles

Masterclass Factory turns a brief into a **source-grounded, interactive masterclass**. A user describes an audience, subject, and constraints; Bernard researches a verified knowledge base, then renders it into an interactive slide deck (and, on the roadmap, other formats). Two surfaces today: a **single-class creator** and a **curriculum planner** that fans out into many classes.

**Non-negotiable product principles:**

1. **Never dead-end a job.** The factory auto-resolves problems and escalates to the human only in genuinely extreme cases — and even then with actionable options. A bare error with no path forward is a bug.
2. **The human is the only off-switch.** Bernard proposes; the human seals/approves the consequential decisions (knowledge-base seal, ship-anyway).
3. **Everything is grounded.** Teaching content traces to verified sources; the knowledge base is resolved and sealed before rendering.
4. **Engine-first.** Deterministic, fully tested backend logic precedes UI wiring.
5. **Surface failures, never swallow them.** Every failure either auto-recovers or becomes a visible, explained, actionable state.

---

## 2. System architecture

### 2.1 Current architecture (as built)

```
Browser (static HTML/CSS/JS)
  ├─ create.html + wizard.js .............. single-class, 8-step wizard
  └─ curriculum.html (inline JS) .......... curriculum planner + review canvas
        │  (fetch JSON)
        ▼
Vercel serverless functions (api/, CommonJS)
  ├─ curriculum.js ........ plan/ingest a curriculum (LLM)
  ├─ curriculum-build.js .. brief-for-class mapping; build order
  ├─ curriculum-store.js .. normalizeSetup, manifest shape
  ├─ curriculum-coherence.js, curriculum-bibliography.js
  ├─ knowledge-base.js .... interactive KB resolve/seal (modes: review/rounds/seal)
  │     └─ kb-rounds.js, kb-objectives.js, kb-budget.js
  ├─ generate.js .......... THE MONOLITH (~3.8k lines): discovery, blueprint,
  │                          slides, deep dives, QA, quality scoring, gate, publish
  ├─ llm.js ............... multi-provider (Anthropic default; OpenAI/Gemini/xAI)
  ├─ genie.js ............. Bernard recommendations
  ├─ theme.js ............. palette/typography (WCAG)
  ├─ remediate.js ......... source remediation
  └─ template-embed.js .... base64 templates (Vercel file-tracing workaround)
        │
        ▼
GitHub repo = datastore (Git Data API)
  └─ classes/<slug>/ ...... published classes (auto-commit → triggers redeploy)

External: Tavily (primary search) + OpenAI web_search_preview (fallback);
          Anthropic/OpenAI/Gemini/xAI for generation.
```

The defining problem of the current architecture is that **`generate.js` does everything** — research, knowledge assembly, rendering, QA, scoring, gating, and publishing are one 3,800-line file. That is why bugs have been hard to isolate and fixes have felt like whack-a-mole.

### 2.2 Target architecture (north star)

A clean three-layer seam — **research-engine → knowledge-core → renderers** — so that every output format is just a renderer over one verified knowledge artifact. This is the architecture in `DESIGN-knowledge-core-research-engine.md`, made real.

```
                ┌─────────────────────────────────────────────┐
                │              RESEARCH ENGINE                 │
                │  resilient discovery cascade (Tavily →       │
                │  web_search), source fetch + verification,   │
                │  scoring (coverage/authority/recency).       │
                │  Output: a set of verified, tiered sources.  │
                └───────────────────────┬─────────────────────┘
                                         ▼
                ┌─────────────────────────────────────────────┐
                │              KNOWLEDGE CORE                  │
                │  the single verified artifact: claims +      │
                │  evidence map + objectives + blueprint,      │
                │  resolved and SEALED with the human.         │
                │  Format-agnostic. Cached. Re-renderable.     │
                └───────────────────────┬─────────────────────┘
                                         ▼
        ┌────────────┬────────────┬─────────────┬──────────────┐
        ▼            ▼            ▼             ▼              ▼
   slide deck   study guide   syllabus      B2B doc     conversational
   (built)      (roadmap)     import         (roadmap)   teach-me (roadmap)
                              (roadmap)
```

Why it matters: the slide deck, the future audible study-guide, the conversational "teach-me" layer, and B2B formatting are **all renderers on the same sealed core.** Build the core once, verified; add renderers cheaply. This also makes the never-dead-end guarantee enforceable at the seam (the core is either sealed or it routes to a human decision — rendering never starts on an unsealed core).

### 2.3 Core data contracts

- **Brief (`brief.template.json`)** — the one input contract for a class: `meta`, `class_tier`, `knowledge_base{research{owner,mode,seed_prompts,allow_web,recency_floor}, credibility{min_tier}}`, `objectives`, `mastery{target_level,granularity,deep_dive_density,field_disagreement}`, `audience{average,floor,gender_mix,tone,accessibility.reading_grade_cap}`, `length{minutes,slide_budget,interaction_budget}`, `language{primary,localize_ui_strings,glossary_in_primary}`. The curriculum chain produces briefs from a manifest: `curriculum setup → normalizeSetup (whitelist) → manifest.setup → briefForClass → brief`.
- **Knowledge core (target)** — the sealed artifact the renderers consume: verified sources (tiered), evidence map, objectives, course blueprint, quality/standard snapshot, seal metadata (`by:human`, `at`). Today this is implicit inside `generate.js`; Sprint 4 extracts it as a first-class artifact.
- **Manifest (curriculum)** — `slug`, `classes[]` (slug/order/title/status), and `setup` (normalized shared config). GitHub-persisted.

---

## 3. Repository map (current)

| Path | ~Lines | Responsibility |
|---|---|---|
| `api/generate.js` | ~3845 | Monolith: discovery, blueprint, slides, deep dives, QA, quality scoring, gate (`resolveQaOutcome`), publish, cost ledger. Exports `_internal` used by other handlers. |
| `api/knowledge-base.js` | ~248 | Interactive KB resolve/seal. Modes `review`/`rounds`/`seal`. Delegates discovery to `generate._internal` + `kb-rounds.js`. |
| `api/kb-rounds.js` | — | `runKnowledgeBaseRound`, `buildCompositionLedger`. |
| `api/kb-objectives.js` | — | `buildObjectiveSaturation`. |
| `api/kb-budget.js` | ~165 | KB budget math. |
| `api/curriculum.js` | ~326 | Plan + ingest a curriculum (model ladder: haiku→sonnet, 120s/90s timeouts). |
| `api/curriculum-build.js` | ~333 | `briefForClass(manifest, slug, template)`; build order; brief-by-slug GET. |
| `api/curriculum-store.js` | ~435 | `normalizeSetup` (whitelist), manifest shape, `SETUP_*` constants. |
| `api/curriculum-coherence.js` | — | Cross-class coherence checks. |
| `api/curriculum-bibliography.js` | — | Curriculum-level bibliography. |
| `api/llm.js` | ~337 | Multi-provider: `completeText`/`completeJson`; model ladder; per-model AbortController. |
| `api/genie.js` | ~231 | Bernard recommendations. |
| `api/theme.js` | ~319 | 11 palettes, WCAG contrast. |
| `api/remediate.js` | ~105 | Source remediation. |
| `api/template-embed.js` | — | Base64-embedded templates (Vercel file-tracing fix). |
| `create.html` | ~127 | Single-class shell; loads `wizard.js`. |
| `wizard.js` | ~1321 | 8-step wizard state machine. |
| `wizard-enhance.js` | — | Wizard enhancements. |
| `curriculum.html` | ~966 | Curriculum planner + review canvas (inline script). Reordered to demographics→subject→size/length/delivery. |
| `styles.css` | ~1943 | App-shell, hero-band, workspace, step-rail, genie-panel, brief-drawer. |
| `index.html` | — | Landing/entry. |
| `vercel.json` | — | `maxDuration`: generate 300, curriculum 300, knowledge-base 120, remediate 120; `includeFiles: template/**`. |
| `brief.template.json` | — | The brief contract. |
| `test/*.test.js`, `test/harness.js` | — | Suite (run all; see Section 6). |

---

## 4. Target scaffolding (post-refactor)

The destination Sprints 3–4 migrate toward. Serverless handlers become thin; the engine becomes a pure, tested library organized along the research-engine → knowledge-core → renderer seam.

```
masterclass-factory/
├─ CLAUDE.md                      # operating rules (Section 5)
├─ ENGINEERING-BUILD-PLAN.md      # this file
├─ ARCHITECTURE.md                # generated in Sprint 0
├─ BUGS.md                        # known-issue register
├─ ROADMAP.md                     # renderer/feature backlog
├─ vercel.json
├─ package.json
├─ brief.template.json
├─ public/                        # static frontend
│  ├─ index.html
│  ├─ create.html
│  ├─ curriculum.html
│  ├─ css/  (shell.css = shared app-shell tokens + layout, styles.css)
│  └─ js/   (shell.js, wizard.js, wizard-enhance.js, curriculum.js)
├─ api/                           # THIN serverless entrypoints only
│  ├─ generate.js                 # orchestrator: core → renderer → publish
│  ├─ knowledge-base.js
│  ├─ curriculum*.js
│  ├─ genie.js  theme.js  remediate.js
│  └─ auth/        (Sprint 8)
├─ lib/                           # the engine: pure, tested, no HTTP
│  ├─ core/
│  │  ├─ research-engine.js       # resilient discovery cascade + retry/degrade
│  │  ├─ source-verify.js         # fetch + reachability (403-bot-block = reachable)
│  │  ├─ scoring.js               # coverage/authority/recency
│  │  ├─ standard.js              # tier floors / class standards
│  │  └─ knowledge-core.js        # assemble + seal the verified artifact
│  ├─ renderers/
│  │  ├─ slides.js                # interactive deck
│  │  ├─ deepdive.js
│  │  ├─ blueprint.js
│  │  ├─ assessment.js
│  │  └─ (roadmap) study-guide.js, syllabus-import.js, b2b.js
│  ├─ quality/
│  │  ├─ qa.js                    # structural QA (shapes, citations, globals)
│  │  └─ quality.js               # rubric scoring + resolveQaOutcome gate
│  ├─ providers/llm.js            # multi-provider
│  ├─ publish/github.js           # datastore publish (Git Data API)
│  ├─ cost.js
│  └─ util/
├─ test/
│  ├─ unit/                       # one file per lib module
│  ├─ golden/                     # golden-output fixtures (refactor safety net)
│  ├─ e2e/                        # full-flow with stubbed externals
│  └─ smoke.js                    # hits every endpoint locally
└─ scripts/
```

---

## 5. Engineering conventions (condensed `CLAUDE.md`)

Put this at the repo root as `CLAUDE.md`:

```text
# CLAUDE.md — Operating rules for Masterclass Factory

Commercial AI course-generation platform (persona "Bernard"). Read before doing anything.

## Stack & invariants
- Frontend: vanilla HTML/CSS/JS. Single-class: create.html + wizard.js. Curriculum: curriculum.html.
- Backend: Node CommonJS serverless in api/. NO database — GitHub IS the datastore; classes
  auto-publish to classes/<slug>/ via the GitHub Git Data API. Do NOT break publish/rebase.
- LLM: Anthropic default; OpenAI/Gemini/xAI via llm.js. Search: Tavily (primary, CONFIRMED
  configured: keyUsable:true, model "tavily-search") + OpenAI web_search_preview (fallback).
- Deploy: Vercel (team areos, project prj_FYgOb1eF3jbDr0wCkrVkw3oCOii5). Respect vercel.json maxDuration.
- Architecture target: research-engine -> knowledge-core -> renderers. Renderers never run on an unsealed core.

## Non-negotiable rules
1. Engine-first: deterministic backend + tests before UI. State what is verified vs. needs a live read.
2. Test gate before EVERY commit: node --check on changed files AND the full suite green.
3. Never dead-end a job. Auto-resolve; escalate to the human only in extreme cases, with actionable options.
4. Surface failures, never swallow them. No silent catch. Failures auto-recover or show a visible, actionable state.
5. Small, reviewable diffs. Show the diff and test output before committing; pause for review.
6. Behavior-preserving refactors are gated by a golden-output test (capture before, assert identical after).
7. CommonJS only in api/. Never rename frontend element ids (collection reads by getElementById).

## Build plan
The sprint plan is ENGINEERING-BUILD-PLAN.md. Work ONE sprint at a time; don't start the next
until the prior sprint's acceptance criteria and tests are green and committed.
```

**Push/verify workflow (Windows/PowerShell):** decode/copy any delivered file as step one → verify a marker with `Select-String` → `node --check` → run the full suite → `git add/commit` (must report "N files changed") → `git pull --rebase origin main` → `git push`. Intervening auto-published class commits are normal; rebase resolves them.

---

## 6. Testing strategy

- **Full suite command (the gate):**
  ```
  node test/harness.js && node test/kb-rounds.test.js && node test/kb-objectives.test.js && node test/kb-budget.test.js && node test/theme.test.js && node test/curriculum.test.js && node test/curriculum-store.test.js && node test/curriculum-build.test.js
  ```
  New behavior ships with a new test. Green before every commit, no exceptions.
- **Unit tests** per `lib/` module after the refactor (`test/unit/`).
- **Golden-output tests** (`test/golden/`): with a fixed brief and fully stubbed LLM/search/GitHub, capture the complete pipeline output and assert it is byte-identical after refactors. This is the safety net for Sprint 3–4.
- **E2E tests** (`test/e2e/`): full flow with stubbed externals — plan→save→coherence→build→publish for curriculum, and create→build→publish for single-class.
- **Smoke harness** (`scripts/smoke.js`): invokes every endpoint with a realistic mock request; prints `{endpoint, ok, status, ms}`.
- **Client verification:** jsdom (`runScripts:"dangerously"`, stub `window.fetch`) on the deployed HTML to walk wizard/curriculum flows and assert no thrown errors and full field collection.

---

## 7. Environments, deployment & ops runbook

- **Vercel:** team `areos`, projectId `prj_FYgOb1eF3jbDr0wCkrVkw3oCOii5`, prod `masterclass-factory-architecture-co.vercel.app` (alias `class-creator-prototype.vercel.app`).
- **Datastore:** GitHub repo; classes auto-commit under `classes/<slug>/`, which triggers a redeploy (expect intervening SHAs).
- **Env vars (confirmed):** `TAVILY_API_KEY` present and usable; `ANTHROPIC_API_KEY` (default provider); `OPENAI_API_KEY`; GitHub publish token. Audit `GEMINI_API_KEY`/`XAI_API_KEY` if those providers are exercised.
- **Diagnostics (Vercel MCP):** `get_runtime_errors` first (pre-aggregated, never times out) → `get_runtime_logs` with `group_by:requestPath`/`statusCode` to see what hit the server → targeted `query` for markers. Log retention here is ~1 day, so reproduce live to get fresh logs.
- **Key log marker:** `KBDIAG {...}` on `/api/generate` and `/api/knowledge-base` reports discovery health: `keyUsable`, `model` (`tavily-search` = Tavily path), `added`, `rejected`, `resolution`. Use it to distinguish a transient abort from a real discovery problem.
- **maxDuration ceilings:** generate 300s, curriculum 300s, knowledge-base 120s, remediate 120s. Keep per-provider timeouts comfortably inside these.

---

## 8. Known-issue register (status as of this plan)

| # | Issue | Status |
|---|---|---|
| B1 | KB discovery **intermittently** aborts ("This operation was aborted") and the round collapses to 15/100 (coverage 0, authority 0). **Confirmed** via `KBDIAG`: Tavily is configured (`keyUsable:true`, `model:"tavily-search"`) and a healthy round finds 13 sources / scores 87. Root cause = transient-abort handling, not a missing key or weak discovery. | **OPEN → Sprint 1** |
| B2 | Quality gate dead-ended ≥70 classes when slide count ≠ requested budget, with a contradictory "below the 70 bar" message. | **FIXED & verified live** (commit `14af831`; a 0.5-density build published at quality 91). Verify it stays fixed in the refactor. |
| B3 | Build slow (~215s for 68 slides); `slide_budget = minutes × density` bloats decks; ~sequential slide gen (~3s/slide). | **PARTIAL** (default density 1.5→0.8; still ~2 min). **Sprint 2.** |
| B4 | Requesting fewer slides than the tier floor causes a count mismatch that drags the score. | **De-fanged** (now non-blocking via B2). Reconcile in Sprint 2. |
| B5 | Two tabs share no shell; single-class wizard not reordered to demographics-first. Curriculum tab reordered (`285d740`). | **OPEN → Sprint 5** |
| B6 | Remediation "Accept / Not now" panel renders behind the tracker overlay. | **OPEN → Sprint 6** |
| B7 | Single-class `brief.template.json` `slide_budget` default 90 → slow single-class builds. | **OPEN → Sprint 2** |
| B8 | `generate.js` is a ~3.8k-line monolith. | **OPEN → Sprints 3–4** |
| B9 | Silent client failures (dead buttons); partially hardened in `curriculum.html`. | **OPEN → Sprint 6** |
| B10 | No auth, rate limiting, or cost cap on a paid product. | **OPEN → Sprint 8** |
| B11 | `DEP0169 url.parse()` deprecation on `/api/curriculum-build`. | **OPEN (minor) → Sprint 0/7 cleanup** |

---

## 9. The sprint plan (master list)

Five phases. Each sprint: **Goal / Scope / Acceptance / Claude Code prompt.** Prompts assume `CLAUDE.md` is present.

### Phase A — Stabilize & understand

#### Sprint 0 — Baseline, audit & safety net
**Goal:** Know exactly what works/breaks; lock a green baseline; add observability. No behavior change.
**Scope:** whole repo (audit + tooling). **Acceptance:** suite green from clean checkout; `scripts/smoke.js` runs; `ARCHITECTURE.md`, `BUGS.md` (seed from Section 8), `CLAUDE.md` exist; env-var audit documented.

```text
CLAUDE CODE — SPRINT 0: BASELINE & AUDIT
Audit only — change NO runtime behavior.
1. Read every file in api/ and test/. Write ARCHITECTURE.md: one paragraph per module (purpose, exports, external calls: LLM/Tavily/GitHub/fs).
2. Run the full test suite; record the exact command + result in ARCHITECTURE.md. Fix only test-runner breakage, not product behavior.
3. Build scripts/smoke.js: import each api handler, invoke with a realistic mock request (stub fetch + GitHub writes), print {endpoint, ok, status, ms}.
4. Create BUGS.md seeded with the known-issue register from ENGINEERING-BUILD-PLAN.md Section 8, each as a checkbox with file:line references you confirm by reading the code.
5. Confirm CLAUDE.md exists at the repo root (create from Section 5 if missing).
6. Env-var audit: grep process.env.* across api/; list every key, where read, and the failure mode if missing. Flag any key whose absence silently degrades the product.
Deliverables: ARCHITECTURE.md, BUGS.md, scripts/smoke.js. Print smoke output + test result. Do not commit until I review the diff.
```

#### Sprint 1 — Knowledge-base resilience (kill the transient 15%)
**Goal:** A transient discovery abort retries, keeps partial results, and never zeroes a round.
**Scope:** discovery in `generate.js` (`tavilySearch`, the `web_search_preview` calls, `findSourceCandidates`, `discoverKnowledgeBaseSources`, `normalizeDiscoveredSources`), `knowledge-base.js`, `kb-rounds.js`.
**Acceptance:** 5 varied subjects each return ≥ floor sources, score >70, within budget, zero unhandled aborts; the zero-candidate path returns a graceful, explained checkpoint, never a bare 15.

```text
CLAUDE CODE — SPRINT 1: KB RESILIENCE
Bug B1: KB discovery INTERMITTENTLY aborts ("This operation was aborted") and the round collapses to 15/100 (coverage 0, authority 0). CONFIRMED via production KBDIAG: TAVILY_API_KEY is set and usable (keyUsable:true, model:"tavily-search"); a healthy round finds 13 sources and scores 87. This is NOT a missing key and NOT a discovery-quality problem — it is transient-abort handling. Do not touch key configuration.
1. Wrap EVERY external search/fetch (tavilySearch, both web_search_preview calls, source fetches) so a timeout/abort/network error/403 returns a typed empty-or-partial result and NEVER throws to the round. Log each with a KBDIAG marker.
2. Add bounded retry-with-backoff (1 retry) per provider on transient failure (abort/timeout/5xx).
3. Run providers as a graceful cascade (Tavily first, then web_search_preview), accumulating candidates with Promise.allSettled where independent. A partial result is success. Treat bot-blocked 403s from legitimate publishers as reachable.
4. Give each provider a time budget that fits inside knowledge-base.js maxDuration (120s) with margin; one slow provider must not consume the whole budget.
5. A round must score whatever candidates exist; coverage/authority must never read 0 when sources are present.
6. If after all providers candidates are still zero, return a graceful checkpoint (status "evidence-limited") with actionable options: run another round, add a source by hand, or accept-and-seal evidence-limited. NEVER a bare aborted/15.
Tests in test/kb-rounds.test.js: (a) provider timeout degrades instead of throwing; (b) retry fires once then degrades; (c) zero-candidate path returns the evidence-limited checkpoint; (d) a normal candidate set scores >70. Verify with scripts/smoke.js on 5 subjects; print KBDIAG. Diff before commit.
```

#### Sprint 2 — Build performance & never-dead-end generation
**Goal:** A standard class builds fast enough to demo; `generate` never returns `ok:false` without an actionable resolution.
**Scope:** `generate.js` slide/deep-dive loop, `slide_budget` derivation, the gate (verify B2), progress reporting; `curriculum-build.js`; `brief.template.json` (B7).
**Acceptance:** standard ~40-slide class builds in a documented target (aim <~90s) via bounded concurrency; `slide_budget` clamped to `[floor, ceiling]`; B2 confirmed (slide-count = recommendation; headline truthful); no silent `ok:false`; single-class default `slide_budget` lowered.

```text
CLAUDE CODE — SPRINT 2: BUILD PERFORMANCE & NEVER-DEAD-END
Bugs B3, B4, B7; verify B2.
1. Profile a real build via scripts/smoke.js; record where the time goes (slide + deep-dive gen is the suspect, ~3s/slide sequential).
2. Parallelize slide and deep-dive generation with BOUNDED concurrency (pool of 4–6), preserving output order. Stay inside vercel.json generate maxDuration (300s) with margin. No unbounded parallel LLM calls.
3. Clamp slide_budget to [tier.slide_floor, a sane ceiling]; stop deriving runaway counts from minutes × density. Map the planning-form density into this clamp in curriculum-build.js.
4. Lower brief.template.json length.slide_budget default (currently 90) to match the clamp.
5. VERIFY B2: in qualityAudit, slide_budget<100 pushes to recommendations (not issues); ok = issues.length===0 && overall>=70; resolveQaOutcome headline is truthful for >=70. Add a test asserting a 92/100 class with a slide-count delta routes to "pass" and publishes.
6. Audit every return path of the generate handler: none may return ok:false without a resolution object carrying actionable options. Add bounded auto-retry for transient stage failures before any escalation.
7. Report incremental progress (stage + slide N of M).
Tests: concurrency order preserved; slide_budget clamp; the 92/100 pass case; no-bare-failure invariant. Print before/after timings. Diff before commit.
```

### Phase B — Restructure for maintainability

#### Sprint 3 — Decompose the `generate.js` monolith (behavior-preserving)
**Goal:** Make the engine maintainable; bugs become isolatable and testable.
**Scope:** `generate.js` → modules under `lib/`; behavior byte-identical (golden test).
**Acceptance:** `generate.js` is a thin orchestrator (<~400 lines); modules `lib/cost.js`, `lib/core/research-engine.js`, `lib/renderers/{blueprint,slides,deepdive,assessment}.js`, `lib/quality/{qa,quality}.js`, `lib/publish/github.js`, each unit-tested; golden output identical pre/post.

```text
CLAUDE CODE — SPRINT 3: DECOMPOSE generate.js (BEHAVIOR-PRESERVING)
Bug B8. Make it maintainable WITHOUT changing behavior.
1. First write a golden-output test: fixed brief + fully STUBBED LLM/search/GitHub (deterministic canned responses); capture full generate() output to test/golden/class.json. This is the safety net.
2. Extract cohesive modules into lib/, ONE at a time, running the golden test after each: lib/cost.js; lib/core/research-engine.js (tavilySearch, web_search_preview, discover*, normalizeDiscoveredSources, assessSourceScarcity, buildChangeOrder); lib/renderers/blueprint.js; lib/renderers/slides.js; lib/renderers/deepdive.js; lib/renderers/assessment.js; lib/quality/qa.js; lib/quality/quality.js (qualityAudit + resolveQaOutcome); lib/publish/github.js.
3. generate.js becomes an orchestrator wiring these together; keep the handler signature and response shape unchanged.
4. Give each module a focused unit test in test/unit/. Wire into the suite command.
5. The golden test MUST pass identically at the end. If output differs, the refactor changed behavior — find and revert the difference.
Small commits, one module each, golden green every time. Show diffs before each commit.
```

#### Sprint 4 — Formalize the research-engine → knowledge-core → renderer seam
**Goal:** Make the knowledge core a first-class, sealed artifact that renderers consume; renderers never run on an unsealed core.
**Scope:** `lib/core/knowledge-core.js` (assemble + seal), the renderer interface, the orchestrator.
**Acceptance:** the orchestrator produces a sealed knowledge-core artifact, then invokes a renderer over it; a renderer called on an unsealed core routes to a human decision (never proceeds); slide deck output unchanged (golden test); the seam is documented in `ARCHITECTURE.md`.

```text
CLAUDE CODE — SPRINT 4: KNOWLEDGE-CORE SEAM
Depends on Sprint 3 modules. Implement the architecture in ENGINEERING-BUILD-PLAN.md Section 2.2.
1. Define lib/core/knowledge-core.js: assemble a format-agnostic, verified artifact (tiered sources, evidence map, objectives, blueprint, quality/standard snapshot, seal metadata) from the research-engine output. Expose seal(core, humanDecision) and isSealed(core).
2. Define a renderer interface: render(core, brief) -> output. Refactor lib/renderers/slides.js (+ deepdive/blueprint/assessment) to consume the sealed core instead of reaching into raw discovery.
3. Enforce the invariant: the orchestrator MUST NOT invoke any renderer on an unsealed core. An unsealed core routes to the existing knowledge-base resolve/seal decision (never-dead-end).
4. Keep the slide-deck output byte-identical (golden test from Sprint 3 must still pass).
5. Update ARCHITECTURE.md with the seam and the core artifact shape.
Add unit tests: seal/isSealed; renderer-on-unsealed-core routes to decision; core assembled from a stubbed research-engine matches a fixture. Diff before commit.
```

### Phase C — Unify the product surface

#### Sprint 5 — Unify the two tabs (shell + flow order)
**Goal:** `create.html` and `curriculum.html` share one shell and the same order: demographics → subject/topic → size/length/delivery.
**Scope:** extract shared shell from `styles.css`/`create.html`; reorder `wizard.js` steps; apply shell to `curriculum.html`.
**Acceptance:** both tabs render the identical shell; single-class step order matches curriculum; all wizard steps function (jsdom); no save/build regressions; ids unchanged.

```text
CLAUDE CODE — SPRINT 5: UNIFY THE TWO TABS
Bug B5. create.html uses a 3-zone app-shell (hero-band + workspace with step-rail + Bernard genie-panel + live-output drawer) from styles.css. curriculum.html (already reordered to demographics->subject/topic->size/length/delivery) is plainer.
1. Extract the app-shell markup + relevant styles.css classes (app-shell, hero-band, workspace, step-rail, creator-panel, side-stack, genie-panel, brief-drawer) into a reusable shell both pages share (css/shell.css, js/shell.js). No CSS duplication.
2. Apply the shell to curriculum.html so it reads as the same product as create.html.
3. Reorder the wizard.js step state-machine to: demographics -> create(subject/title/tier) -> length/delivery -> knowledge base -> mastery -> objectives -> review. Reorder step definitions only; do not rewrite step logic; Review stays last.
4. VERIFY with jsdom on the deployed-equivalent HTML: load each page, walk every step, assert no thrown errors and that the brief/manifest still collects every field by id. Single-class save/build must still work.
Constraint: moving inputs is safe ONLY if ids are preserved (collection reads by getElementById). Do not rename ids. Do not touch backend. Print the jsdom walk-through. Diff before commit.
```

#### Sprint 6 — Escalation/remediation UX & error surfacing
**Goal:** Every Bernard decision panel renders correctly, above overlays, and is actionable; no silent client failures.
**Scope:** overlay z-index (B6); the panels for `quality_decision`/`structural_block`/`evidence-limited`/`advancement_opportunity`; a global client error surface (B9).
**Acceptance:** the remediation panel renders in front of the tracker and is clickable; each resolution kind renders an actionable panel wired to its token; a global error handler surfaces any uncaught error as a visible, actionable state.

```text
CLAUDE CODE — SPRINT 6: ESCALATION UX & OVERLAYS
Bugs B6, B9.
1. Fix the stacking bug: the remediation "proposed sources — Accept / Not now" panel renders behind the full-screen tracker overlay. Establish a clear stacking order (overlay < decision panel < modal) via CSS variables, not ad-hoc z-index. Verify visible AND clickable while the tracker is up.
2. Audit every server resolution kind the client can receive (quality_decision, structural_block, evidence-limited/source-scarcity, advancement_opportunity); ensure each renders a panel whose options are wired to the correct resolution token sent back to the server.
3. Add a global client error surface (window.onerror + unhandledrejection) that renders a visible, plain-language failure state with retry / ask-Bernard. No catch may swallow an error silently.
4. Verify with jsdom: simulate each resolution kind in the response; assert the matching panel renders, is on top, and its action posts the right token.
Print the jsdom assertions. Diff before commit.
```

### Phase D — Harden & scale

#### Sprint 7 — Provider resilience & end-to-end tests
**Goal:** Multi-provider fallback is real and proven; full-flow e2e coverage; idempotent publish.
**Scope:** `lib/providers/llm.js` fallback; `test/e2e/`; GitHub publish rebase-safety.
**Acceptance:** `llm.js` fallback tested for model-not-found/timeout/429 across providers; e2e green for single-class and curriculum; publish handles an intervening auto-commit without clobbering.

```text
CLAUDE CODE — SPRINT 7: PROVIDER RESILIENCE & E2E
1. Test llm.js completeText/completeJson fallback: stub each provider to fail with (a) model-not-found, (b) timeout/abort, (c) 429, and assert the ladder advances and ultimately returns a usable result or a clean explained failure (never a throw to the caller).
2. Build test/e2e/flow.test.js with stubbed LLM/search/GitHub: curriculum plan->save->coherence->build one class->publish; and single-class create->build->publish. Assert ok:true and a class_url at the end of each.
3. Make publish idempotent/rebase-safe: simulate an intervening auto-commit between read and write to the GitHub datastore; assert publish retries/rebases instead of failing or clobbering.
4. Wire e2e into the suite command. Also clear the DEP0169 url.parse() warning on /api/curriculum-build (use WHATWG URL).
Print the e2e run. Diff before commit.
```

#### Sprint 8 — Commercial hardening
**Goal:** Safe to charge money and run unattended: auth, rate limiting, cost caps, telemetry.
**Scope:** `api/auth/`, rate limiting, LLM/search spend caps (cost ledger exists), input validation, telemetry.
**Acceptance:** expensive endpoints gated behind auth; per-user/IP rate limiting; a per-build and per-user spend cap that halts before overspend with an actionable message; spend visible per build; telemetry wired; secrets server-side only; `ROADMAP.md` written.

```text
CLAUDE CODE — SPRINT 8: COMMERCIAL HARDENING
Bug B10 + launch readiness. Paid LLM + Tavily APIs with no protection today.
1. Add an auth gate (signed session or provider auth) so generate, knowledge-base, curriculum, curriculum-build cannot be called anonymously. Keep it standard; document setup.
2. Per-user/IP rate limiting on those endpoints with clear 429 messaging.
3. Surface and enforce cost: the cost ledger already tracks Tavily/OpenAI spend. Return per-build spend; enforce configurable per-build and per-user ceilings that HALT before overspend with a plain message + actionable option (raise cap / proceed). Never dead-end.
4. Validate and bound all user input (subject length, source counts, slide budget, seed prompts) to prevent abuse and runaway cost.
5. Wire server + client error reporting/telemetry so production failures are observable without reading raw logs.
6. Review secrets: no keys in client code; all keys server-side env only.
7. Write ROADMAP.md: prioritized renderer/feature backlog (syllabus drop-in, conversational teach-me, audible study-guide, B2B formatting, consulting assistant, feedback button).
Document any new env vars in CLAUDE.md. Diff before commit.
```

### Phase E — Extend (renderers on the knowledge core)

These depend on the Sprint 4 seam. Each is a renderer over the sealed core; none re-litigates research.

#### Sprint 9 — Syllabus / reading drop-in import
**Goal:** Import an existing syllabus or reading list and build a knowledge core from it (extract, don't invent).
**Acceptance:** a pasted/uploaded syllabus yields a sealed core whose claims trace to the provided material; flows into the same renderers.

```text
CLAUDE CODE — SPRINT 9: SYLLABUS / READING IMPORT RENDERER PATH
Depends on Sprint 4. Build lib/renderers/syllabus-import.js feeding the knowledge core.
1. Accept pasted text and uploaded .txt/.md (PDF/Word = "coming soon" if not trivial). Extract structure (modules/objectives) WITHOUT inventing; preserve the user's order.
2. Produce a knowledge core whose claims trace to the provided material; mark provenance "imported".
3. Route the imported core through the existing seal step (human confirms) then the slide renderer — no separate build path.
Tests: extraction is faithful (no invented modules); imported core seals and renders. Diff before commit.
```

#### Sprint 10 — Conversational "teach-me" renderer
**Goal:** A chat layer that teaches from the sealed core (grounded answers, cites the core's sources).
**Acceptance:** answers are grounded in the sealed core; out-of-scope questions are handled honestly (never fabricated); no re-research mid-chat without human consent.

```text
CLAUDE CODE — SPRINT 10: CONVERSATIONAL TEACH-ME RENDERER
Depends on Sprint 4. Build lib/renderers/teach-me.js + a chat surface.
1. Answer strictly from the sealed knowledge core; every claim cites a core source.
2. Out-of-scope or unsupported questions: say so honestly and offer to open a research round (human-consented), never fabricate.
3. No mid-chat re-research without explicit human consent (preserve the seal contract).
Tests: grounded answer cites a real core source; out-of-scope is declined honestly; no silent re-research. Diff before commit.
```

#### Sprint 11 — Audible study-guide renderer
**Goal:** Render the sealed core as an audio-friendly study guide (narration script + segments).
**Acceptance:** script derives from the core; segments map to objectives; no content beyond the core.

```text
CLAUDE CODE — SPRINT 11: AUDIBLE STUDY-GUIDE RENDERER
Depends on Sprint 4. Build lib/renderers/study-guide.js.
1. Produce an audio-friendly narration script + segment list from the sealed core; segments map to objectives.
2. No content beyond the core; cite sources in a companion transcript.
Tests: every segment traces to a core objective; no out-of-core claims. Diff before commit.
```

#### Sprint 12 — B2B deliverable formatting / consulting assistant
**Goal:** Render the sealed core into branded B2B deliverables (report/one-pager/deck) and a just-in-time consulting assistant.
**Acceptance:** deliverables derive from the core; formatting/brand configurable; assistant answers from the core.

```text
CLAUDE CODE — SPRINT 12: B2B FORMATTING / CONSULTING RENDERER
Depends on Sprint 4. Build lib/renderers/b2b.js.
1. Render the sealed core into configurable branded deliverables (report, one-pager, exec deck).
2. A consulting-assistant mode answers from the core with citations; same grounding contract as teach-me.
Tests: deliverable content traces to the core; brand config applies; assistant cites core sources. Diff before commit.
```

---

## 10. Sprint sequencing & gates

- **Hard order:** 0 → 1 → 2 establishes a reliable, demoable product. **3 → 4** is the architectural backbone and must precede Phase E. **5 → 6** makes it look/feel like one product. **7 → 8** makes it sellable. **9–12** are independent renderers, prioritizable by business value once the Sprint 4 seam exists.
- **Gate between every sprint:** acceptance criteria met, full suite green, committed, Vercel deploy `READY`. Do not start the next sprint otherwise.
- **Refactor gate (Sprints 3–4):** the golden-output test must pass identically; any diff means behavior changed.

---

## 11. Appendix — quick reference

- **Full test gate:** `node test/harness.js && node test/kb-rounds.test.js && node test/kb-objectives.test.js && node test/kb-budget.test.js && node test/theme.test.js && node test/curriculum.test.js && node test/curriculum-store.test.js && node test/curriculum-build.test.js`
- **Vercel:** team `areos`; projectId `prj_FYgOb1eF3jbDr0wCkrVkw3oCOii5`; prod `masterclass-factory-architecture-co.vercel.app`.
- **Diagnostics order:** `get_runtime_errors` → `get_runtime_logs` (group_by requestPath/statusCode) → targeted `query` (`KBDIAG`, `abort`). Log retention ~1 day → reproduce live for fresh logs.
- **KBDIAG fields:** `keyUsable`, `model` (`tavily-search` = Tavily active), `added`, `rejected`, `resolution`.
- **maxDuration:** generate 300, curriculum 300, knowledge-base 120, remediate 120.
- **Confirmed-good HEAD at plan time:** `14af831` (quality-gate fix live; reorder live; KB Tavily confirmed).
- **Brief is the one contract.** Curriculum chain: `setup → normalizeSetup (whitelist) → manifest.setup → briefForClass → brief`. New shared fields MUST be added to `normalizeSetup` or they're stripped.
- **Never `Math.max(current, recommended)`** in recommendation normalization — it floors Bernard's output to the user's input.
