function safeUrl(req) {
  const requested = req.query && typeof req.query.url === "string" ? req.query.url : "";
  if (requested && requested.length <= 2048) return requested;
  const host = req.headers && req.headers.host ? req.headers.host : "your-vercel-project.vercel.app";
  const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}/`;
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fallbackSvg(url) {
  const display = url.length > 76 ? url.slice(0, 73) + "..." : url;
  return [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"220\" height=\"220\" viewBox=\"0 0 220 220\" role=\"img\" aria-label=\"QR code fallback\">",
    "<rect width=\"220\" height=\"220\" rx=\"12\" fill=\"#fffdf7\"/>",
    "<rect x=\"10\" y=\"10\" width=\"200\" height=\"200\" rx=\"10\" fill=\"#dff4f8\" stroke=\"#0b6387\" stroke-width=\"2\"/>",
    "<text x=\"110\" y=\"54\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\" font-size=\"16\" font-weight=\"700\" fill=\"#22302f\">Launch Link</text>",
    "<text x=\"110\" y=\"88\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\" font-size=\"11\" fill=\"#0b6387\">QR package unavailable</text>",
    "<text x=\"110\" y=\"122\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\" font-size=\"10\" fill=\"#22302f\">Open or copy this URL:</text>",
    `<foreignObject x="24" y="132" width="172" height="52"><div xmlns="http://www.w3.org/1999/xhtml" style="font:700 11px Arial,sans-serif;color:#0b6387;overflow-wrap:anywhere;text-align:center;">${esc(display)}</div></foreignObject>`,
    "</svg>"
  ].join("");
}

module.exports = async function qrHandler(req, res) {
  const url = safeUrl(req);
  try {
    const QRCode = require("qrcode");
    const svg = await QRCode.toString(url, {
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
    res.statusCode = 200;
    res.setHeader("content-type", "image/svg+xml; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(fallbackSvg(url));
  }
};
