# Masterclass Factory — Product Roadmap

> Reconstructed from the planning session. Aligns the team on architecture, the
> phased plan for the add-on feature ideas, and the knowledge-base directive.

## The through-line: build a knowledge core once, render it many ways

Most of the feature ideas on the table — "In a Nutshell" deck, exam prep,
discussion questions, spoken study guide, flight-prep briefing, client SOP, the
conversational "teach me" layer — are not different products. They are the same
verified, source-grounded knowledge **rendered into different formats for
different moments**.

Today the factory fuses two things that should be separate:

1. **The knowledge core** — sources, evidence map, objectives, the synthesized,
   verified teaching content.
2. **One renderer** — the live presenter deck it happens to produce.

The single most important architectural move is to **split those apart**. Build
and verify the knowledge core once; then every feature below becomes a *renderer*
that consumes that core. New output modes stop being new pipelines and become
small, cheap additions.

## Phase 0 — Foundation (before any feature)

- **0.1 Knowledge-core / renderer split** in `generate.js`. Factor the verified
  core out as its own savable object that can be re-rendered. Invisible to users;
  the keystone for everything else.
- **0.2 Persistence + class library.** Every feature assumes you can come back to
  a core later (re-render as exam prep, format as an SOP, push to audio). Without
  a library, each add-on is a one-shot dead-end. This is the shelf the printing
  press is missing.
- **0.3 Knowledge-base directive (this milestone).** Make the KB interactive and
  **sealed** at wizard step 2; never re-litigated downstream; one human-approved
  "advancement opportunity" is the only door to reopen a sealed KB. See below.

## Phase 1 — Renderers on the existing core (high value, low marginal cost)

- **Syllabus / reading drop-in (Will).** Both an input (ingest syllabus + readings
  as the core directly — solves source scarcity by definition) and a set of
  renderers: nutshell deck, exam prep, discussion-question prep, single-slide
  synthesis. Strongest Phase 1 candidate.
- **B2B deliverable formatting (FEMA SOP example).** A renderer that emits the
  core in a client's document standard. High enterprise value; the hard part is
  ingesting/matching the template, not generating content.
- **Audible / study-guide mode.** A renderer on the existing `tts.js`. Small lift.
- **Feedback button (pull forward).** In-app link, talk-to-text, posts to a
  central repository. Replaces formal surveys during the pilot. A day or two.

## Phase 2 — Conversational and "moment" layers

- **Conversational "AI teach me" layer.** The AI narrates the core slide by slide
  and fields interruptions, grounded in verified sources. Active + passive modes.
- **Just-in-time consulting assistant (BCG flight-prep angle).** Architecturally
  this is the nutshell renderer + the teach-me layer, packaged and marketed for a
  moment ("be expert-ready before you land"). A bundle and a landing page, not new
  engineering — the payoff of the core/renderer model.

## Phase 3 — Live meeting copilot (post-MVP)

- **RFI forecasting / predictive questioning.** Zoom/Teams plugin predicting likely
  questions and surfacing answers live. Real-time audio + platform integration +
  latency constraints. Genuinely different; keep post-MVP.
- **Psychological profiling for negotiation (v2).** Deferred for effort. Flag: profiling
  identifiable participants runs into consent/privacy/legal exposure. Design the
  data and consent model deliberately before building, not after.

## Scope discipline

Get the core split clean and **one** renderer working end to end before starting
others. That first renderer is the proof the architecture holds. If it does, the
rest are fast. If it doesn't, find out on renderer one.

---

## Phase 0.3 — Knowledge-base directive (detail)

**Principle:** the human is the only off-switch; the KB is settled once.

1. **Interactive at step 2.** Discovery, scoring, and resolution happen on the
   Knowledge Base wizard step (not as a surprise at generate time). The human
   resolves any shortfall there: add sources, accept a met tier, or build anyway
   (sealed evidence-limited). Implemented via `POST /api/knowledge-base`
   (`mode:"review"` then `mode:"seal"`).
2. **Sealed, then never re-litigated.** Sealing stamps `knowledge_base.sealed`.
   `resolveKnowledgeBase` short-circuits a sealed KB straight to `ready`
   (`ladder: ["knowledge-base-sealed-by-human"]`). No downstream stage raises the
   KB again.
3. **The one exception — advancement opportunity.** During a sealed build,
   `detectAdvancementOpportunity` runs a non-blocking probe for a stronger primary
   source found after seal. If found, it is surfaced as an optional, human-reviewed
   notice (`advancement_opportunity` in the success payload). Folding it in is
   manual: re-open, add, re-seal, regenerate. Never automatic, never blocking.

**Status:** backend complete and tested (107 harness tests green). Frontend
(interactive step UI, seal, advancement notice) implemented; visual flow confirms
on deploy.
