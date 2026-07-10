"use strict";

const MODEL_CONFIG = Object.freeze({
  reasoning: process.env.OPENAI_REASONING_MODEL || process.env.OPENAI_MODEL || "gpt-5.5",
  rendering: process.env.OPENAI_RENDERING_MODEL || "gpt-5.5-mini",
  research: process.env.OPENAI_RESEARCH_MODEL || "gpt-5.5",
  qa: process.env.OPENAI_QA_MODEL || process.env.OPENAI_MODEL || "gpt-5.5",
  fallback: ["gpt-5.4", "gpt-4.1"]
});

function modelFor(stage) {
  if (stage === "rendering") return MODEL_CONFIG.rendering;
  if (stage === "research") return MODEL_CONFIG.research;
  if (stage === "qa") return MODEL_CONFIG.qa;
  return MODEL_CONFIG.reasoning;
}

function modelLadder(stage) {
  return Array.from(new Set([modelFor(stage)].concat(MODEL_CONFIG.fallback).filter(Boolean)));
}

module.exports = { MODEL_CONFIG: MODEL_CONFIG, modelFor: modelFor, modelLadder: modelLadder };
