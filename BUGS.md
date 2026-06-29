# BUGS.md — Known-issue register

Seeded from `ENGINEERING-BUILD-PLAN.md` §8 and confirmed against the code in Sprint 0. Each
item is a checkbox with `file:line` references **verified by reading the source** (line numbers
as of this commit). `[ ]` = open, `[x]` = fixed-and-verified. B12–B15 are **new findings from
the Sprint 0 audit**. No code was changed in Sprint 0.

---

## Carried from ENGINEERING-BUILD-PLAN.md §8

- [x] **B1 — KB discovery intermittently aborts → round collapses to 15/100 (coverage 0,
  authority 0).** **FIXED in Sprint 1.** A transient discovery abort/timeout/5xx is now retried
  once, then degrades to a typed empty-or-partial result that NEVER throws to the round — so a
  provider hiccup can no longer zero a score, and a genuine zero surfaces as an actionable
  evidence-limited checkpoint (never a bare 15). Changes:
  - `tavilySearch` → typed `tavilySearchOnce` + 1 retry on transient (5xx/429/abort), each
    outcome logged with a `KBDIAG {stage:"tavily"}` marker (`api/generate.js`).
  - The OpenAI web-search cascade is wrapped in `openAIWebSearchSafe` — 1 retry then degrade to
    a typed empty result; it no longer throws into discovery (`api/generate.js`).
  - `fetchUrlText` → typed `fetchUrlTextOnce` with a `transient` flag + 1 retry; 5xx and
    aborts are transient (left retryable, not blacklisted), 404/410 + SSRF stay hard rejects.
  - `findSourceCandidates` runs the Tavily queries with `Promise.allSettled` (one query failing
    can't discard the others) and falls through to the safe OpenAI cascade.
  - `discoverKnowledgeBaseSources` verifies with `Promise.allSettled` (partial results survive),
    leaves transient fetch failures retryable, enforces a `DISCOVERY_TIME_BUDGET_MS` (100s, inside
    the 120s maxDuration), and emits a consolidated `KBDIAG {stage:"discovery_complete"}`.
  - `kb-rounds.js` `runKnowledgeBaseRound`: 1 retry on a transient `findSourceCandidates` failure,
    `Promise.allSettled` verification, a `degraded` flag (a degraded round recommends *continue*,
    not a structural *stop*), and a checkpoint `status:"evidence_limited"` + always-present
    actionable `options` (search_again / add_sources / proceed_anyway) when no sources exist.
  - **Verified:** `test/kb-rounds.test.js` adds (a) transient timeout degrades not throws,
    (b) retry fires once then degrades, (b2) retry recovers, (b3) non-transient does not retry,
    (c) zero-candidate → evidence_limited checkpoint with options, (d) a normal set scores >70
    with non-zero coverage/authority (37/37 green). `scripts/smoke.js` runs 5 subjects through KB
    review: 4 score 90 (floor met), 1 transient-outage subject degrades to an actionable
    `knowledge_base_review` (5 options), KBDIAG printed throughout.

- [x] **B2 — Quality gate dead-ended ≥70 classes on slide-count mismatch with a contradictory
  "below the 70 bar" message.** Fixed & verified live (commit `14af831`). **Confirmed still
  fixed in code:** slide-count delta is pushed to `recommendations`, never `issues`
  (`api/generate.js:3215`); `ok = issues.length === 0 && overall >= 70`
  (`api/generate.js:3244`); the contradictory headline is resolved in `resolveQaOutcome`
  (`api/generate.js:3097-3099`). **VERIFIED in Sprint 2:** `test/harness.js` adds
  "a 92/100 class with a slide-count delta routes to PASS, not needs_decision" (and a companion
  asserting a structural issue still blocks at a high score, so the gate isn't weakened).

- [x] **B3 — Build slow; `slide_budget = minutes × density` bloats decks; ~sequential slide
  gen.** **FIXED in Sprint 2.** Authoring batches now run through a BOUNDED concurrency pool
  (`AUTHOR_CONCURRENCY = 5`) via `planAuthorBatches` + `mapWithConcurrency`, preserving slide
  order — a 48-slide deck goes from 4 sequential batches to ~1 wave of wall-clock. Profiled in
  `scripts/smoke.js` (simulated per-batch latency): **2424ms → 602ms (~4×)**, output order
  identical. No unbounded fan-out (pool capped at 5); stays well inside the 300s generate
  ceiling. The `minutes × density` runaway is bounded by the B4 clamp below.

- [x] **B4 — Requesting fewer slides than the tier floor causes a count mismatch that drags the
  score.** **FIXED in Sprint 2.** The curriculum density-derived budget is clamped to a sane band
  tied to the tier (`curriculum-build.js`: `[tier.slide_floor, floor + 20]`), so `minutes ×
  density` can no longer derive a runaway deck and a too-small derivation floors up to the tier
  minimum. (Single-class explicit budgets are still honored down to 1 by `totalSlideTarget`, which
  the harness slide-budget tests lock — the clamp lives in the curriculum density mapping, not in
  the explicit path.) De-fang from B2 remains (count delta is non-blocking).

- [ ] **B5 — Two tabs share no shell; single-class wizard not reordered to demographics-first.**
  Sprint 5. (Frontend: `create.html`/`wizard.js` vs `curriculum.html`; not re-confirmed at
  line level in this backend-focused audit.)

- [ ] **B6 — Remediation "Accept / Not now" panel renders behind the tracker overlay.** Sprint 6.
  (Frontend stacking/z-index; not line-confirmed here.)

- [x] **B7 — Single-class `brief.template.json` `slide_budget` default 90 → slow single-class
  builds.** **FIXED in Sprint 2.** `brief.template.json` `length.slide_budget` default lowered
  **90 → 60** (the professional-tier floor), so a default single-class build authors ~60 slides,
  not 90. (The independent `brief-validator.js` `DEFAULT_TEMPLATE` copy is a shape/range reference
  only and still validates either value; left untouched.)

- [ ] **B8 — `generate.js` is a ~3.8k-line monolith.** Sprints 3–4. **Confirmed:** 3845 lines,
  one handler + a large `_internal` surface (`api/generate.js:3482`, `:3796`).

- [ ] **B9 — Silent client failures (dead buttons).** Sprint 6. (Frontend; partially hardened in
  `curriculum.html`. Backend analogue: several handlers return bare `errors` arrays with no
  resolution — see B16.)

- [ ] **B10 — No auth, rate limiting, or cost cap on a paid product.** Sprint 8. **Confirmed:**
  no auth gate on `generate`/`knowledge-base`/`curriculum`/`curriculum-build`; the cost ledger
  exists (`generate.js` `_costLedger`; `kb-budget.js`) but nothing enforces a ceiling.

- [x] **B11 — `DEP0169 url.parse()` deprecation on `/api/curriculum-build`.** **Not reproducible
  in current code.** `api/curriculum-build.js` does **not** call `url.parse()` or
  `require("url")`; it reads query via `qparam` (`req.query` → manual `req.url` split, `:296-303`).
  Already WHATWG-clean. *Recommend closing B11, or re-scoping if the warning is observed live on
  a different route.*

---

## New findings (Sprint 0 audit)

- [x] **B12 — `test/harness.js` async tests are non-gating (false-pass).** **FIXED (pre-Sprint-1,
  test-infra only).** `test()`/`group()` now enqueue at definition time and a `runQueue()` drains
  them sequentially, **awaiting each test (sync or async) to full settlement** before the next and
  before `process.exit`. Output order, ok/FAIL format, and pass/fail counting are unchanged.
  Verified: the previously-hidden failure (B13) now reports correctly. *Original analysis:*
  `test(name, fn)` (`test/harness.js:22`) was **synchronous** — it called `fn()` inside try/catch but never awaited.
  Every `async () => {}` test (HTTP handlers `:318-347`, `assertFetchableUrl` rejects `:213-220`,
  the `resolveKnowledgeBase`/`detectAdvancementOpportunity` group `:684-749`, etc.) is counted
  "ok" the instant it is launched; its assertions settle as microtasks **after**
  `process.exit(0)` (`test/harness.js:762`). Async assertion failures never affect the count or
  exit code. **Impact:** the gate's `async` coverage is theater. *Fix direction (test-runner
  only): make `test` collect promises and `await Promise.allSettled(...)` before printing RESULTS
  / exiting.* **Not fixed in Sprint 0** because fixing it turns the suite RED (exposes B13),
  which is a behavior-revealing change to flag, not a runner-breakage repair.

- [x] **B13 — The brief-endpoint gate test is a masked false-pass (wrong request shape).**
  **FIXED (pre-Sprint-1, test-only).** The test now POSTs the **bare** `DEFAULT_TEMPLATE` (what a
  real HTTP client sends and what `api/brief.js:69-70` validates), matching the endpoint contract.
  **`api/brief.js` was correct and was NOT changed.** Once B12 made the runner await, this test
  reported its true `422 !== 200`; sending the bare body restores a genuine 200. *Original
  analysis:* the test POSTed a wrapped `{ brief: DEFAULT_TEMPLATE }` body, which the handler
  rejects (422); it only "passed" because of B12. **Open follow-up (product, not this pass):**
  confirm the wizard/curriculum client POSTs the bare brief to `/api/brief`, not a wrapper.

- [ ] **B14 — Two non-gate test files are broken (stale `_internal` imports).**
  `test/classify-source.test.js` (`classifySource is not a function`) and
  `test/author-plan.test.js` (`planAuthorBatches`/`fastAuthorModels` not functions) fail because
  `api/generate.js._internal` no longer exports those names (it has `classifyByHost`, not
  `classifySource`; no `planAuthorBatches`/`fastAuthorModels`). They are excluded from the gate,
  so the gate stays green while this coverage is dead. *Decide: re-export the (renamed/inlined)
  functions to restore the tests, or update the tests to the current internal names. Touches
  product surface (`_internal`), so deferred out of audit-only Sprint 0.*

- [x] **B15 — `package.json` `test` script is incomplete vs the canonical gate.** **FIXED.**
  `package.json` `test` now runs all 8 gate suites in canonical order, byte-matching the
  ENGINEERING-BUILD-PLAN.md §6 / CLAUDE.md command, so `npm test` and the manual gate are
  identical. Verified: `npm test` → 275/275 across 8 suites, exit 0. *Original issue:* it ran
  only 6 of 8 (omitted `curriculum-store` and `curriculum-build`). **Still open as a separate
  enhancement (not B15):** the off-gate suites `curriculum-coherence`, `curriculum-bibliography`,
  `llm`, `llm-byok`, and the repaired B14 suites remain unwired from the gate.

- [x] **B16 — Some `generate.js` handler return paths violate never-dead-end (bare errors, no
  resolution).** **FIXED in Sprint 2.** All three previously-bare `ok:false` exits now carry a
  `resolution` and actionable `options`: 405 method (`status:"method_not_allowed"` + use-POST /
  ask-Bernard), 422 invalid brief (`status:"invalid_brief"` + fix-fields / ask-Bernard, errors
  retained), and the top-level catch-all 400 (`status:"generate_error"`, `resolution:"needs_human"`
  + retry / ask-Bernard). A **bounded auto-retry** (`withStageRetry`, one retry on a transient
  abort/timeout/5xx) now wraps `runOpenAIStages` before it degrades to the deterministic path, so a
  transient stage blip is retried before any escalation. **Verified:** `test/harness.js` asserts
  the 405 and 422 paths carry a resolution + non-empty options (the other three resolution paths
  were already covered).

- [ ] **B17 — The 60s LLM timeout demotes slow frontier models down the ladder; most slides fall
  back to deterministic expansion (B17 + former B18 are the SAME root cause).** **OPEN (found in a
  live Sprint 2 verification build; root cause corrected after routing diagnosis).** A live POST to
  `/api/generate` (standard tier, 40-slide "Introduction to Photosynthesis", `publish:false`)
  returned **HTTP 200 in 159s vs the <~90s target**, with **3 of 4 author batches failing with
  "The model call timed out."** and only **3 of 40 slides model-authored** (the rest deterministic
  expansion + `content-depth-repair`).
  - **Root cause:** `requestOpenAIJson` passes **no `timeoutMs`** (`api/generate.js:1795-1808`), so
    `completeJson` uses `DEFAULT_TIMEOUT_MS = 60000` (`api/llm.js:255`, `:18`); each model attempt
    gets a 60s `AbortController` (`api/llm.js:265-266`). A valid frontier call (gpt-5.5 on a
    12-slide / ~9000-token batch) takes **>60s → aborted → `AbortError`**, and the catch
    **advances the ladder on ANY throw, including a timeout** (`api/llm.js:290-293`), without
    consulting `shouldRetry` (which only runs on HTTP error responses, `api/llm.js:278`). So
    gpt-5.5 (60s) → gpt-5.4 (60s) → **gpt-4.1-mini** — up to 180s of serial timeouts per failed
    batch, parallelized to ~180s wall.
  - **Correction to the earlier note:** gpt-5.5/gpt-5.4 are NOT missing from the account (the
    OpenAI key has gpt-5.5 access; `/api/providers` shows `openai available:true`, default
    `gpt-5.5`). The ladder falls to `gpt-4.1-mini` because the frontier models are **timed out at
    60s and recorded as model failures**, not because they're unavailable. The former "B18 — models
    not on the account" framing was wrong and is merged here.
  - The Sprint 2 bounded pool worked as designed (4 batches fired concurrently, `concurrency:5`);
    without it this would have blown the 300s ceiling. The timeout cascade now dominates.
  - **Env-only config CANNOT solve this.** `configuredModels()` (`api/generate.js:1689-1692`)
    builds `[DEFAULT_OPENAI_MODEL, OPENAI_MODEL, ...FALLBACK]` — `DEFAULT_OPENAI_MODEL = "gpt-5.5"`
    (`:58`) is a **const, always prepended FIRST**, ahead of `OPENAI_MODEL` (`:1690`). So setting
    `OPENAI_MODEL=gpt-4.1-mini` yields the ladder `["gpt-5.5","gpt-4.1-mini","gpt-5.4"]` — gpt-5.5
    is STILL attempted first and STILL times out (~60s) on every batch; it only drops the gpt-5.4
    attempt. There is no env var for `DEFAULT_OPENAI_MODEL`, so no env value makes 4.1-mini the
    sole/leading model. The fix is code (below).
  - **SCOPED SPRINT 3 SUB-ITEM (the real B17/B18 fix).** During the `generate.js` decomposition,
    fix the model-ladder timeout-demote in the extracted provider/author module:
    (1) make the configured model **lead** `configuredModels()` — or be the **sole** model when
    `OPENAI_MODEL` is set — instead of always prepending the hardcoded `gpt-5.5`; and/or
    (2) pass a per-author `timeoutMs` and stop demoting the ladder on a timeout (a timeout is NOT a
    model failure — `api/llm.js:290-293` currently advances on any throw). Golden-test-covered. This
    is the real B17/B18 fix; env-only config cannot solve it (`DEFAULT_OPENAI_MODEL` is a const,
    always tried first).

- [ ] **B19 — Quality scored 96 although 37/40 slides were deterministic fallback, not
  model-authored (possible scorer blind spot).** **OPEN — note, lower priority (found alongside
  B17).** Despite only 3/40 slides being model-authored (the rest deterministic expansion), the
  same build scored **quality 96 ("excellent")**. Discovery had found 16 real sources so the
  grounded fallback is genuinely decent — but it is worth confirming whether `qualityAudit`
  distinguishes **model-authored from deterministic-fallback** content, or whether a deck that is
  mostly fallback can score "excellent" unnoticed (which would also mask B17 from the quality
  signal). *Investigate (do NOT change scoring here): does any rubric component reflect authoring
  provenance / model-authored coverage?*

- [ ] **B20 — Provider routing: the declared Anthropic default is unusable AND the generate author
  path hardcodes OpenAI, so setting the key alone won't reroute.** **OPEN (found in the provider/
  model routing diagnosis).** Two independent reasons the live build ran `mode:openai` /
  `gpt-4.1-mini` even though CLAUDE.md calls Anthropic the default:
  - **Anthropic isn't configured in Vercel.** Live `GET /api/providers` reports `default:"anthropic"`
    but `anthropic available:false` (key not set); `openai available:true`. `resolveProvider` skips
    an unavailable default and picks the first available provider (`api/llm.js:204-211`), so nothing
    can route to Anthropic today — even via the abstraction default (`DEFAULT_PROVIDER = "anthropic"`,
    `api/llm.js:178`).
  - **The generate/author path hardcodes `"openai"`.** `requestOpenAIJson` sets
    `providerWanted = _engine && _engine.provider ? _engine.provider : "openai"` (`api/generate.js:1787`);
    `_engine` is populated only from `brief.engine` (`api/generate.js:3736-3737`), which the live brief
    lacked. It then calls `llm.resolveProvider("openai")` (`api/generate.js:1794`), and the whole LLM
    pipeline is gated on the **OpenAI** key regardless of provider (`validateOpenAIKey(openAIKey())`,
    `api/generate.js:3857-3863`). So **setting `ANTHROPIC_API_KEY` alone will NOT reroute generate** —
    the path must also stop hardcoding `"openai"` and make the key gate provider-aware.
  - *Fixes + placement:* deciding the intended default and setting `ANTHROPIC_API_KEY` in Vercel (or
    correcting CLAUDE.md if OpenAI is the de-facto default) → **config-now** (you run the Vercel/env
    step; I can't). De-hardcoding the provider + a provider-aware key gate in `generate.js` →
    **Sprint 3** (with the provider extraction + golden test). Not Sprint 4 (unrelated to the
    knowledge-core seam).*

---

## Verification notes

- Full gate: **GREEN** (275 assertions, 0 failed) — but see B12/B13/B14/B15 for why "green" is
  partly overstated. Command and per-suite totals in `ARCHITECTURE.md §1`.
- Smoke: **21/21 endpoints respond, exit 0** (`scripts/smoke.js`); theme/curriculum 502 and
  curriculum-build 404 are expected under fully-stubbed externals.
- Nothing in this register was changed in Sprint 0 (audit only). B1/B3/B4/B7/B16 are the
  highest-value targets for Sprints 1–2; B12/B13 should be fixed early so the suite tells the
  truth before the Sprint 3–4 refactor relies on it.
