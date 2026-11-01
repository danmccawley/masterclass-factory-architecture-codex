const crypto = require("crypto");

// Header-only authentication shared by the factory and generated class runtimes.
// Keep x-admin-key precedence and raw Authorization support for existing callers.
function adminKeyMatches(req, configured) {
  const headers = req.headers || {};
  const value = headers["x-admin-key"] || headers.authorization;
  if (typeof value !== "string") return false;
  const supplied = value.replace(/^Bearer\s+/i, "").trim();
  const expected = String(configured || "").trim();
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { adminKeyMatches };
