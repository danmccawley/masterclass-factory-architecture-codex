const { validateBrief } = require("../brief-validator.js");
const template = require("../brief.template.json");

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch (error) {
      return Promise.reject(new Error("Request body is not valid JSON."));
    }
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw.trim()) {
        reject(new Error("Request body is empty."));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function briefHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET") {
    send(res, 200, {
      ok: true,
      endpoint: "/api/brief",
      accepts: "POST application/json",
      contract: "brief.template.json"
    });
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { ok: false, errors: ["Use POST with a brief.json body."] });
    return;
  }

  try {
    const brief = await readBody(req);
    const result = validateBrief(brief, template);
    if (!result.ok) {
      send(res, 422, { ok: false, errors: result.errors });
      return;
    }
    send(res, 200, {
      ok: true,
      message: "brief.json validates against brief.template.json.",
      brief
    });
  } catch (error) {
    send(res, 400, { ok: false, errors: [error.message] });
  }
};
