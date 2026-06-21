// api/kb-budget.js
//
// Budget governor (spec §9). The human sets a spend budget for the class; the
// factory tracks real expense against it and, when an action would push the
// build past budget, NOTIFIES with an estimated overage and the human's options
// (raise budget / spend anyway / stop). It NEVER refuses — the human is the only
// off-switch. This module is pure and deterministic; generate.js feeds it real
// token usage captured at the OpenAI/Tavily call sites.
//
// Costs are computed from REAL usage where available (token counts returned by
// the API). The per-token PRICES are estimates seeded from public list pricing
// and are meant to be tuned against real bills — they are the one approximate
// input; the token counts themselves are measured, not guessed.
"use strict";

// USD per 1,000,000 tokens. Tune against real invoices. Per-model overrides win
// on substring match; otherwise the blended default applies.
const PRICING = {
  default_input_per_1m: 2.50,
  default_output_per_1m: 10.00,
  tavily_per_search: 0.008, // ~$8 per 1000 searches (estimate)
  models: {
    "gpt-4o-mini": { input_per_1m: 0.15, output_per_1m: 0.60 },
    "gpt-4o": { input_per_1m: 2.50, output_per_1m: 10.00 },
    "gpt-4.1-mini": { input_per_1m: 0.40, output_per_1m: 1.60 },
    "gpt-4.1": { input_per_1m: 2.00, output_per_1m: 8.00 },
    "o3": { input_per_1m: 10.00, output_per_1m: 40.00 },
    "o4-mini": { input_per_1m: 1.10, output_per_1m: 4.40 }
  }
};

// Rough token assumptions for FORECASTING upcoming work before it runs. Honest
// estimates, labeled as such; replaced by real usage once an op actually runs.
const ESTIMATES = {
  discovery_round: { searches: 3, openai_calls: 0 }, // Tavily-first; OpenAI only on fallback
  claim_extraction_per_source: { input_tokens: 4000, output_tokens: 700, model: "gpt-4o-mini" },
  authoring_batch: { input_tokens: 3500, output_tokens: 6000, model: "gpt-4o" }
};

function round6(n) { return Math.round(Number(n || 0) * 1e6) / 1e6; }

function priceForModel(model) {
  const m = String(model || "").toLowerCase();
  const keys = Object.keys(PRICING.models);
  for (let i = 0; i < keys.length; i += 1) {
    if (m.indexOf(keys[i]) !== -1) return PRICING.models[keys[i]];
  }
  return { input_per_1m: PRICING.default_input_per_1m, output_per_1m: PRICING.default_output_per_1m };
}

// Dollar cost from measured token counts.
function tokenCostUsd(inputTokens, outputTokens, model) {
  const p = priceForModel(model);
  return round6((Number(inputTokens || 0) / 1e6) * p.input_per_1m + (Number(outputTokens || 0) / 1e6) * p.output_per_1m);
}

// Extract usage from EITHER OpenAI API shape:
//   responses API     -> usage.input_tokens / output_tokens / total_tokens
//   chat completions   -> usage.prompt_tokens / completion_tokens / total_tokens
// Returns zeros when usage is absent (older payloads, errors) — never throws.
function readOpenAIUsage(payload) {
  const u = (payload && payload.usage) ? payload.usage : {};
  const input = Number(u.input_tokens != null ? u.input_tokens : (u.prompt_tokens || 0)) || 0;
  const output = Number(u.output_tokens != null ? u.output_tokens : (u.completion_tokens || 0)) || 0;
  const total = Number(u.total_tokens != null ? u.total_tokens : (input + output)) || 0;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

// Estimated USD for an upcoming op (used for cost-to-complete forecasting).
function estimateOperationUsd(kind, count) {
  const n = Number(count || 1);
  if (kind === "discovery_round") {
    return round6(n * ESTIMATES.discovery_round.searches * PRICING.tavily_per_search);
  }
  if (kind === "claim_extraction_per_source") {
    const e = ESTIMATES.claim_extraction_per_source;
    return round6(n * tokenCostUsd(e.input_tokens, e.output_tokens, e.model));
  }
  if (kind === "authoring_batch") {
    const e = ESTIMATES.authoring_batch;
    return round6(n * tokenCostUsd(e.input_tokens, e.output_tokens, e.model));
  }
  return 0;
}

// Per-build ledger of REAL spend. budgetUsd of 0 (or unset) means "no budget
// set" — the ledger still tracks spend, but overage checks never fire (no
// governor friction until the human actually sets a budget).
function createBudgetLedger(budgetUsd) {
  const ops = [];
  let spent = 0;
  return {
    budget_usd: Number(budgetUsd) || 0,
    // Record a real op. Shapes:
    //   { kind, model, input_tokens, output_tokens }  (OpenAI, real usage)
    //   { kind: "tavily", searches }                   (per-search)
    //   { kind, usd }                                   (explicit/precomputed)
    record: function (op) {
      op = op || {};
      let usd = Number(op.usd || 0);
      if (!usd && (op.input_tokens || op.output_tokens)) {
        usd = tokenCostUsd(op.input_tokens, op.output_tokens, op.model);
      }
      if (!usd && op.searches) usd = round6(Number(op.searches) * PRICING.tavily_per_search);
      usd = round6(usd);
      ops.push(Object.assign({}, op, { usd: usd }));
      spent = round6(spent + usd);
      return usd;
    },
    spent: function () { return round6(spent); },
    remaining: function () { return round6(this.budget_usd - spent); },
    ops: function () { return ops.slice(); },
    summary: function () {
      return {
        budget_usd: this.budget_usd,
        spent_usd: round6(spent),
        remaining_usd: round6(this.budget_usd - spent),
        op_count: ops.length,
        // Honest label: prices are estimates; token counts are measured.
        note: "Spend is computed from measured token usage at estimated per-token prices; tune PRICING against real bills."
      };
    }
  };
}

// The overage check: NOTIFY, never refuse. Given the ledger, the estimated cost
// of the next action, and an optional estimate of remaining work AFTER it, says
// whether the build would end up over budget and by how much — with options.
function checkOverage(ledger, nextOpUsd, estimatedToCompleteAfterUsd) {
  const next = Number(nextOpUsd || 0);
  const tail = Number(estimatedToCompleteAfterUsd || 0);
  const after = round6(ledger.spent() + next + tail);
  const overage = round6(after - ledger.budget_usd);
  const wouldExceed = ledger.budget_usd > 0 && overage > 0;
  return {
    would_exceed: wouldExceed,
    budget_usd: ledger.budget_usd,
    estimated_spend_after: after,
    estimated_overage_usd: wouldExceed ? overage : 0,
    // Notify, never refuse: the human always decides.
    options: wouldExceed
      ? [
          { id: "raise_budget", label: "Raise the budget", kind: "input" },
          { id: "spend_anyway", label: "Spend anyway (proceed past budget)", kind: "build" },
          { id: "stop", label: "Stop here", kind: "stop" }
        ]
      : [],
    message: wouldExceed
      ? "This step is estimated to put the build about $" + overage.toFixed(2) +
        " over your $" + Number(ledger.budget_usd).toFixed(2) +
        " budget. Nothing is blocked \u2014 raise the budget, spend anyway, or stop."
      : ""
  };
}

module.exports = {
  PRICING: PRICING,
  ESTIMATES: ESTIMATES,
  priceForModel: priceForModel,
  tokenCostUsd: tokenCostUsd,
  readOpenAIUsage: readOpenAIUsage,
  estimateOperationUsd: estimateOperationUsd,
  createBudgetLedger: createBudgetLedger,
  checkOverage: checkOverage
};
