const { validateBrief } = require("../brief-validator.js");
const template = require("../brief.template.json");

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
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
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function cleanArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeObjectives(value) {
  return {
    terminal: cleanArray(value && value.terminal, 5),
    enabling: cleanArray(value && value.enabling, 12),
    out_of_scope: cleanArray(value && value.out_of_scope, 8)
  };
}

function buildPrompt(payload) {
  const brief = payload.brief;
  return JSON.stringify(
    {
      requested_mode: payload.mode,
      requested_action: payload.action,
      class_title: brief.meta.title,
      sources: brief.knowledge_base.uploads,
      research_prompts: brief.knowledge_base.research.seed_prompts,
      audience: brief.audience,
      mastery: brief.mastery,
      current_objectives: brief.objectives,
      instructions: [
        "Create observable learning objectives for a masterclass.",
        "Terminal objectives are final learner capabilities.",
        "Enabling objectives are prerequisite or supporting skills.",
        "Out of scope lists topics that should be excluded.",
        "Use only the provided brief details. Do not invent sources, dates, URLs, statistics, or factual claims.",
        "Return compact plain-language bullets suitable for nontechnical class creators."
      ],
      required_json_shape: {
        terminal: ["string"],
        enabling: ["string"],
        out_of_scope: ["string"]
      }
    },
    null,
    2
  );
}

module.exports = async function objectivesHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { ok: false, errors: ["Use POST with a class brief body."] });
    return;
  }

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    send(res, 503, {
      ok: false,
      errors: ["AI assistance is not connected. Set OPENAI_API_KEY and OPENAI_MODEL in Vercel."]
    });
    return;
  }

  try {
    const payload = await readBody(req);
    const result = validateBrief(payload.brief, template);
    if (!result.ok) {
      send(res, 422, { ok: false, errors: result.errors });
      return;
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are the Masterclass Factory curriculum specialist. Output only valid JSON with terminal, enabling, and out_of_scope arrays. Never invent unverifiable facts."
          },
          { role: "user", content: buildPrompt(payload) }
        ]
      })
    });

    const openaiPayload = await openaiResponse.json();
    if (!openaiResponse.ok) {
      const message =
        openaiPayload && openaiPayload.error && openaiPayload.error.message
          ? openaiPayload.error.message
          : "OpenAI API request failed.";
      send(res, openaiResponse.status, { ok: false, errors: [message] });
      return;
    }

    const content =
      openaiPayload &&
      openaiPayload.choices &&
      openaiPayload.choices[0] &&
      openaiPayload.choices[0].message &&
      openaiPayload.choices[0].message.content;
    const parsed = JSON.parse(content || "{}");
    const objectives = normalizeObjectives(parsed);

    send(res, 200, {
      ok: true,
      message: "AI drafted objectives. Please review before generating.",
      objectives
    });
  } catch (error) {
    send(res, 400, { ok: false, errors: [error.message] });
  }
};
