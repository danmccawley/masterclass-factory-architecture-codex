# Masterclass Factory

Runnable Class Creator + generator pipeline wired to the build contract. The app is vanilla
HTML/CSS/JS with Vercel serverless functions under `api/`.

## Contents
- `MASTERCLASS-FACTORY-AGENT.md` — the authoritative build contract (architecture, schemas, agent roster, Definition of Done). Read first.
- `build_content.py` — **Factory Agent 8 (codegen), made real.** Topic-agnostic generator that emits the whole content layer (`content.js`, `glossary.js`, `source.js`) and self-verifies. Runs out of the box with a 4-slide demo.
- `brief.template.json` — the Course Brief intake contract (fill this per deck; everything downstream reads it).
- `index.html`, `styles.css`, `wizard.js`, `brief-validator.js` — Milestone 1 Class Creator wizard. It emits a human-friendly class setup file while keeping the hidden `brief.json` contract valid.
- `api/brief.js` — Vercel serverless validator for posted setup payloads.
- `api/genie.js` — OpenAI-only always-on Bernard helper for step guidance and length recommendations.
- `api/objectives.js` — OpenAI-only objective drafting endpoint for terminal, enabling, and out-of-scope learning targets.
- `api/generate.js` — full generator endpoint. It validates the setup, builds a source paper,
  runs OpenAI specialist stages when the API key is present, falls back to a conservative
  deterministic path when AI is unavailable, runs independent source verification + QA, and returns
  a preview HTML file, deploy bundle, presenter script, and optional GitHub publish handoff.
- `api/librarian.js` — reserve-library source freshness check. It scans saved classes under
  `classes/`, checks source URLs, flags stale or unavailable sources, and stores history in KV when
  configured. `vercel.json` schedules it weekly.
- `api/qr.js` — Vercel launch-link QR code endpoint.
- `CLAUDE.md` — orchestration rules + pipeline (the Producer's instructions).
- `.claude/agents/*.md` — nine specialist subagents: research, curriculum, author, glossary, assessment, source-verify, codegen, qa, deploy.

## Quick start
```bash
python3 -m http.server 4173 # static wizard preview only
python build_content.py     # legacy content emitter demo, prints QA PASS
```

The deployed Vercel app runs the full serverless path. In the Class Creator, use
`Review & Generate -> Start generator`. The result includes:
- Open preview
- Download preview HTML
- Download deploy bundle
- Download presenter script
- GitHub/Vercel class URL after auto-publish is configured

All AI uses OpenAI only. Bernard, objective drafting, deck generation, tutor chat, grading, and TTS use
these Vercel environment variables:

```bash
OPENAI_API_KEY=your OpenAI API key
OPENAI_MODEL=gpt-5.5 # optional; GPT-5.5 is already the built-in default
```

If `OPENAI_MODEL` is not set, the app tries `gpt-5.5` first. If that model is unavailable to
the API key, the endpoints fall back through `gpt-5.4` and `gpt-4.1-mini` before returning the exact OpenAI error. If
`OPENAI_API_KEY` is missing or malformed, the wizard still works manually and the generator returns a
conservative source-honest draft instead of blocking the user.

Auto-publish to GitHub/Vercel is optional but needed for one-click class launch:

```bash
GITHUB_TOKEN=fine-grained token with Contents read/write on this repo
GITHUB_OWNER=danmccawley
GITHUB_REPO=masterclass-factory-architecture-codex
GITHUB_BRANCH=main # optional, defaults to main
PUBLIC_BASE_URL=https://your-production-vercel-domain.vercel.app # optional but recommended
```

When those are set, `/api/generate` commits the generated class to `classes/<class-slug>/`.
The existing GitHub -> Vercel connection should then deploy that path automatically.

Knowledge Base analysis is where terminal and enabling learning objective candidates should be
prepared. Step 03 reviews and approves them. Final TLOs and ELOs must be produced after the
knowledge base has been researched, analyzed, and matched to the learner profile.

Technical learner background must never be used as a reason to shorten a class. If learners are
technical, experienced, or familiar with the subject, Bernard and the generator should add more
depth, edge cases, source analysis, practice, transfer, and advanced examples while still respecting
the requested slide budget.

The returned deploy bundle contains the topic-specific `index.html`, `engine.js`,
`navscrubber.js`, `content.js`, `glossary.js`, `source.js`, serverless backends, and presenter
script. The generated content layer stays data-only; the engine and shell remain topic-agnostic.

## Knowledge Librarian
Saved masterclasses can be treated as reserve items. The Librarian endpoint:
- reads each saved class source paper from `classes/<slug>/source.js`
- reports credibility and reliability fields from the Works Cited / Knowledge Base slide data
- checks source URLs for availability, `ETag`, and `Last-Modified` changes
- flags classes that need review or regeneration

The weekly Vercel cron runs every Monday at 09:00 UTC:

```json
{ "path": "/api/librarian", "schedule": "0 9 * * 1" }
```

Set `KV_REST_API_URL` and `KV_REST_API_TOKEN` in Vercel if you want the Librarian to save history
between checks. Without KV, it still returns the current report.

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
