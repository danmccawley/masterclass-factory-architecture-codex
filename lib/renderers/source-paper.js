// lib/renderers/source-paper.js
//
// Source-paper (Student Reader) rendering, extracted from api/generate.js
// (Sprint 3, module 7 — behavior-preserving). This module OWNS buildSourcePaper()
// — which assembles the cited Student Reader from the brief's setup package,
// uploads, and fetched source extracts — plus sourceText() (flattens the paper to
// the plain-text corpus the generator teaches from) and the HTML helpers that
// build it: paragraphs / sourceLabel / titleCase / sourceQuality /
// sourceQualityHtml.
//
// The logic is IDENTICAL to the prior inline code: same section structure, same
// evidence-limited warning, same per-upload fetch/media/disabled/local branches,
// same credibility/reliability scoring, same return shape. Nothing about WHAT is
// rendered changed (golden byte-identical).
//
// Dependencies go strictly DOWN the core graph: shared helpers (html/attr/text/
// list/isUrl/stripHtml/knowledgeBaseStandard/researchOwner) come from lib/util.js
// (module 4), and fetchUrlText comes from lib/core/research-engine.js (module 5).
// Nothing is required back from generate.js. sourceQualityFromBody stays in
// generate.js — it is a body-parser over already-rendered output, not a renderer
// helper.
"use strict";

const {
  html, attr, text, list, isUrl, stripHtml, knowledgeBaseStandard, researchOwner
} = require("../util.js");
const { fetchUrlText } = require("../core/research-engine.js");

function paragraphs(value) {
  const cleaned = String(value || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  return cleaned.length
    ? cleaned.map((part) => `<p>${html(part)}</p>`).join("")
    : "<p>No extractable text was available for this source.</p>";
}

function sourceLabel(source, index) {
  const value = text(source && source.path, `Source ${index + 1}`);
  try {
    if (isUrl(value)) return new URL(value).hostname.replace(/^www\./, "");
  } catch (error) {
    return value;
  }
  return value.split("/").pop() || value;
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sourceQuality(source, state) {
  const trust = text(source && source.trust, "unknown").toLowerCase();
  const type = text(source && source.type, "document").toLowerCase();
  const fetched = state && state.fetched;
  const media = type === "video" || type === "audio";
  const setup = state && state.setup;

  if (setup) {
    return {
      credibility: "Context only",
      reliability: "Limited",
      finding: "Use this setup section to understand audience, scope, and rules. Do not treat it as outside evidence."
    };
  }

  const credibility = trust === "primary"
    ? "High"
    : trust === "secondary"
      ? "Moderate"
      : "Unrated";
  let reliability = "Needs extraction";
  let finding = "Listed in the knowledge base, but not enough text was available for factual teaching claims.";

  if (fetched) {
    reliability = trust === "primary" ? "High" : "Moderate";
    finding = "Readable source text was available during generation. Use it for supported claims, and corroborate statistics, forecasts, or disputed points.";
  } else if (media) {
    reliability = "Transcript needed";
    finding = "This media can be linked for learners, but Bernard should not teach factual claims from it until a transcript or extracted notes are available.";
  }

  return { credibility, reliability, finding };
}

function sourceQualityHtml(quality) {
  return [
    "<div class=\"source-quality\">",
    `<p><strong>Credibility ranking:</strong> ${html(quality.credibility)}. <strong>Reliability ranking:</strong> ${html(quality.reliability)}.</p>`,
    `<p><strong>Information-literacy finding:</strong> ${html(quality.finding)}</p>`,
    "</div>"
  ].join("");
}

async function buildSourcePaper(brief) {
  const sections = [];
  const notes = [];
  const uploads = Array.isArray(brief.knowledge_base.uploads) ? brief.knowledge_base.uploads : [];
  const prompts = list(brief.knowledge_base.research.seed_prompts, [], 12);
  const allowWeb = brief.knowledge_base.research.allow_web !== false;
  const title = brief.meta.title || "Untitled Masterclass";
  const standard = knowledgeBaseStandard(brief);

  sections.push({
    id: "s1",
    num: "1",
    title: "Class setup, learner profile, and research rules",
    body: [
      `<p><strong>Class:</strong> ${html(title)}</p>`,
      `<p><strong>Class tier:</strong> ${html(standard.tier.label)}. <strong>Knowledge-base standard:</strong> ${html(standard.required_sources)} usable sources, including ${html(standard.required_primary_sources)} primary sources.</p>`,
      `<p><strong>Research owner:</strong> ${html(researchOwner(brief))}. <strong>Research mode:</strong> ${html(brief.knowledge_base.research.mode)}. <strong>Minimum source tier:</strong> ${html(brief.knowledge_base.credibility.min_tier)}.</p>`,
      `<p><strong>Audience floor:</strong> ${html(brief.audience.floor.background || "Not specified")} / ${html(brief.audience.floor.education || "education not specified")}.</p>`,
      `<p><strong>Language:</strong> ${html(brief.language.primary || "en")}.</p>`,
      `<p>This section is generated from the class setup package. It is allowed to guide curriculum shape, but it is not a substitute for outside evidence.</p>`,
      (standard.evidence_limited
        ? `<p><strong>⚠ Evidence-limited class.</strong> This masterclass was built by approved change order on ${html(standard.counts.total)} verified source${standard.counts.total === 1 ? "" : "s"} (${html(standard.counts.primary)} primary), which is below the ${html(standard.tier.label)} floor of ${html(standard.required_sources)}/${html(standard.required_primary_sources)}. The public evidence base for this topic is scarce. Claims are held to what the available sources support; areas where evidence is thin are flagged as open questions rather than asserted. Treat this as a source-honest orientation, not a comprehensive treatment.${brief.class_tier && brief.class_tier.evidence_limited_note ? " " + html(brief.class_tier.evidence_limited_note) : ""}</p>`
        : ""),
      sourceQualityHtml(sourceQuality({}, { setup: true }))
    ].join("")
  });

  for (let index = 0; index < uploads.length; index += 1) {
    const source = uploads[index] || {};
    const id = `s${sections.length + 1}`;
    const label = sourceLabel(source, index);
    const pathValue = text(source.path);
    const sourceType = text(source.type, "document").toLowerCase();
    const isMedia = sourceType === "video" || sourceType === "audio";
    let fetchedText = false;
    let body = `<p><strong>Source queued:</strong> ${html(pathValue || label)}.</p>`;
    body += `<p><strong>Source type:</strong> ${html(titleCase(sourceType))}. <strong>Class-maker credibility tag:</strong> ${html(titleCase(source.trust || "unknown"))}.</p>`;

    if (isMedia) {
      if (isUrl(pathValue)) body += `<p><strong>Media link:</strong> <a href="${attr(pathValue)}">${html(pathValue)}</a></p>`;
      body += "<p>Media can be linked for students. To use it as evidence, the generator needs a transcript, caption file, or extracted notes in the knowledge base.</p>";
      notes.push(`Media source queued for ${label}; transcript or extracted notes are needed before factual claims rely on it.`);
    } else if (isUrl(pathValue) && allowWeb) {
      const fetched = await fetchUrlText(pathValue);
      if (fetched.ok) {
        fetchedText = true;
        body += `<p><strong>Source URL:</strong> <a href="${attr(pathValue)}">${html(pathValue)}</a></p>`;
        body += paragraphs(fetched.text);
        notes.push(`Fetched readable text from ${label}.`);
      } else {
        body += `<p>The URL could not be fetched during this run (${html(fetched.error)}). The generator will not make factual claims from it until text is available.</p>`;
        notes.push(`Could not fetch ${label}: ${fetched.error}`);
      }
    } else if (isUrl(pathValue) && !allowWeb) {
      body += "<p>Web fetching is disabled for this brief. This URL stays queued but is not used for factual claims in this run.</p>";
      notes.push(`Web fetching disabled for ${label}.`);
    } else {
      body += "<p>The setup records this local or uploaded source name. Serverless generation cannot read private local file bytes until the upload ingestion stage supplies extracted text, so factual claims from this file are withheld.</p>";
      notes.push(`Source metadata queued for ${label}; extracted file text not present.`);
    }

    body += sourceQualityHtml(sourceQuality(source, { fetched: fetchedText }));

    sections.push({
      id,
      num: String(sections.length + 1),
      title: label,
      body
    });
  }

  if (prompts.length) {
    sections.push({
      id: `s${sections.length + 1}`,
      num: String(sections.length + 1),
      title: "Research prompts and knowledge-base questions",
      body: "<ul>" + prompts.map((prompt) => `<li>${html(prompt)}</li>`).join("") + "</ul>"
    });
  }

  return {
    sourcePaper: {
      title: `Student Reader - ${title}`,
      cite: "Generated from the Masterclass Factory knowledge-base analysis. Claims are limited to the setup package and fetched source extracts available during generation.",
      sections
    },
    notes
  };
}

function sourceText(sourcePaper) {
  return sourcePaper.sections.map((section) => {
    return `${section.id}. ${section.title}\n${stripHtml(section.body).slice(0, 4500)}`;
  }).join("\n\n");
}

module.exports = {
  buildSourcePaper: buildSourcePaper,
  sourceText: sourceText,
  paragraphs: paragraphs,
  sourceLabel: sourceLabel,
  titleCase: titleCase,
  sourceQuality: sourceQuality,
  sourceQualityHtml: sourceQualityHtml
};
