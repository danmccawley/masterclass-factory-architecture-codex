// api/theme.js
//
// Class theming. A "theme" is a set of values for the class template's existing
// CSS-variable contract (see template/index.html :root). Two front-ends resolve
// to the SAME token set:
//   • a curated dropdown of vetted NAMED_THEMES, and
//   • a natural-language description -> LLM -> palette (the handler below).
//
// Every palette — named, custom, or LLM-produced — passes legibility guardrails
// (WCAG contrast) so a class can never render unreadable text. The default
// (no theme chosen) leaves the template's built-in look untouched.
"use strict";

let budget = null;
const llm = require("./llm.js");
function asSystemUser(messages) {
  let system = "", user = "";
  (messages || []).forEach(function (m) {
    if (!m) return;
    if (m.role === "system") system += (system ? "\n" : "") + (m.content || "");
    else user += (user ? "\n" : "") + (m.content || "");
  });
  return { system: system, user: user };
}
try { budget = require("./kb-budget.js"); } catch (e) { budget = null; }

// The themeable token contract. Maps our palette keys -> the template's CSS vars.
const TOKEN_TO_CSSVAR = {
  bg: "--bg", bg2: "--bg2", ink: "--ink", dim: "--dim", faint: "--faint",
  accent: "--amber", accentGlow: "--amber-glow",
  accent2: "--teal", accent2Glow: "--teal-glow",
  line: "--line", card: "--card", card2: "--card2",
  paper: "--paper", paperInk: "--paper-ink", paperLine: "--paper-line"
};
const TOKEN_KEYS = Object.keys(TOKEN_TO_CSSVAR);

// The template's built-in palette (tech-noir). Used as the default and as the
// fill for any token a custom/LLM palette omits.
const DEFAULT_PALETTE = {
  bg: "#070809", bg2: "#0c0f14", ink: "#eef2f7", dim: "#8b96a6", faint: "#4a5360",
  accent: "#e6a042", accentGlow: "#ffc977", accent2: "#46c8c0", accent2Glow: "#7af0e8",
  line: "#1c232e", card: "#10141b", card2: "#151a23",
  paper: "#ece1c8", paperInk: "#241f17", paperLine: "#c2b394"
};

// Curated, vetted themes. Each is a full token set; all pass the guardrails
// (locked by tests). Keep these legible-by-construction.
const NAMED_THEMES = {
  "tech-noir": { label: "Tech Noir", palette: DEFAULT_PALETTE },
  "cyberpunk": { label: "Cyberpunk", palette: {
    bg: "#0a0612", bg2: "#140a22", ink: "#f4eaff", dim: "#a98fd6", faint: "#5b4a7a",
    accent: "#ff2e88", accentGlow: "#ff7ab8", accent2: "#22e6ff", accent2Glow: "#86f3ff",
    line: "#2a1b40", card: "#160c26", card2: "#1f1133",
    paper: "#ece1c8", paperInk: "#241f17", paperLine: "#c2b394" } },
  "post-apocalyptic": { label: "Post-Apocalyptic", palette: {
    bg: "#100d0a", bg2: "#191410", ink: "#ece3d6", dim: "#9c8f7d", faint: "#574d40",
    accent: "#c2622d", accentGlow: "#e69552", accent2: "#7d8a6a", accent2Glow: "#aab896",
    line: "#2a2218", card: "#171210", card2: "#201913",
    paper: "#e4d8c0", paperInk: "#221d15", paperLine: "#b3a482" } },
  "heavenly": { label: "Heavenly", palette: {
    bg: "#f7f9fc", bg2: "#eef2fa", ink: "#1c2433", dim: "#5f6b80", faint: "#9aa6ba",
    accent: "#a58520", accentGlow: "#e6c659", accent2: "#6c8fd6", accent2Glow: "#9bb6ec",
    line: "#dde3ee", card: "#ffffff", card2: "#f1f5fb",
    paper: "#fffdf6", paperInk: "#2a2620", paperLine: "#e3dcc7" } },
  "serenity": { label: "Serenity", palette: {
    bg: "#0e1820", bg2: "#13212c", ink: "#e7f1f4", dim: "#8aa6b0", faint: "#4d6670",
    accent: "#7fd1c4", accentGlow: "#aae8de", accent2: "#9db8d8", accent2Glow: "#c2d6ec",
    line: "#1e2f3a", card: "#13202a", card2: "#1a2a35",
    paper: "#eef0e4", paperInk: "#212318", paperLine: "#c6c8b2" } },
  "oasis": { label: "Oasis", palette: {
    bg: "#0c1410", bg2: "#121d16", ink: "#eaf3ea", dim: "#8fae97", faint: "#506a58",
    accent: "#e0b04a", accentGlow: "#f3cd77", accent2: "#3fb98a", accent2Glow: "#73e0b3",
    line: "#1d2c22", card: "#121d16", card2: "#19271d",
    paper: "#efe6cf", paperInk: "#232014", paperLine: "#c9bc97" } },
  "dune": { label: "Dune", palette: {
    bg: "#1a120a", bg2: "#241910", ink: "#f3e7d2", dim: "#bfa888", faint: "#74614a",
    accent: "#e0922e", accentGlow: "#f4b85e", accent2: "#9c6b3f", accent2Glow: "#c79366",
    line: "#332516", card: "#211710", card2: "#2c2016",
    paper: "#efe2c6", paperInk: "#251c10", paperLine: "#c8b58a" } },
  "winter": { label: "Winter", palette: {
    bg: "#0d1620", bg2: "#13202c", ink: "#eaf2fb", dim: "#90a4ba", faint: "#4e6072",
    accent: "#6fb7e8", accentGlow: "#a3d6f5", accent2: "#c9d6e4", accent2Glow: "#e6eef6",
    line: "#1d2c3a", card: "#13202c", card2: "#192a38",
    paper: "#f0f3f7", paperInk: "#1f2630", paperLine: "#cdd6e0" } },
  "summer": { label: "Summer", palette: {
    bg: "#fff8ec", bg2: "#fdeccf", ink: "#3a2a14", dim: "#8a6f49", faint: "#bfa885",
    accent: "#c55530", accentGlow: "#ff9168", accent2: "#198f7e", accent2Glow: "#5fd8c6",
    line: "#f0dcbd", card: "#fffdf8", card2: "#fdf2df",
    paper: "#fffaf0", paperInk: "#2e2516", paperLine: "#e6d3b0" } },
  "pacific-northwest": { label: "Pacific Northwest", palette: {
    bg: "#0f1714", bg2: "#16211d", ink: "#e6efe9", dim: "#8aa39a", faint: "#4f655c",
    accent: "#5a9e7a", accentGlow: "#88c4a3", accent2: "#7ea8b8", accent2Glow: "#abccd8",
    line: "#1f2e28", card: "#14201b", card2: "#1b2a24",
    paper: "#e8ebe2", paperInk: "#1e231c", paperLine: "#c3c8b8" } },
  "ocean": { label: "Ocean", palette: {
    bg: "#061620", bg2: "#0a2230", ink: "#e3f2f7", dim: "#82a8b6", faint: "#456676",
    accent: "#2fb6d6", accentGlow: "#6fdcf0", accent2: "#3f7fb5", accent2Glow: "#74acdb",
    line: "#123040", card: "#0a222f", card2: "#0f2c3b",
    paper: "#e6eef0", paperInk: "#19232a", paperLine: "#bcccd2" } }
};

// ---- color math (WCAG) ----
function clampHex(v) {
  let s = String(v == null ? "" : v).trim();
  if (s[0] !== "#") s = "#" + s;
  // expand #abc -> #aabbcc
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toLowerCase();
}
function toRgb(hex) {
  const h = clampHex(hex) || "#000000";
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}
function toHex(r, g, b) {
  const c = (n) => { const x = Math.max(0, Math.min(255, Math.round(n))).toString(16); return x.length === 1 ? "0" + x : x; };
  return "#" + c(r) + c(g) + c(b);
}
function relLuminance(hex) {
  const { r, g, b } = toRgb(hex);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
// Nudge `fg` toward black or white (whichever the bg is farther from) until it
// meets `min` contrast against `bg`. Returns the adjusted hex (or original if ok).
function nudgeForContrast(fg, bg, min) {
  if (contrastRatio(fg, bg) >= min) return clampHex(fg) || fg;
  const bgLight = relLuminance(bg) > 0.5;
  const target = bgLight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  let { r, g, b } = toRgb(fg);
  for (let i = 0; i < 20; i += 1) {
    r += (target.r - r) * 0.18; g += (target.g - g) * 0.18; b += (target.b - b) * 0.18;
    const cand = toHex(r, g, b);
    if (contrastRatio(cand, bg) >= min) return cand;
  }
  return toHex(target.r, target.g, target.b);
}

// Normalize an arbitrary partial palette: clamp hexes, fill missing from default.
function normalizePalette(input) {
  const out = {};
  TOKEN_KEYS.forEach((k) => {
    const c = clampHex(input && input[k]);
    out[k] = c || DEFAULT_PALETTE[k];
  });
  return out;
}

// Enforce legibility. Adjusts foreground tokens against their backgrounds so the
// class is always readable. Returns { palette, warnings, adjusted }.
function ensureLegible(input) {
  const p = normalizePalette(input);
  const warnings = [];
  let adjusted = false;
  const fix = (key, bg, min, label) => {
    const before = p[key];
    const after = nudgeForContrast(before, bg, min);
    if (after !== before) { p[key] = after; adjusted = true; warnings.push(label + " adjusted for legibility (" + before + " -> " + after + ")"); }
  };
  fix("ink", p.bg, 4.5, "Body text");          // main reading contrast
  fix("dim", p.bg, 3.0, "Secondary text");
  fix("accent", p.bg, 3.0, "Primary accent");
  fix("accent2", p.bg, 3.0, "Secondary accent");
  fix("paperInk", p.paper, 4.5, "Deep-dive text"); // parchment layer
  return { palette: p, warnings: warnings, adjusted: adjusted };
}

// Emit the CSS that overrides the template defaults. Empty string => no theme
// chosen => template's built-in look is untouched (no regression).
function themeCssOverride(palette) {
  if (!palette) return "";
  const p = normalizePalette(palette);
  const decls = TOKEN_KEYS.map((k) => TOKEN_TO_CSSVAR[k] + ":" + p[k] + ";").join(" ");
  return ":root{ " + decls + " }";
}

// Resolve a brief.theme into a final, legible CSS override string.
// theme shapes accepted:
//   { mode:"named", named:"dune" }
//   { mode:"custom", tokens:{ accent:"#..", bg:"#.." , ... } }
//   { mode:"described", tokens:{...} }  (tokens pre-resolved by /api/theme)
// Anything missing/unknown => "" (default look).
function resolveThemeCss(theme) {
  if (!theme || typeof theme !== "object") return "";
  let base = null;
  if (theme.mode === "named" || theme.named) {
    const key = String(theme.named || theme.name || "").toLowerCase();
    if (key && key !== "tech-noir" && NAMED_THEMES[key]) base = NAMED_THEMES[key].palette;
    else return ""; // default/unknown -> built-in look
  } else if (theme.tokens && typeof theme.tokens === "object") {
    base = theme.tokens;
  } else {
    return "";
  }
  return themeCssOverride(ensureLegible(base).palette);
}

// Build the catalog the wizard renders (key, label, swatch colors).
function themeCatalog() {
  return Object.keys(NAMED_THEMES).map((key) => {
    const p = NAMED_THEMES[key].palette;
    return { key: key, label: NAMED_THEMES[key].label, swatch: { bg: p.bg, accent: p.accent, accent2: p.accent2, ink: p.ink } };
  });
}

// Parse an LLM response (which may be wrapped in prose/fences) into a palette.
function paletteFromLLMJson(text) {
  let s = String(text || "").trim().replace(/```json|```/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  let obj = null;
  try { obj = JSON.parse(s); } catch (e) { obj = null; }
  if (!obj || typeof obj !== "object") return null;
  // accept either flat tokens or { palette: {...} }
  const src = obj.palette && typeof obj.palette === "object" ? obj.palette : obj;
  const mapped = {};
  // tolerate common aliases the model might use
  const alias = {
    background: "bg", background2: "bg2", surface: "card", surface2: "card2",
    text: "ink", textMuted: "dim", muted: "dim", primary: "accent", primaryGlow: "accentGlow",
    secondary: "accent2", secondaryGlow: "accent2Glow", border: "line",
    deepDive: "paper", deepDiveText: "paperInk", deepDiveLine: "paperLine"
  };
  Object.keys(src).forEach((k) => {
    const key = TOKEN_KEYS.indexOf(k) !== -1 ? k : alias[k];
    if (key) { const c = clampHex(src[k]); if (c) mapped[key] = c; }
  });
  if (!Object.keys(mapped).length) return null;
  return normalizePalette(mapped);
}

// The system prompt that asks the model for a palette as strict JSON.
function themePromptMessages(description) {
  const tokens = TOKEN_KEYS.join(", ");
  return [
    { role: "system", content:
      "You are a color designer for an interactive online class UI. Given a mood/theme description, return ONLY a JSON object (no prose, no code fences) mapping each of these tokens to a hex color: " +
      tokens + ". Rules: the UI is text-heavy, so body text (ink) MUST be highly readable against the background (bg); pick a coherent palette that matches the described mood; 'accent' is the primary highlight color and 'accent2' the secondary; 'paper'/'paperInk'/'paperLine' are a separate 'deep-dive' reading panel (paper is its background, paperInk its text — they must contrast well). Use 6-digit hex like #1a2b3c." },
    { role: "user", content: "Theme description: " + String(description || "").slice(0, 400) }
  ];
}

// ---- HTTP handler: natural-language description -> palette ----
// POST { description } -> { ok, palette, css, warnings, source }
// Degrades safely: if no key or the model fails, returns ok:false (caller keeps default).
module.exports = async function themeHandler(req, res) {
  function send(status, body) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.end(JSON.stringify(body));
  }
  if (req.method === "OPTIONS") { send(204, {}); return; }
  if (req.method === "GET") { send(200, { ok: true, themes: themeCatalog() }); return; }
  if (req.method !== "POST") { send(405, { ok: false, error: "method not allowed" }); return; }

  let body = "";
  await new Promise((resolve) => { req.on("data", (c) => { body += c; }); req.on("end", resolve); });
  let parsed = {};
  try { parsed = JSON.parse(body || "{}"); } catch (e) { parsed = {}; }
  const description = String(parsed.description || "").trim();
  if (!description) { send(422, { ok: false, error: "description required" }); return; }

  const engine = (parsed.engine && typeof parsed.engine === "object") ? parsed.engine : {};
  const provider = llm.resolveProvider(engine.provider);
  if (!llm.isAvailable(provider)) {
    send(503, { ok: false, error: provider === "openai"
      ? "theme AI needs OPENAI_API_KEY on the server"
      : "theme AI needs an API key for the selected provider on the server" });
    return;
  }
  const model = provider === "openai" ? (process.env.OPENAI_THEME_MODEL || "gpt-4o-mini") : (engine.model || undefined);
  try {
    const su = asSystemUser(themePromptMessages(description));
    const result = await llm.completeText({
      provider: provider, model: model, stage: "theme",
      system: su.system, user: su.user, temperature: 0.7, timeoutMs: 20000
    });
    let usd = null;
    if (budget && budget.tokenCostUsd && result.usage) {
      try { usd = budget.tokenCostUsd(result.usage.input_tokens, result.usage.output_tokens, result.model); } catch (e) {}
    }
    const raw = paletteFromLLMJson(result.text);
    if (!raw) { send(502, { ok: false, error: "could not parse a palette from the model" }); return; }
    const legible = ensureLegible(raw);
    send(200, {
      ok: true,
      source: "llm",
      model: result.model,
      palette: legible.palette,
      css: themeCssOverride(legible.palette),
      warnings: legible.warnings,
      cost_usd: (typeof usd === "number" ? Math.round(usd * 1e6) / 1e6 : null)
    });
  } catch (e) {
    send(502, { ok: false, error: "theme request failed: " + (e && e.message ? e.message : "unknown") });
  }
};

module.exports._internal = {
  TOKEN_KEYS: TOKEN_KEYS,
  DEFAULT_PALETTE: DEFAULT_PALETTE,
  NAMED_THEMES: NAMED_THEMES,
  clampHex: clampHex,
  contrastRatio: contrastRatio,
  nudgeForContrast: nudgeForContrast,
  normalizePalette: normalizePalette,
  ensureLegible: ensureLegible,
  themeCssOverride: themeCssOverride,
  resolveThemeCss: resolveThemeCss,
  themeCatalog: themeCatalog,
  paletteFromLLMJson: paletteFromLLMJson,
  themePromptMessages: themePromptMessages
};
