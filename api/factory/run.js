"use strict";

const { runFactory } = require("../../src/bernard/operator-actions.js");
const { redactSecrets } = require("../../src/util/config/env.js");

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
  return new Promise(function (resolve, reject) {
    let raw = "";
    req.on("data", function (chunk) { raw += chunk; });
    req.on("end", function () {
      try { resolve(JSON.parse(raw || "{}")); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

module.exports = async function factoryRunHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { ok: false, errors: ["Use POST."] });
  try {
    const body = await readBody(req);
    const result = await runFactory(body.brief || body, {
      proceedWithGaps: Boolean(body.proceed_with_gaps),
      approvedBy: body.approved_by || "operator",
      approvalNote: body.approval_note || ""
    });
    send(res, result.ok ? 200 : 422, result);
  } catch (error) {
    send(res, 500, { ok: false, errors: [redactSecrets(error.message)] });
  }
};
