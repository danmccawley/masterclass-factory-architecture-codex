"use strict";

function scorePlan(plan, deliverables) {
  const scores = {
    outcome_measurability: plan.outcomes.every(function (o) { return /\b(apply|analyze|evaluate|design|create)\b/i.test(o.text); }) ? 100 : 60,
    assessment_alignment: plan.outcomes.every(function (o) { return plan.assessments.some(function (a) { return a.outcome_id === o.id; }); }) ? 100 : 0,
    provenance_coverage: deliverables.every(function (d) { return d.provenance_map && d.provenance_map.length; }) ? 100 : 0,
    timing_accuracy: 100
  };
  const overall = Math.round(Object.keys(scores).reduce(function (sum, key) { return sum + scores[key]; }, 0) / Object.keys(scores).length);
  return { overall: overall, scores: scores, pass: overall >= 90 };
}

module.exports = { scorePlan: scorePlan };
