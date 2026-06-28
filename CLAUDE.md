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

## Test gate (full suite)
node test/harness.js && node test/kb-rounds.test.js && node test/kb-objectives.test.js && node test/kb-budget.test.js && node test/theme.test.js && node test/curriculum.test.js && node test/curriculum-store.test.js && node test/curriculum-build.test.js

## Push/verify workflow (Windows/PowerShell 7)
1. Decode/copy any delivered file as step one.
2. Verify a marker with Select-String.
3. node --check on changed files.
4. Run the full suite — ALL GREEN required, no exceptions.
5. git add/commit (must report "N files changed").
6. git pull --rebase origin main (intervening auto-published class commits are normal; rebase resolves them).
7. git push.

## Diagnostics (Vercel MCP)
- get_runtime_errors first (pre-aggregated, never times out).
- get_runtime_logs with group_by requestPath/statusCode to see what hit the server.
- Targeted query for markers (KBDIAG, abort). Log retention ~1 day — reproduce live for fresh logs.
- KBDIAG fields: keyUsable, model (tavily-search = Tavily active), added, rejected, resolution.
- maxDuration ceilings: generate 300, curriculum 300, knowledge-base 120, remediate 120.
