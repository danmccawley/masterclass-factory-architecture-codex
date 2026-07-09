# OpenAI-Native Masterclass Factory

This branch adds the OpenAI-native factory backbone behind the existing prototype.

## Non-Negotiables

- OpenAI APIs only. The executable model chokepoint is `api/llm.js`, and it exposes only `openai`.
- Every deliverable is rendered from a sealed Knowledge Core.
- Renderers may reference only `CoreItem.id` values from the sealed core.
- Fact changes require reopening the core through an advancement opportunity.
- Failures return actionable operator choices; they do not silently downgrade the class.

## Runtime Flow

```text
Brief
  -> research-engine/gather-sources
  -> research-engine/verify-sources
  -> knowledge-core/assemble-core
  -> knowledge-core/seal-core
  -> curriculum-plan/build-plan
  -> renderers/*
  -> qa/qa-agent + qa/evals
  -> package/build-package
```

## Key Files

- `src/schemas/*` — six core contracts: Brief, SourceCandidate, CoreItem, SealedCore, CurriculumPlan, Deliverable.
- `src/util/config/openai-client.js` — Responses API client with Structured Outputs schema conversion.
- `src/bernard/operator-actions.js` — request-scoped orchestration for Bernard.
- `api/factory/run.js` — single endpoint to run the factory pipeline.
- `api/factory/verify-openai.js` — live OpenAI key check.

## Verification

Run:

```bash
node test/harness.js
for f in test/*.test.js test/factory/*.test.js; do node "$f" || exit 1; done
```

The factory regression test asserts that a professional fiber-installation class produces a real masterclass-depth slide count, not a five-slide stub.
