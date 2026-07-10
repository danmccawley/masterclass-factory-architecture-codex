"use strict";

const BriefSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    topic: { type: "string", minLength: 2, required: true },
    audience: {
      type: "object",
      required: true,
      additionalProperties: false,
      properties: {
        role: { type: "string", required: true },
        skill_level: { type: "string", enum: ["novice", "mixed", "technical", "expert"], required: true },
        floor_background: { type: "string", required: true },
        language: { type: "string", required: true },
        reading_grade_cap: { type: "integer", minimum: 5, maximum: 16, required: true }
      }
    },
    duration_minutes: { type: "integer", minimum: 10, maximum: 480, required: true },
    delivery_format: { type: "string", enum: ["live workshop", "self-paced", "hybrid"], required: true },
    tone: { type: "string", required: true },
    class_tier: { type: "string", enum: ["briefing", "standard", "professional", "expert"], required: true },
    research_depth: { type: "string", enum: ["operator supplied", "assisted", "ai owned"], required: true },
    must_cover: { type: "array", required: true, items: { type: "string" } },
    out_of_scope: { type: "array", required: true, items: { type: "string" } },
    uploaded_materials: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          name: { type: "string", required: true },
          type: { type: "string", required: true },
          uri: { type: "string", required: true }
        }
      }
    },
    preferences: {
      type: "object",
      required: true,
      additionalProperties: false,
      properties: {
        include_deep_dives: { type: "string", enum: ["yes", "no", "let bernard decide"], required: true },
        include_video_audio_links: { type: "string", enum: ["yes", "no", "optional"], required: true },
        split_language_view: { type: "boolean", required: true }
      }
    }
  }
};

function fromLegacyBrief(brief) {
  brief = brief || {};
  const audience = brief.audience || {};
  const floor = audience.floor || {};
  const avg = audience.average || {};
  const mastery = brief.mastery || {};
  const kb = brief.knowledge_base || {};
  const research = kb.research || {};
  const length = brief.length || {};
  const language = brief.language || {};
  return {
    topic: brief.meta && brief.meta.title ? brief.meta.title : "Untitled masterclass",
    audience: {
      role: avg.role || floor.role || "mixed",
      skill_level: avg.technical === "technical" ? "technical" : avg.technical === "non" ? "novice" : "mixed",
      floor_background: floor.background || "No prior topic knowledge assumed.",
      language: language.primary || "en",
      reading_grade_cap: audience.accessibility && audience.accessibility.reading_grade_cap ? audience.accessibility.reading_grade_cap : 9
    },
    duration_minutes: length.minutes || 60,
    delivery_format: "live workshop",
    tone: audience.tone || "plain",
    class_tier: brief.class_tier && brief.class_tier.level ? brief.class_tier.level : "professional",
    research_depth: research.owner === "ai" ? "ai owned" : research.owner === "assisted" ? "assisted" : "operator supplied",
    must_cover: (brief.objectives && brief.objectives.terminal) || [],
    out_of_scope: (brief.objectives && brief.objectives.out_of_scope) || [],
    uploaded_materials: Array.isArray(kb.uploads) ? kb.uploads.map(function (u, index) {
      return { id: "upload-" + (index + 1), name: u.path || "Source " + (index + 1), type: u.type || "url", uri: u.path || "" };
    }) : [],
    preferences: {
      include_deep_dives: mastery.deep_dive_density === "low" ? "no" : "yes",
      include_video_audio_links: "optional",
      split_language_view: Boolean(language.split_screen)
    }
  };
}

module.exports = { BriefSchema: BriefSchema, fromLegacyBrief: fromLegacyBrief };
