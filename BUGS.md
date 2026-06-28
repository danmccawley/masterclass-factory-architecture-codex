# BUGS.md — Known-issue register

Seeded from `ENGINEERING-BUILD-PLAN.md` §8 and confirmed against the code in Sprint 0. Each
item is a checkbox with `file:line` references **verified by reading the source** (line numbers
as of this commit). `[ ]` = open, `[x]` = fixed-and-verified. B12–B15 are **new findings from
the Sprint 0 audit**. No code was changed in Sprint 0.

---

## Carried from ENGINEERING-BUILD-PLAN.md §8

- [ ] **B1 — KB discovery intermittently aborts → round collapses to 15/100 (coverage 0,
  authority 0).** Sprint 1. **Confirmed mechanism:** every external search/fetch swallows
  timeouts/aborts into an *empty* result with no surfaced failure, so an aborted round is
  indistinguishable from "genuinely zero sources":
  - `tavilySearch` returns `[]` on `!response.ok` (`api/generate.js:775`) and on any
    error/abort (`api/generate.js:790-791`) — **fully silent**.
  - `fetchUrlText` 9s abort → `{ok:false}` (`api/generate.js:582-583`); the OpenAI search calls
    catch+break (`api/generate.js:647-649`, `714-716`).
  - `discoverKnowledgeBaseSources` per-round `try/catch` pushes "Round N search failed" and
    **`break`s** the loop (`api/generate.js:964-969`), ending discovery with whatever it had.
  - **The "15" is exactly an empty KB:** `scoreKnowledgeBase` with zero sources →
    `coverage 0` (`:239-241`), `authority 0` (`:253`), `recency 0.75` neutral (`:264`) →
    `round((0*0.5 + 0*0.3 + 0.75*0.2)*100) = 15` (`api/generate.js:266`). Verified by direct
    computation.
  - Health marker `KBDIAG` logged at `api/generate.js:3541-3554`.
  - *Fix direction (Sprint 1):* typed empty-or-partial results, bounded retry, graceful
    cascade, and an `evidence-limited` checkpoint instead of a bare 15.

- [x] **B2 — Quality gate dead-ended ≥70 classes on slide-count mismatch with a contradictory
  "below the 70 bar" message.** Fixed & verified live (commit `14af831`). **Confirmed still
  fixed in code:** slide-count delta is pushed to `recommendations`, never `issues`
  (`api/generate.js:3215`); `ok = issues.length === 0 && overall >= 70`
  (`api/generate.js:3244`); the contradictory headline is resolved in `resolveQaOutcome`
  (`api/generate.js:3097-3099`). *Keep a regression test asserting a 92/100 slide-delta class
  routes to pass (Sprint 2).*

- [ ] **B3 — Build slow; `slide_budget = minutes × density` bloats decks; ~sequential slide
  gen.** Sprint 2. **Confirmed:** authoring is a **sequential** for-loop of LLM batches
  (`api/generate.js:1741-1799`, `await requestOpenAIJson("author",…)` at `:1751`),
  `AUTHOR_BATCH_SIZE = 12` (`:78`), wall-clock guard `AUTHOR_TIME_BUDGET_MS = 170000` (`:1742`).
  The `minutes × density` multiply is **not** in `generate.js` (it lives in the frontend /
  curriculum density mapping); `totalSlideTarget` (`:361`) honors an explicit budget clamped
  1..400 (`:369`). *Fix direction: bounded-concurrency pool, order-preserving.*

- [ ] **B4 — Requesting fewer slides than the tier floor causes a count mismatch that drags the
  score.** De-fanged by B2 (non-blocking). **Confirmed:** `slideBudgetFloor` returns
  `Math.max(complexityFloor, tier.slide_floor)` (`api/generate.js:358`); tier floors 30/40/60/90
  (`:90,97,104,111`). Reconcile the clamp in Sprint 2.

- [ ] **B5 — Two tabs share no shell; single-class wizard not reordered to demographics-first.**
  Sprint 5. (Frontend: `create.html`/`wizard.js` vs `curriculum.html`; not re-confirmed at
  line level in this backend-focused audit.)

- [ ] **B6 — Remediation "Accept / Not now" panel renders behind the tracker overlay.** Sprint 6.
  (Frontend stacking/z-index; not line-confirmed here.)

- [ ] **B7 — Single-class `brief.template.json` `slide_budget` default 90 → slow single-class
  builds.** Sprint 2. **Confirmed:** `length.slide_budget = 90` in both the contract
  (`brief.template.json`) and the validator default (`brief-validator.js:61`). Lower it to match
  the Sprint 2 clamp.

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

- [ ] **B12 — `test/harness.js` async tests are non-gating (false-pass).** `test(name, fn)`
  (`test/harness.js:22`) is **synchronous** — it calls `fn()` inside try/catch but never awaits.
  Every `async () => {}` test (HTTP handlers `:318-347`, `assertFetchableUrl` rejects `:213-220`,
  the `resolveKnowledgeBase`/`detectAdvancementOpportunity` group `:684-749`, etc.) is counted
  "ok" the instant it is launched; its assertions settle as microtasks **after**
  `process.exit(0)` (`test/harness.js:762`). Async assertion failures never affect the count or
  exit code. **Impact:** the gate's `async` coverage is theater. *Fix direction (test-runner
  only): make `test` collect promises and `await Promise.allSettled(...)` before printing RESULTS
  / exiting.* **Not fixed in Sprint 0** because fixing it turns the suite RED (exposes B13),
  which is a behavior-revealing change to flag, not a runner-breakage repair.

- [ ] **B13 — The brief-endpoint gate test is a masked false-pass (wrong request shape).** Test
  "brief endpoint validates a good brief (200)" (`test/harness.js:326-331`) POSTs a **wrapped**
  body `{ brief: DEFAULT_TEMPLATE }`, but `api/brief.js` validates the **bare** request body as
  the brief (`api/brief.js:69-70`). The endpoint therefore returns **422**, not 200 (verified by
  driving the real handler). The test only "passes" because of B12. **Two-sided issue:** the
  test sends the wrong shape *and* it documents that the endpoint contract is "POST the bare
  brief.json" (not `{brief:…}`). Resolve alongside B12 (fix the test to send a bare brief; decide
  the canonical request shape and align the wizard's POST).

- [ ] **B14 — Two non-gate test files are broken (stale `_internal` imports).**
  `test/classify-source.test.js` (`classifySource is not a function`) and
  `test/author-plan.test.js` (`planAuthorBatches`/`fastAuthorModels` not functions) fail because
  `api/generate.js._internal` no longer exports those names (it has `classifyByHost`, not
  `classifySource`; no `planAuthorBatches`/`fastAuthorModels`). They are excluded from the gate,
  so the gate stays green while this coverage is dead. *Decide: re-export the (renamed/inlined)
  functions to restore the tests, or update the tests to the current internal names. Touches
  product surface (`_internal`), so deferred out of audit-only Sprint 0.*

- [ ] **B15 — `package.json` `test` script is incomplete vs the canonical gate.** `npm test`
  runs only 6 of 8 gate files (omits `curriculum-store` and `curriculum-build`) and none of the
  off-gate suites. The real gate is the CLAUDE.md / §6 command. *Align `package.json` to the
  full gate (and consider adding `curriculum-coherence`, `curriculum-bibliography`, `llm`,
  `llm-byok`, and the repaired B14 suites).*

- [ ] **B16 — Some `generate.js` handler return paths violate never-dead-end (bare errors, no
  resolution).** Of the handler's `ok:false` exits, three carry full actionable resolutions —
  `knowledge_base_review` (`api/generate.js:3596`), `qa_structural` (`:3657`), `quality_decision`
  (`:3676`) — but three return a bare `errors` array with **no `resolution`/`options`**: 405
  method (`:3494`), 422 brief-validation (`:3519`), and the **top-level catch-all 400**
  (`:3789`). The 400 catch is the concern: a mid-pipeline failure can collapse into an optionless
  dead-end. *Align with Sprint 2 acceptance ("no `ok:false` without a resolution object"); 405/422
  may be acceptable hard stops, the 400 catch-all is not.*

---

## Verification notes

- Full gate: **GREEN** (275 assertions, 0 failed) — but see B12/B13/B14/B15 for why "green" is
  partly overstated. Command and per-suite totals in `ARCHITECTURE.md §1`.
- Smoke: **21/21 endpoints respond, exit 0** (`scripts/smoke.js`); theme/curriculum 502 and
  curriculum-build 404 are expected under fully-stubbed externals.
- Nothing in this register was changed in Sprint 0 (audit only). B1/B3/B4/B7/B16 are the
  highest-value targets for Sprints 1–2; B12/B13 should be fixed early so the suite tells the
  truth before the Sprint 3–4 refactor relies on it.
