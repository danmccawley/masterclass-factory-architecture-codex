// lib/renderers/blueprint.js
//
// Course-blueprint generation, extracted from api/generate.js (Sprint 3, step 4
// — behavior-preserving). This module OWNS buildCourseBlueprint(), which was
// previously inline in generate.js: it derives the fixed six-module course
// blueprint (orientation -> knowledge base -> concepts -> practice -> deep dives
// -> assessment), apportions the teaching-slide budget across the modules, and
// stamps tier / standard / deep-dive expectations.
//
// The logic is IDENTICAL to the prior inline code: same module table, same
// proportional slide apportionment with the last module absorbing the
// remainder, same return shape. Nothing about WHAT is rendered changed.
//
// Dependency injection: buildCourseBlueprint needs four brief-derived helpers
// (classTierSpec, totalSlideTarget, knowledgeBaseStandard, wantsDeepDives) that
// remain in generate.js because each is used in many other places there.
// Requiring generate.js back would be circular, so the call site passes them in
// via a deps object. This keeps a single source of truth for those helpers and
// makes this module's external dependencies explicit. (slugify/baseUrl have the
// same shape in lib/publish/github.js — see the lib/util.js follow-up.)
"use strict";

function buildCourseBlueprint(brief, generatedShell, deps) {
  const { classTierSpec, totalSlideTarget, knowledgeBaseStandard, wantsDeepDives } = deps;
  const tier = classTierSpec(brief);
  const total = totalSlideTarget(brief);
  const teaching = Math.max(1, total - 1);
  const standard = knowledgeBaseStandard(brief);
  const modules = [
    ["Orientation and learner baseline", 0.08, "Set the purpose, audience floor, assumptions, and mastery target."],
    ["Knowledge base and source boundary", 0.12, "Show what the approved sources support, what is missing, and what must not be invented."],
    ["Core concepts and vocabulary", 0.18, "Teach the essential terms, mental models, and decision points."],
    ["Guided practice and examples", 0.22, "Work through realistic cases, common mistakes, checks, and facilitator prompts."],
    ["Deep dives, edge cases, and quality risks", 0.22, "Add expert detail, safety cautions, disagreements, and advanced transfer examples."],
    ["Assessment, transfer, and works cited", 0.18, "Prove mastery, capture participation, and close with source transparency."]
  ];
  let used = 0;
  return {
    tier: tier.label,
    slide_target: total,
    teaching_slide_target: teaching,
    knowledge_standard: standard,
    approved_before_generation: true,
    modules: modules.map((item, index) => {
      const slides = index === modules.length - 1 ? Math.max(1, teaching - used) : Math.max(1, Math.round(teaching * item[1]));
      used += slides;
      return {
        order: index + 1,
        title: item[0],
        slide_budget: slides,
        goal: item[2],
        deep_dive_expectation: wantsDeepDives(brief) ? "substantive deep dives where required by tier and setting" : "no deep dives selected"
      };
    }),
    lesson_sections: generatedShell && generatedShell.lesson_plan ? generatedShell.lesson_plan.length : 0
  };
}

module.exports = {
  buildCourseBlueprint: buildCourseBlueprint
};
