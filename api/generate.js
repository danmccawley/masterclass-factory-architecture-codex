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

function js(value) {
  return JSON.stringify(value);
}

function html(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attr(value) {
  return html(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function c(sectionId, label) {
  return `<sup class="cite" data-src="${sectionId}">[${html(label)}]</sup>`;
}

function quizAttr(questions) {
  return attr(JSON.stringify(questions));
}

function makeSourcePaper(brief) {
  const sourceNames = (brief.knowledge_base.uploads || [])
    .map((source) => source.path)
    .filter(Boolean);
  const seedPrompts = (brief.knowledge_base.research.seed_prompts || []).filter(Boolean);
  const bodyParts = [
    `<p>This placeholder source section summarizes the setup package for ${html(brief.meta.title || "the class")}. It does not add outside facts.</p>`
  ];
  if (sourceNames.length) {
    bodyParts.push(`<p>Sources queued for the research stage: ${html(sourceNames.join(", "))}.</p>`);
  }
  if (seedPrompts.length) {
    bodyParts.push(`<p>Research prompts queued for analysis: ${html(seedPrompts.join("; "))}.</p>`);
  }
  bodyParts.push("<p>Milestone 3 replaces this placeholder section with a cited corpus built by the research stage.</p>");
  return {
    title: `Student Reader - ${brief.meta.title || "Untitled Class"}`,
    cite: "Generated placeholder reader from the Masterclass Factory setup package. Not a verified source corpus.",
    sections: [
      {
        id: "s1",
        num: "1",
        title: "Setup package summary",
        body: bodyParts.join("")
      }
    ]
  };
}

function objectiveList(items, fallback) {
  const list = (items || []).filter(Boolean);
  const usable = list.length ? list : [fallback];
  return "<ul>" + usable.map((item) => `<li>${html(item)}</li>`).join("") + "</ul>";
}

function makeSlides(brief) {
  const title = brief.meta.title || "Untitled Masterclass";
  const terminalFallback = "Explain the core class outcome after the knowledge base is analyzed.";
  const enablingFallback = "Identify the supporting skills the learner needs before the final objective check.";
  const outOfScopeFallback = "Exclude topics that are not supported by the knowledge base.";
  const quiz = [
    {
      type: "mc",
      level: 1,
      q: "What should happen before final terminal and enabling objectives are approved?",
      options: ["Guess from the topic", "Research and analyze the knowledge base", "Skip the learner profile"],
      answer: 1,
      why: "Objectives should be grounded in the knowledge base and learner profile."
    },
    {
      type: "tf",
      level: 2,
      q: "This Milestone 2 deck uses deterministic placeholder content.",
      answer: true,
      why: "The AI authoring, source verification, and deploy gates come in later milestones."
    },
    {
      type: "sa",
      level: 3,
      q: "Name one thing the source-verification gate must prevent.",
      rubric: "Mentions fabricated sources, unsupported claims, unresolved citations, or invented facts.",
      sample: "It must prevent unsupported claims or fabricated citations from shipping.",
      accept: ["fabricated", "unsupported", "citation", "invented", "unverified"]
    }
  ];

  return [
    {
      id: "title",
      eyebrow: "Masterclass Factory",
      num: "01",
      deck:
        `<div class="wrap"><div class="eyebrow anim"><span class="num">01</span><span class="bar"></span>${html(title)} - placeholder deck</div>` +
        `<h1 class="anim">${html(title)}</h1><p class="sub anim">Generated from the Class Creator setup package. ${c("s1", "setup")}</p></div>`
    },
    {
      id: "kb",
      eyebrow: "Knowledge Base",
      num: "02",
      deck:
        `<div class="wrap"><div class="eyebrow anim"><span class="num">02</span><span class="bar"></span>Knowledge Base First</div>` +
        `<h2 class="head anim">Final objectives wait for source analysis</h2>` +
        `<p class="lede anim">The class setup says research and knowledge-base analysis must happen before final TLOs and ELOs are approved. ${c("s1", "setup")}</p>` +
        `<button class="deepbtn anim" data-deep="kb">Open the deep dive &rarr;</button></div>`,
      paper: {
        secnum: "Knowledge Base",
        h: "Why objectives come after analysis",
        body: "<p>The Factory treats sources, learner profile, and research rules as inputs to curriculum design. Placeholder content marks the workflow without inventing facts.</p>"
      }
    },
    {
      id: "objectives",
      eyebrow: "Objective Candidates",
      num: "03",
      deck:
        `<div class="wrap"><div class="eyebrow anim"><span class="num">03</span><span class="bar"></span>Review TLOs and ELOs</div>` +
        `<h2 class="head anim">Terminal learning objectives</h2>${objectiveList(brief.objectives.terminal, terminalFallback)}` +
        `<h2 class="head anim small-head">Enabling learning objectives</h2>${objectiveList(brief.objectives.enabling, enablingFallback)}` +
        `<p class="lede anim">These remain candidates until source verification passes. ${c("s1", "setup")}</p></div>`
    },
    {
      id: "scope",
      eyebrow: "Scope Control",
      num: "04",
      deck:
        `<div class="wrap"><div class="eyebrow anim"><span class="num">04</span><span class="bar"></span>Keep the Class Focused</div>` +
        `<h2 class="head anim">Out of scope</h2>${objectiveList(brief.objectives.out_of_scope, outOfScopeFallback)}` +
        `<p class="lede anim">Scope controls keep the generator from wandering outside the approved class boundaries.</p></div>`,
      poll: "scope-check"
    },
    {
      id: "check1",
      eyebrow: "Knowledge Check",
      num: "05",
      deck:
        `<div class="wrap"><div class="eyebrow anim"><span class="num">&#10003;</span><span class="bar"></span>Knowledge Check</div>` +
        `<h2 class="head anim">Check the Factory workflow</h2><p class="lede anim">Answer these before moving to sourced authoring.</p>` +
        `<div id="quiz-check1" class="quizbox popquiz anim" data-quiz="${quizAttr(quiz)}" data-pop="1"></div></div>`
    }
  ];
}

function makeContentJs(brief, slides) {
  const polls = {
    "scope-check": {
      q: "Which boundary most needs to stay out of this class?",
      desc: "This placeholder poll is replaced by the assessment stage in later milestones.",
      opts: ["Advanced side topic", "Unsupported statistic", "Audience-mismatch detail", "Not sure yet"]
    }
  };
  return [
    `/* ${brief.meta.title || "Untitled Masterclass"} - content layer. GENERATED PLACEHOLDER. */`,
    `window.CLASS_TITLE = ${js(brief.meta.title || "Untitled Masterclass")};`,
    `window.SLIDES = ${JSON.stringify(slides, null, 2)};`,
    `window.POLLS = ${JSON.stringify(polls, null, 2)};`,
    "window.WORDS = {};"
  ].join("\n") + "\n";
}

function makeGlossaryJs() {
  const glossary = {
    "terminal learning objective": {
      d: "The main capability learners should be able to demonstrate by the end of the class.",
      r: "It anchors the class around outcomes instead of loose topic coverage."
    },
    "enabling learning objective": {
      d: "A supporting skill or piece of knowledge needed to reach a terminal objective.",
      r: "It helps the generator build the class in teachable steps."
    },
    "source verification": {
      d: "An independent check that claims and citations are supported by the approved corpus.",
      r: "It prevents fabricated or unsupported material from shipping."
    }
  };
  return "/* Placeholder glossary. term -> {d, r}. */\nwindow.GLOSSARY = " + JSON.stringify(glossary, null, 2) + ";\n";
}

function makeSourceJs(sourcePaper) {
  return "/* Placeholder Student Reader. */\nwindow.SOURCE_PAPER = " + JSON.stringify(sourcePaper, null, 2) + ";\n";
}

function verify(files) {
  const failures = [];
  if (!/window\.SLIDES\s*=/.test(files["content.js"])) failures.push("content.js missing window.SLIDES");
  if (!/window\.POLLS\s*=/.test(files["content.js"])) failures.push("content.js missing window.POLLS");
  if (!/window\.WORDS\s*=/.test(files["content.js"])) failures.push("content.js missing window.WORDS");
  if (!/window\.GLOSSARY\s*=/.test(files["glossary.js"])) failures.push("glossary.js missing window.GLOSSARY");
  if (!/window\.SOURCE_PAPER\s*=/.test(files["source.js"])) failures.push("source.js missing window.SOURCE_PAPER");
  if (!/data-src=\\"s1\\"|data-src="s1"/.test(files["content.js"])) failures.push("content.js missing citation to s1");
  if (failures.length) return { ok: false, failures };
  return { ok: true, failures: [] };
}

module.exports = async function generateHandler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { ok: false, errors: ["Use POST with a class setup body."] });
    return;
  }

  try {
    const brief = await readBody(req);
    const result = validateBrief(brief, template);
    if (!result.ok) {
      send(res, 422, { ok: false, errors: result.errors });
      return;
    }

    const sourcePaper = makeSourcePaper(brief);
    const slides = makeSlides(brief);
    const files = {
      "content.js": makeContentJs(brief, slides),
      "glossary.js": makeGlossaryJs(),
      "source.js": makeSourceJs(sourcePaper)
    };
    const verification = verify(files);
    if (!verification.ok) {
      send(res, 500, { ok: false, errors: verification.failures });
      return;
    }

    send(res, 200, {
      ok: true,
      milestone: 2,
      qa: "QA PASS",
      message: "Deterministic placeholder content layer generated. Later milestones replace placeholders with sourced AI content, independent gates, and deployment.",
      files
    });
  } catch (error) {
    send(res, 400, { ok: false, errors: [error.message] });
  }
};
