"use strict";

function parseSlides(deliverable) {
  if (!deliverable || deliverable.kind !== "slide_deck") return [];
  try { return JSON.parse(deliverable.content).slides || []; } catch (error) { return []; }
}

function runQAGate(sealedCore, plan, deliverables, brief) {
  const issues = [];
  const known = Object.create(null);
  sealedCore.items.forEach(function (item) { known[item.id] = true; });
  deliverables.forEach(function (deliverable) {
    (deliverable.core_item_ids || []).forEach(function (id) {
      if (!known[id]) issues.push(deliverable.kind + " references non-core item " + id + ".");
    });
    if (!deliverable.provenance_map || !deliverable.provenance_map.length) issues.push(deliverable.kind + " has no provenance map.");
  });
  plan.outcomes.forEach(function (outcome) {
    const mapped = plan.assessments.some(function (assessment) { return assessment.outcome_id === outcome.id; });
    if (!mapped) issues.push("Outcome " + outcome.id + " has no assessment.");
  });
  plan.assessments.forEach(function (assessment) {
    if (!assessment.core_item_ids.length) issues.push("Assessment " + assessment.id + " has no core evidence.");
  });
  const totalMinutes = plan.modules.reduce(function (sum, module) { return sum + module.minutes; }, 0);
  const tolerance = Math.max(1, Math.round(brief.duration_minutes * 0.1));
  if (Math.abs(totalMinutes - brief.duration_minutes) > tolerance) issues.push("Timing is outside the requested duration tolerance.");
  const slideDeck = deliverables.filter(function (d) { return d.kind === "slide_deck"; })[0];
  if (slideDeck && parseSlides(slideDeck).length < 12) issues.push("Slide deck is too short for a masterclass.");
  return {
    ok: issues.length === 0,
    issues: issues,
    checks: {
      provenance_coverage: issues.filter(function (i) { return /provenance|non-core/.test(i); }).length === 0,
      outcome_assessment_alignment: issues.filter(function (i) { return /Outcome|Assessment/.test(i); }).length === 0,
      timing_accuracy: Math.abs(totalMinutes - brief.duration_minutes) <= tolerance,
      reading_level_target: brief.audience.reading_grade_cap
    }
  };
}

module.exports = { runQAGate: runQAGate };
