const QRCode = require("qrcode");

function safeUrl(req) {
  const requested = req.query && typeof req.query.url === "string" ? req.query.url : "";
  if (requested && requested.length <= 2048) return requested;
  const host = req.headers && req.headers.host ? req.headers.host : "your-vercel-project.vercel.app";
  const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}/`;
}

module.exports = async function qrHandler(req, res) {
  try {
    const svg = await QRCode.toString(safeUrl(req), {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220
    });
    res.statusCode = 200;
    res.setHeader("content-type", "image/svg+xml; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=300");
    res.end(svg);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, errors: [error.message] }));
  }
};
