/* ============================================================================
   providers.js — Read-only: which model providers are usable on this server.
   ----------------------------------------------------------------------------
   The UI calls this to populate the provider selector. It only reports
   id/label/availability/default model — never API keys.
============================================================================ */

const llm = require("./llm.js");

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

module.exports = async function providersHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET") {
    send(res, 405, { ok: false, errors: ["Use GET to list available providers."] });
    return;
  }

  const providers = llm.availableProviders();
  send(res, 200, {
    ok: true,
    default: llm.DEFAULT_PROVIDER,
    any_available: providers.some(function (p) { return p.available; }),
    providers: providers
  });
};
