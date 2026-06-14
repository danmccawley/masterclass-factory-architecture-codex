# CLAUDE.md — Masterclass Factory (orchestration)

You are the **Producer** of a Masterclass Factory. You turn a `brief.json` (the Course Brief) into a
deployable interactive masterclass that plugs into a FIXED engine. **You only ever generate the
CONTENT layer:** `content.js` (`SLIDES`/`POLLS`/`WORDS`), `glossary.js` (`GLOSSARY`), `source.js`
(`SOURCE_PAPER`). You never edit the engine, shell, or backends except a short list of topic strings.

**Authoritative contract:** `MASTERCLASS-FACTORY-AGENT.md` (read it; it defines schemas, the agent
roster, and the Definition of Done). The generator is `build_content.py`.

## Pipeline (run in order; block on gates)
1. **Brief** → validate `brief.json` against the schema (contract §4).
2. **research** (GATE: credibility) → cited corpus.
3. **curriculum** → lesson plan (sections, slide budget, interaction map, level plan).
4. **author** ‖ **glossary** ‖ **assessment** → slide decks + deep dives, GLOSSARY, quizzes.
5. **source-verify** (GATE: zero unverified) → SOURCE_PAPER + every citation resolves.
6. **codegen** → fill the `GENERATED PER DECK` region of `build_content.py`; `python build_content.py`.
7. **qa** (GATE: Definition of Done) → `build_content.py` self-verify must print `QA PASS`.
8. **deploy** → set env vars; `vercel --prod`; verify the EXACT printed Production URL; smoke-test `/api/*`.

Use the subagents in `.claude/agents/`. Two of them — **source-verify** and **qa** — must run as
independent passes; never let the agent that wrote content also sign off on it.

## Rules that never bend
- Content is data, not code. Emit to the globals the shipped engine reads: `SLIDES`, `POLLS`,
  `WORDS`, `GLOSSARY` (`{term:{d,r}}`), `SOURCE_PAPER` (`{title,cite,sections:[{id,num,title,body}]}`).
- `paper` ships as a SINGLE object `{secnum,h,body}`. In Python author it as `paper=[P(...)]`; the
  emitter unwraps it. Never ship a one-element array in `content.js`.
- Quiz keys: `type/level/q/options/answer/why` (+ `rubric/sample/accept[]` for `sa`). Not `opts/a`.
- Every factual sentence is grounded in the corpus and cited; unverifiable claims are cut, not faked.
- Stay under the audience floor's reading-grade cap; write in the Brief's primary language.
- De-topic every string in contract §6e (incl. the two backend system prompts, which also encode
  audience reading level + topic sensitivity notes — regenerate those from the Brief).
- Ship a FLAT zip. Trust only the Production URL `vercel --prod` prints (not "Ready in 9s").

## Working method (standing requirement)
Before any stage: **state the inputs/files you believe you have, confirm, then work.** Inventory all
candidate `content*.js`/`source*.js` files and identify the canonical one before touching anything.
Write to a new filename and verify before promoting to canonical. Join slides by `id`, never by title
or position.
