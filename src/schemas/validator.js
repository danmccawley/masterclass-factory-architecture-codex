"use strict";

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  return typeof value;
}

function pathOf(path) {
  return path.length ? path.join(".").replace(/\.\[/g, "[") : "value";
}

function validateValue(schema, value, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (schema.required && value === undefined) {
    errors.push(pathOf(path) + " is required.");
    return;
  }
  if (value === undefined) return;
  if (schema.type && schema.type !== "integer" && typeOf(value) !== schema.type) {
    errors.push(pathOf(path) + " must be " + schema.type + ", not " + typeOf(value) + ".");
    return;
  }
  if (schema.enum && schema.enum.indexOf(value) === -1) {
    errors.push(pathOf(path) + " must be one of: " + schema.enum.join(", ") + ".");
  }
  if (schema.type === "string") {
    if (schema.minLength && value.length < schema.minLength) errors.push(pathOf(path) + " is too short.");
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(pathOf(path) + " must be an ISO date/time.");
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (schema.type === "integer" && !Number.isInteger(value)) errors.push(pathOf(path) + " must be an integer.");
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(pathOf(path) + " must be at least " + schema.minimum + ".");
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(pathOf(path) + " must be no more than " + schema.maximum + ".");
  }
  if (schema.type === "array") {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(pathOf(path) + " must contain at least " + schema.minItems + " item(s).");
    value.forEach(function (item, index) {
      validateValue(schema.items || {}, item, path.concat("[" + index + "]"), errors);
    });
  }
  if (schema.type === "object") {
    const props = schema.properties || {};
    Object.keys(props).forEach(function (key) {
      validateValue(props[key], value[key], path.concat(key), errors);
    });
    if (schema.additionalProperties === false) {
      Object.keys(value).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) errors.push(pathOf(path.concat(key)) + " is not allowed.");
      });
    }
  }
}

function validateSchema(schema, value) {
  const errors = [];
  validateValue(schema, value, [], errors);
  return { ok: errors.length === 0, errors: errors };
}

function assertValid(schema, value, label) {
  const result = validateSchema(schema, value);
  if (!result.ok) {
    const error = new Error((label || "Payload") + " failed schema validation: " + result.errors.join(" "));
    error.validation_errors = result.errors;
    throw error;
  }
  return value;
}

module.exports = {
  validateSchema: validateSchema,
  assertValid: assertValid,
  _internal: { typeOf: typeOf, isPlainObject: isPlainObject }
};
