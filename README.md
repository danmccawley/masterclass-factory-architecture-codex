# Masterclass Factory — Starter Kit

Runnable codegen + a Claude Code subagent set, wired to the build contract. Use the same files in
Claude, Claude Code, Codex, or ChatGPT.

## Contents
- `MASTERCLASS-FACTORY-AGENT.md` — the authoritative build contract (architecture, schemas, agent roster, Definition of Done). Read first.
- `build_content.py` — **Factory Agent 8 (codegen), made real.** Topic-agnostic generator that emits the whole content layer (`content.js`, `glossary.js`, `source.js`) and self-verifies. Runs out of the box with a 4-slide demo.
- `brief.template.json` — the Course Brief intake contract (fill this per deck; everything downstream reads it).
- `index.html`, `styles.css`, `wizard.js`, `brief-validator.js` — Milestone 1 Class Creator wizard. It emits a human-friendly class setup file while keeping the hidden `brief.json` contract valid.
- `api/brief.js` — Vercel serverless validator for posted setup payloads.
- `api/objectives.js` — OpenAI-only objective drafting endpoint for terminal, enabling, and out-of-scope learning targets.
- `api/qr.js` — Vercel launch-link QR code endpoint.
- `CLAUDE.md` — orchestration rules + pipeline (the Producer's instructions).
- `.claude/agents/*.md` — nine specialist subagents: research, curriculum, author, glossary, assessment, source-verify, codegen, qa, deploy.

## Quick start
```bash
python3 -m http.server 4173 # opens the Class Creator at http://127.0.0.1:4173/
python build_content.py     # writes content.js, glossary.js, source.js, then prints QA PASS
```
Milestone 1 stops at the class setup. The `Start generator` button validates and posts the setup to
`/api/brief` on Vercel; it does not run codegen yet.

AI objective drafting requires this Vercel environment variable:

```bash
OPENAI_API_KEY=your OpenAI API key
```

`OPENAI_MODEL` is optional. If it is not set, the wizard uses `gpt-4.1-mini`. If it is set to a model
that is unavailable to the API key, the endpoint tries `gpt-4.1-mini` before returning the exact
OpenAI error. If `OPENAI_API_KEY` is missing, the wizard keeps working manually and explains that AI
assistance is not connected.

Drop the three emitted files next to a copied engine bundle (`engine.js`, `navscrubber.js`,
`index.html`, `api/*.js`), de-topic the strings in contract §6e, set the env vars, `vercel --prod`.

## To author a real deck
Replace the `GENERATED PER DECK` region of `build_content.py` (the `slide(...)`/`quiz_slide(...)`
calls, `POLLS_DEF`, `WORDS_DEF`, `GLOSSARY`, `SOURCE_PAPER`). Do NOT touch the helpers or the
emit/verify machinery. Set `CLASS_TITLE` and `DISAGREE_LABEL`.

## Across tools
- **Claude Code:** the kit is ready — `CLAUDE.md` drives the Producer; invoke subagents by name.
  `source-verify` and `qa` run as independent gates.
- **Codex / ChatGPT:** run the subagent bodies as ordered prompt stages; keep source-verify and qa in
  separate sessions so they don't inherit authoring context.

## Verified contract (do not drift)
- `GLOSSARY` term -> `{d, r}` (definition + why-it-matters), never a bare string.
- Sources = ONE `window.SOURCE_PAPER {title, cite, sections:[{id,num,title,body}]}`, not a flat array.
  Citations `data-src="sN"` resolve to a section `id`.
- `paper` ships as a single object (Python `paper=[P(...)]`; emitter unwraps).
- Quiz keys: `type/level/q/options/answer/why` (+ `rubric/sample/accept[]` for `sa`).
- `POLLS`/`WORDS` are deck-defined. Six backends: chat, grade, tts, poll, words, feedback.
