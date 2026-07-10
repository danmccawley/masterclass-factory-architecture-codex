"use strict";

const { createOpenAIClient } = require("../../src/util/config/openai-client.js");
const { validateOpenAIKey, openAIKey } = require("../../src/util/config/env.js");
const { MODEL_CONFIG } = require("../../src/util/config/models.js");

module.exports = async function verifyOpenAIHandler(req, res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  const localProblem = validateOpenAIKey(openAIKey());
  if (localProblem) {
    res.end(JSON.stringify({ ok: false, problem: localProblem, models: MODEL_CONFIG }, null, 2));
    return;
  }
  try {
    const client = createOpenAIClient();
    const live = await client.verifyLiveKey();
    res.end(JSON.stringify(Object.assign({ models: MODEL_CONFIG }, live), null, 2));
  } catch (error) {
    res.end(JSON.stringify({ ok: false, problem: error.message, models: MODEL_CONFIG }, null, 2));
  }
};
