# Codex Build Prompt — Masterclass Factory

Repo: `https://github.com/danmccawley/masterclass-factory-architecture-codex`

Connect Codex to that repo (it clones into its own OpenAI environment and auto-loads `AGENTS.md`),
then paste the prompt below.

---

## ▶ Kickoff prompt (paste into Codex)

You are building the **Masterclass Factory** from this repository. Before doing anything, read these
three files in full — they are the contract and you must obey them:

1. `AGENTS.md` — what to build and the milestone order.
2. `MASTERCLASS-FACTORY-AGENT.md` — the authoritative architecture, data schemas, agent roster, and Definition of Done.
3. `prototype/index.html` — the exact UI/UX target for the Class Creator wizard.

Also skim `CLAUDE.md`, `build_content.py`, `brief.template.json`, and `.claude/agents/*.md`.

**What this system is.** A two-part app: (1) a **Class Creator** wizard that compiles a `brief.json`,
and (2) a **generator pipeline** that turns that brief into a deployable interactive masterclass.
The engine, shell, and backends are FIXED — you only ever generate the **content layer**
(`content.js`, `glossary.js`, `source.js`) plus a few de-topic strings. Content is data, not code.

**Verified contract — do not drift (these are silently load-bearing):**
- `window.GLOSSARY` = `{ term: { d:"definition", r:"why it matters" } }` — objects, never bare strings.
- Sources = ONE `window.SOURCE_PAPER = { title, cite, sections:[{id,num,title,body}] }` — not a flat array. Citations `data-src="sN"` resolve to a section `id`.
- Slide `paper` ships as a single object `{secnum,h,body}` (in `build_content.py`, author as `paper=[P(...)]`; the emitter unwraps it).
- Quiz keys: `type/level/q/options/answer/why` (+ `rubric/sample/accept[]` for `sa`). Never `opts/a`.
- `POLLS`/`WORDS` are deck-defined (`window.POLLS`/`window.WORDS`).
- Slide schema `{id, eyebrow, num, deck, paper?, poll?, words?}`. Join by `id`, never by title or position.
- Stack: vanilla JS + HTML + CSS, no build step. Deploy target: Vercel static + `/api/*` serverless.

**Build milestone 1 only, then stop for my approval:**
Produce a production version of the **Class Creator** wizard that matches `prototype/index.html`:
- the same 8 ordered steps — Create → Knowledge base → Objectives → Mastery → Demographics
  (typical learner AND the floor) → Length → Language → Review & Generate;
- the same visual system — Fraunces (display) + IBM Plex Sans/Mono, ink/amber/oxblood/teal palette;
- the same live `brief.json` drawer that compiles as the user fills the form;
- output: a downloadable / POSTable `brief.json` that **validates against `brief.template.json` exactly**.
Keep it vanilla JS, no build step, Vercel-static deployable. Add a focused commit.

**When milestone 1 is done:** show me the file tree, the running wizard, and a sample emitted
`brief.json`. Then WAIT — do not start milestone 2 (the codegen path that fills the
`GENERATED PER DECK` region of `build_content.py` and runs it to `QA PASS`) until I approve.

**Rules that never bend:**
- Do not edit the engine, shell, or backends except the de-topic strings in contract §6e.
- Do not invent sources, dates, or URLs — unverifiable claims get cut, not faked.
- Source-verification and QA are INDEPENDENT gates; the agent that wrote content never signs off on it.
- Work the milestones in order; each must run before the next. Restate the inputs you have before each stage.

**Known gap:** the repo does not yet contain the engine template (`engine.js`, `navscrubber.js`,
`index.html`, `api/*.js`) under `template/`. Milestones 1–4 are fully buildable without it. Flag it
when you reach milestone 5 (assembling a deployable deck) rather than inventing your own engine.

---

## ▶ Follow-up prompts (use after each milestone is approved)

**Milestone 2 — codegen path:**
> Approved. Build milestone 2: wire the wizard's Generate action to fill the `GENERATED PER DECK`
> region of a per-deck copy of `build_content.py`, run it, and confirm it prints `QA PASS`. Use
> deterministic placeholder content for now (no AI yet). Show me the emitted content.js/glossary.js/
> source.js and the QA output, then wait.

**Milestone 3 — AI stages:**
> Approved. Build milestone 3: replace the placeholders with the specialist agents in
> `.claude/agents/` (research, curriculum, author, glossary, assessment). Ground every fact in the
> corpus and cite to `SOURCE_PAPER.sections`. Keep source-verify and qa as separate stages for the
> next milestone. Show me a generated deck's content layer, then wait.

**Milestone 4 — gates:**
> Approved. Build milestone 4: implement source-verify and qa as INDEPENDENT passes (separate
> context from the author). Block generation from completing unless both pass. Show me a run where
> the QA gate catches a deliberately broken deck, then wait.

**Milestone 5 — deploy (after I add `template/`):**
> Approved, and `template/` is now in the repo. Build milestone 5: assemble the flat deck bundle
> (engine template + generated content layer + `api/`), de-topic the §6e strings, set the env vars,
> `vercel --prod`, and verify the EXACT printed Production URL with `/api/*` smoke tests.
