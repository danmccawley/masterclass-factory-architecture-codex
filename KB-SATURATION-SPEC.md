# Knowledge-Base Saturation & Source-Ledger Spec

Status: draft for review (Dan + partner). Companion to `PRODUCT-ROADMAP.md`.
Scope: the knowledge core that every Masterclass Factory feature renders on.

This spec replaces "did we hit a fixed source count?" with "is this knowledge
base *saturated* for *this* subject, judged per learning objective, with its
composition fully auditable." It defines the model, what ships now vs. what
needs the claim-extraction build, and every point where the engine makes a
judgment the human must be able to see and override.

---

## 1. The core correction

A fixed source floor (e.g. 12 sources / 3 primary for "professional") is a
**tier compliance gate**, not a saturation signal. Different subjects saturate
at wildly different source counts. The floor stays — as a contract about the
minimum a paid class ships on — but it is no longer treated as "done." Done is a
separate, source-relative judgment defined below.

Two distinct questions, kept separate:
- **Compliance:** did we clear the tier's minimum bar? (count-based, a contract)
- **Saturation:** would another round of research still move mastery? (rate-based, per subject)

---

## 2. The six saturation dimensions

Saturation is judged on six signals. None references an absolute count.

1. **Novel-claim rate.** New *claims* per round, not new *URLs*. Two sources
   asserting the same fact corroborate; they do not add mastery. Saturation =
   novel-claim rate decayed toward zero. (Today the engine counts new verified
   URLs as a proxy; the real signal needs claim extraction — see §6.)
2. **Corroboration depth.** Are load-bearing claims supported by 2–3
   *independent* sources (not three citations of one origin)? A topic is done
   when the claims that matter are triangulated and new sources only echo them.
3. **Gap closure.** Discovery already emits gaps. Saturation = every *closeable*
   gap is closed and the remainder are *structural* (the info does not exist
   publicly / is private). Stop is honest only when remaining gaps are ones more
   searching cannot fix.
4. **Authority ceiling.** Has discovery reached the *primary/authoritative* tier
   (standard-setter, regulator, manufacturer, direct publisher), or only
   secondary commentary? A 20-source KB that never reached the primary document
   is not saturated.
5. **Representational completeness** *(conditional — fires only on contested
   topics).* Are the substantive, genuinely-held positions each represented from
   sources that *hold* them — not one side's characterization of the other?
   Triangulation can hide one-sidedness (three sources that agree because they
   share a perspective). Contested claims are preserved as live disagreements
   with each side sourced, never averaged into a false resolution.
6. **Source-language adequacy** *(conditional — fires when the subject is native
   to another linguistic context).* For a foreign battle, war, legal system,
   standard, or institution, the primary record lives in the source-country
   language. English-only sourcing ceiling-caps at the *outside* view. Saturation
   requires first-hand / primary sources *in the language they exist in*, not
   only foreign-language commentary about the subject.

Dimensions 5 and 6 reinforce each other: on a contested foreign topic the
perspectives often *are* the national viewpoints, each best sourced in its own
language.

---

## 3. Per-objective, not per-topic

Saturation is judged **per terminal (TLO) and enabling (ELO) learning
objective**, then rolled up. Rationale: a fixed count is arbitrary for a topic
and *more* arbitrary across objectives within it. One ELO may saturate at 2
authoritative sources; another stays thin across 15. A single KB-level number
hides a starving objective behind a healthy average.

- Each TLO/ELO carries its own six-dimension read over the sources/claims that
  bear on *that* objective.
- **Rollup rule: the weakest objective gates the class.** Not an average. A
  masterclass with one unsupported objective is not done, however rich the rest.
- The checkpoint shows per-objective bars (corroborated / thin / structural)
  plus the overall.

**Objective ↔ KB loop.** Objectives are provisional until research informs them
(the wizard already frames TLOs/ELOs as candidates post-KB). So this is
iterative, not linear: provisional objectives seed per-objective discovery;
per-objective saturation reveals which objectives are *supportable*; a
thin/structural objective is a signal to revise or cut it. The evidence tells
you which objectives you can honestly teach. (Engine models a loop, not a line.)

### Schema decision (resolved against the real code)

Objectives in the brief are flat **string arrays** —
`objectives.terminal[]`, `objectives.enabling[]`, `objectives.out_of_scope[]` —
validated by `expectStringArray`, inside a strict `exactKeys` shape, and consumed
as strings throughout `generate.js`. **The schema does NOT change.** Enriching
objectives to `{id, text}` objects was considered and rejected: it breaks the
validator and ripples through every string read in `generate.js`.

Instead, per-objective saturation **identity lives in the saturation layer**
(the `round_state` the round engine already carries), not in the validated brief
contract. Each objective gets a stable id = hash of its normalized text, with
re-link tolerance for when wording firms up during the loop. This mirrors how the
round engine keeps all new state out of the validated contract.

`generate.js` already contains the seed: **`buildEvidenceMap`** walks each
terminal/enabling objective and maps it to source-paper section ids with a
`mapped | gap` status. Per-objective saturation is built by lifting that
objective→evidence logic into the round loop and replacing its binary status with
the six-dimension read.

---

## 4. The conditional gates

> **DECISIONS (locked with Dan, this session):**
> - **Legitimacy rule (§4):** option **(c) with (a) as the default** — the engine
>   detects and labels positions with sourcing and makes NO legitimacy call on
>   its own; it *suggests* the expert-consensus framing (a) as the default, and
>   the human can override what stays. Engine never silently decides what is
>   legitimate.
> - **Gate severity (dims. 5 & 6):** **warn, never block.** A contested-but-one-
>   sided or foreign-but-English-only KB is flagged loudly in the ledger and the
>   checkpoint, but it never blocks the seal. Human is the only off-switch.
> - **First dimension built:** per-objective saturation (§3) — backbone shipped.
> - **Budget governor:** see §9 (new).


Three of the criteria do not apply universally and must be *detected*, with the
detection visible and overridable:

- **Contestedness gate (dim. 5).** Most topics are not contested; forcing
  balance where none exists is false balance. The engine detects whether a topic
  or objective has substantive competing perspectives and only then applies
  representational completeness. The detection is shown to the human.
- **Foreign-locus gate (dim. 6).** The engine detects whether a subject is
  native to a non-English linguistic context and which language(s), then weights
  native-language primary sources and issues native-language discovery queries.
  Shown to the human.
- **Objective-trigger.** Which objectives even invoke gates 5/6 (a factual ELO
  may not; a contested-history TLO will).

**Legitimacy is bounded and visible.** "All perspectives" is never literal — a
vaccine-safety class does not owe equal weight to fringe claims; a Holocaust
class does not "represent both sides." The rule is: *the perspectives a fair,
informed expert in the field would recognize as substantive and genuinely
held.* The engine must surface what it detected as substantive AND what it
excluded as fringe and why, so the human can correct it. The engine never
silently decides which views are legitimate.

---

## 5. The source ledger (line-by-line, auditable)

Every saturation claim is only trustworthy if the human can audit the evidence.
The ledger is delivered in two tiers.

### Tier 1 — Composition ledger  *(SHIPS NOW — built on current data)*
Per accepted source: index, URL, declared type, declared trust
(primary/secondary/unknown), origin (found by Bernard vs added by class maker),
and verification status (full text read / reachable-only with credibility
unverified / declared-not-machine-verified). Plus: the **rejected** sources with
reasons, and totals vs. the tier floor. Every row carries a caveat that finer
classification and credibility are tier-2. What was thrown out (and why) is part
of the audit, not hidden.

### Tier 2 — Reliability ledger  *(needs claim-extraction build)*
The finer taxonomy and real credibility read:
- Source class: **first-hand account** (witness/participant/contemporaneous) vs.
  **primary source** (official doc/standard/dataset) vs. **authoritative
  secondary** (peer-reviewed synthesis) vs. **commentary**. (Finer than today's
  three-way trust label.)
- Per-source credibility: publisher authority, recency, independent-corroboration
  count, flagged bias.
- Cross-link tags: which **objective(s)** the source supports, which
  **perspective** it represents (dim. 5), what **language** it is in (dim. 6).

**Honesty rule (both tiers):** the ledger reports the engine's judgment
*including uncertainty*. Unreadable source → "credibility unverified," never a
fabricated score. Every classification is the engine's claim, visible and
overridable. A confident credibility score the engine cannot back is the exact
failure this tool exists to prevent.

---

## 6. Build split: now vs. claim-extraction (option B)

**Shipping now (runs on the current round engine):**
- Round-based KB building with human checkpoints (continue / narrow / accept).
- Novel-information proxy = new *verified-source* rate per round (deduped).
- Gap list (closeable vs. structural) and authority signal (primary/secondary mix).
- **Tier-1 composition ledger** (per-source type/trust/verification + rejected
  with reasons + totals).

**Needs the claim-extraction re-architecture (option B):**
- True novel-*claim* rate, corroboration depth (dims. 1–2 in full).
- Per-objective saturation and the objective↔KB loop (§3).
- Contestedness detection + representational completeness (dim. 5, gate).
- Foreign-locus detection + multilingual discovery (dim. 6, gate).
- **Tier-2 reliability ledger** (§5) with first-hand/primary/secondary taxonomy,
  credibility, and objective/perspective/language cross-tags.

Option B adds, per verified source: claim extraction (1 model call/source),
claim dedup/corroboration across sources, claim→objective relevance mapping,
stance/perspective classification (contested topics), and language handling
(extraction + teaching-time translation). It is a knowledge-core build, not an
add-on.

---

## 7. Human-override points (must all be visible)

1. Which gaps are closeable vs. structural.
2. Contestedness: is this topic/objective actually contested?
3. Which perspectives are substantive vs. fringe (and the exclusion reasons).
4. Foreign-locus: which language(s) the subject "belongs" to.
5. Source classification (first-hand/primary/secondary) and credibility per row.
6. Per-objective accept: the human accepts the whole saturation *profile*, not a
   single number — and remains the only off-switch, consistent with the factory's
   core principle.

---

## 9. Budget governor (new — decided this session)

The human sets a spend budget for the class. The engine tracks real expense
against it as the build runs and manages the work to finish *within* budget.

**Behavior (locked):** the governor **notifies, never refuses.** When an action
the human asks for (e.g. "run another research round") would risk exceeding the
budget — especially in a way that would leave too little to *complete* the class
— the engine surfaces the danger with an **estimated cost of the overage** and
the human decides: raise the budget, spend anyway, or stop. It is a forced
checkpoint, never a hard kill. This preserves "human is the only off-switch"
while making spend visible and governed.

**What it requires:**
- A **cost model**: per-operation cost estimates (a discovery round ≈ N search
  calls + M URL fetches; claim extraction ≈ 1 LLM call/source; slide authoring ≈
  batched LLM calls). Tier-scaled depth (claim extraction only as deep as the
  tier warrants), and extraction capped to the sources that bear on objectives.
- A **budget ledger** threaded through the pipeline: running tally of estimated
  + actual spend, remaining budget, and a forecast of "cost to complete from
  here" so the governor can warn *before* an action strands the build.
- **Overage estimate**: when an ask would exceed budget, show the projected $
  over, not just a yes/no — so the human decides with the number in front of them.

**Open dependency:** whether `generate.js` already captures token/API usage at
the call sites (OpenAI, Tavily). The governor cannot manage spend it cannot
measure; the cost model is built on whatever usage signal those calls return (or
on estimated unit costs if they return none). This is its own build, and a
practical prerequisite to option B, since B is what makes per-class cost spike.

---

## 10. Recommended sequencing

1. **Done & verified:** round engine + tier-1 composition ledger, applied to the
   real repo with the full suite green (107 harness + 27 round-engine).
2. **Done & verified:** per-objective saturation backbone (§3) — data model,
   weakest-gates rollup, injected relevance mapper with a labeled keyword-overlap
   proxy default (12 tests). Real semantic mapping arrives with claim extraction.
3. **Approve this spec** (you + partner) — §4 legitimacy rule and §7 overrides are
   now decided (see §4 box); review for agreement.
4. **Budget governor (§9):** cost model + budget ledger + notify-on-overage. A
   practical prerequisite to the deeper option-B dimensions.
5. **Option B dimensions** behind the same checkpoint UI: claim extraction (which
   also upgrades per-objective mapping from proxy to real) → corroboration depth →
   contested/representational (gate = warn) → language adequacy (gate = warn) →
   tier-2 reliability ledger.
6. The saturation-control panel renders whichever signals are real at each stage;
   it never displays a dimension the engine cannot yet honestly back.
