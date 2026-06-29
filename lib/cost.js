// lib/cost.js
//
// Per-build cost ledger, extracted from api/generate.js (Sprint 3, step 2 —
// behavior-preserving). This module now OWNS the module-scoped ledger that was
// previously `_costLedger` inside generate.js, plus the OpenAI/Tavily spend
// recording helpers that wrote into it.
//
// Semantics are IDENTICAL to the prior inline code: the ledger is a module
// singleton reset at the start of each generate request (the standard Node
// serverless model — one in-flight build per instance). If request-level
// concurrency is ever enabled, thread the ledger through call args instead.
// Same null-guards, same numbers; the kb-budget.js math is untouched.
"use strict";

const { readOpenAIUsage, createBudgetLedger } = require("../api/kb-budget.js");

// Module-scoped per-build ledger. null => no build in flight; every recorder
// no-ops until startLedger() installs one.
let _costLedger = null;

// Start a fresh per-build ledger. A budget of 0/absent means "no budget set" —
// the ledger still tracks real spend, it just never raises an overage notice.
function startLedger(budgetUsd) {
  _costLedger = createBudgetLedger(budgetUsd);
  return _costLedger;
}

function recordOpenAISpend(payload, model) {
  if (!_costLedger) return;
  const u = readOpenAIUsage(payload);
  if (u.total_tokens > 0) _costLedger.record({ kind: "openai", model: model, input_tokens: u.input_tokens, output_tokens: u.output_tokens });
}

function recordTavilySpend(searches) {
  if (!_costLedger) return;
  _costLedger.record({ kind: "tavily", searches: Number(searches) || 0 });
}

// Record measured usage from an llm.completeJson result (provider-agnostic).
function recordLlmUsage(result) {
  if (result && result.usage && _costLedger && result.usage.total_tokens > 0) {
    _costLedger.record({
      kind: result.provider,
      model: result.model,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens
    });
  }
}

// Spend summary for the build response, or null when no ledger is active.
function summary() {
  return _costLedger ? _costLedger.summary() : null;
}

module.exports = {
  startLedger: startLedger,
  recordOpenAISpend: recordOpenAISpend,
  recordTavilySpend: recordTavilySpend,
  recordLlmUsage: recordLlmUsage,
  summary: summary
};
