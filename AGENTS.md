# AGENTS.md — Build the Masterclass Factory

Codex: read this first, then `MASTERCLASS-FACTORY-AGENT.md` (the authoritative contract) and
`CLAUDE.md` (the pipeline). This file tells you what to build and the order to build it.

## What this repo is
The **Factory**: reusable tooling + the build contract for generating interactive masterclasses.
- `build_content.py` — the working content-layer generator (emits `content.js`, `glossary.js`, `source.js`, then self-verifies). This is "Agent 8 (codegen)" made real. Do not rewrite it; extend the data, not the machinery.
- `MASTERCLASS-FACTORY-AGENT.md` — schemas, agent roster, Definition of Done. The contract. Obey it.
- `brief.template.json` — the Course Brief intake schema. The whole system is driven by one `brief.json`.
- `prototype/index.html` — the **UI/UX spec** for the class-creator wizard. Match its look, flow, and output exactly. It is the target, not a throwaway.
- `.claude/agents/*.md` — the specialist agent definitions (research, curriculum, author, glossary, assessment, source-verify, codegen, qa, deploy). Mirror these as your own pipeline stages.

## What you are building
A **Masterclass Factory web application** with two halves:

1. **Class Creator (front-end).** An 8-step wizard that compiles a valid `brief.json`. Build it to
   match `prototype/index.html` (same steps, same fields, same live-brief drawer, same visual
   system: Fraunces + IBM Plex; ink/amber/oxblood/teal palette). Steps, in order:
   Create → Knowledge base → Objectives → Mastery → Demographics (average + floor) → Length →
   Language → Review & Generate. Output: a downloadable/POSTable `brief.json` matching
   `brief.template.json` exactly.

2. **Generator pipeline (back-end/orchestration).** Takes `brief.json` and runs the contract's
   pipeline to emit a complete, deployable deck:
   `research → curriculum → author ‖ glossary ‖ assessment → source-verify (GATE) → codegen → qa (GATE) → deploy`.
   Codegen fills the `GENERATED PER DECK` region of a per-deck copy of `build_content.py` and runs it.

## Architecture (do not deviate)
- **Three fixed layers, never generated:** the **engine** (`engine.js`, `navscrubber.js`), the
  **shell** (`index.html`), the **backends** (`api/*.js`). You only generate the **content layer**
  (`content.js`, `glossary.js`, `source.js`) plus de-topic ~7 strings (contract §6e).
- Vanilla JS + HTML + CSS, no build step (matches the engine). Deploy target: **Vercel** static + `/api/*` serverless.
- The content layer plugs into a copy of the engine template (see "Missing input" below).

## Verified data contract (these are checked — getting them wrong silently breaks the deck)
- `window.GLOSSARY` = `{ term: { d:"definition", r:"why it matters" } }` — objects, never bare strings.
- Sources = ONE `window.SOURCE_PAPER = { title, cite, sections:[{id,num,title,body}] }` — not a flat array. Citations `data-src="sN"` resolve to a section `id`.
- Slide `paper` ships as a single object `{secnum,h,body}` (in `build_content.py`, author as `paper=[P(...)]`; the emitter unwraps it).
- Quiz item keys: `type/level/q/options/answer/why` (+ `rubric/sample/accept[]` for `sa`). Never `opts/a`.
- `POLLS`/`WORDS` are deck-defined (`window.POLLS`/`window.WORDS`); never hardcode them in the engine.
- Slide schema: `{id, eyebrow, num, deck, paper?, poll?, words?}`. Join/merge by `id`, never by title or position.

## Build milestones (ship in this order; each must run before the next)
1. **Wizard parity.** Reproduce `prototype/index.html` as the real Class Creator. It must emit a
   `brief.json` that validates against `brief.template.json`. (Front-end only; no AI yet.)
2. **Codegen path.** Wire "Generate" → fill `GENERATED PER DECK` in a copy of `build_content.py` →
   run it → confirm it prints `QA PASS`. Stub the AI authoring with deterministic placeholder content first.
3. **AI stages.** Replace stubs with the specialist agents (`.claude/agents/*.md`): research,
   curriculum, author, glossary, assessment. Ground every fact; cite to `SOURCE_PAPER.sections`.
4. **Gates.** Implement source-verify and qa as INDEPENDENT passes (a separate context/process from
   the author). Block deploy unless both pass.
5. **Deploy.** Assemble the flat deck bundle (engine template + generated content layer + `api/`),
   de-topic the §6e strings, set env vars, `vercel --prod`, verify the EXACT printed Production URL.

## Verification (your Definition of Done — contract §10)
- `python build_content.py` prints `QA PASS`; the emitted files load under Node as the engine would.
- Every quiz JSON parses; every `data-src` resolves to a section id; every glossary entry is `{d,r}`;
  `paper` is a single object; POLLS/WORDS ids referenced by slides are defined.
- De-topic complete (no prior-topic strings anywhere, including the two backend system prompts —
  which also carry the audience reading level + topic sensitivity notes; regenerate from the brief).
- Ship a FLAT zip (files at root, `api/` a subfolder). Trust only the Vercel Production URL printed
  (not "Ready in 9s"). One Vercel project per deck.

## Missing input you must obtain before milestone 5
This repo does NOT yet contain the engine template (`engine.js`, `navscrubber.js`, `index.html`,
`api/chat.js`, `api/grade.js`, `api/tts.js`, `api/poll.js`, `api/words.js`, `api/feedback.js`,
`api/quality.js`). They
are topic-agnostic and reused unchanged. Add them under `template/` before assembling a deployable
deck. Until then, milestones 1–4 are fully buildable (the generator + wizard + content layer stand alone).

## Hard "do nots"
- Do not edit the engine, shell, or backends except the §6e de-topic strings.
- Do not invent sources, dates, or URLs. Unverifiable claims get cut, not faked (source-verify gate).
- Do not let the agent that wrote content sign off on it — source-verify and qa are independent.
- Do not use PowerShell `Set-Content -Encoding UTF8` on `index.html` (BOM/CRLF corruption); byte-level writes only.

---
### Kickoff prompt (paste into Codex to start)
> Read AGENTS.md, MASTERCLASS-FACTORY-AGENT.md, and prototype/index.html. Then build milestone 1:
> a production version of the Class Creator wizard that matches the prototype's 8 steps, visual
> system, and live brief.json drawer, and emits a brief.json validating against brief.template.json.
> Keep it vanilla JS / no build step, Vercel-static deployable. Show me the file tree and the wizard
> before moving to milestone 2.
