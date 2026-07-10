"use strict";

const assert = require("assert");
const { BriefSchema } = require("../../src/schemas/index.js");
const { toOpenAIJsonSchema } = require("../../src/util/config/openai-client.js");

const converted = toOpenAIJsonSchema(BriefSchema);
assert.ok(Array.isArray(converted.required), "root required array should be standard JSON Schema");
assert.ok(converted.required.indexOf("topic") !== -1, "topic should be required");
assert.strictEqual(converted.properties.topic.required, undefined, "local required flag should be stripped");
assert.ok(Array.isArray(converted.properties.audience.required), "nested object should get required array");
assert.strictEqual(converted.additionalProperties, false, "strict object should reject extra properties");
console.log("OPENAI SCHEMA RESULTS: all green");
