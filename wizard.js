(function initClassCreator() {
  "use strict";

  var steps = [
    ["create", "Create", "Name and tier", "Start with the class title, a short link-friendly name, and the class tier that sets the knowledge-base standard."],
    ["knowledge", "Knowledge base", "Sources and research", "Add source files or URLs, then choose how tightly later stages may research around them."],
    ["objectives", "Learning Target", "Draft target", "Capture the class creator's early intent. Final TLOs and ELOs are confirmed only after the knowledge base is researched and analyzed."],
    ["mastery", "Mastery", "Depth and checks", "Set the intended assessment level and how much disagreement or deep-dive material the course should include."],
    ["demographics", "Demographics", "Typical and floor", "Describe the typical learner, the floor learner, and the students' preferred language for the class."],
    ["length", "Length", "Time and budget", "Choose the class length, slide budget, and interaction budget that the curriculum stage must obey."],
    ["language", "Language", "Locale and glossary", "Choose whether the class is translated into the students' language or shown split-screen with English."],
    ["review", "Review & Generate", "Launch package", "Review the class package, QR code, and launch link. Advanced setup data stays available for the generator."]
  ];

  var sourceRules = ["statistics", "forward-looking claims", "contested points"];
  var languages = [
    ["en", "English"],
    ["es", "Spanish"],
    ["fr", "French"],
    ["de", "German"],
    ["pt", "Portuguese"],
    ["it", "Italian"],
    ["ar", "Arabic"],
    ["zh", "Chinese"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["vi", "Vietnamese"]
  ];

  var state = {
    step: 0,
    slugTouched: false,
    objectiveMode: "hybrid",
    studentLanguage: "en",
    delivery: "english",
    aiStatus: null,
    researchStatus: null
  };

  var template = window.BriefValidator.DEFAULT_TEMPLATE;
  var brief = makeBrief();
  var els = {
    stepList: byId("stepList"),
    stepEyebrow: byId("stepEyebrow"),
    stepTitle: byId("stepTitle"),
    progressFill: byId("progressFill"),
    form: byId("wizardForm"),
    back: byId("backButton"),
    next: byId("nextButton"),
    briefView: byId("briefView"),
    launchLink: byId("launchLink"),
    drawerQr: byId("drawerQr"),
    validationBadge: byId("validationBadge"),
    validationBox: byId("validationBox"),
    contractStatus: byId("contractStatus"),
    copy: byId("copyButton"),
    download: byId("downloadButton")
  };

  loadTemplate();
  bindEvents();
  render();

  function byId(id) {
    return document.getElementById(id);
  }

  function makeBrief() {
    return {
      meta: {
        title: "",
        slug: "",
        created: new Date().toISOString(),
        engine_contract: "v-texas"
      },
      class_tier: {
        level: "professional"
      },
      knowledge_base: {
        uploads: [],
        research: {
          owner: "creator",
          mode: "grounded",
          seed_prompts: [],
          allow_web: true,
          recency_floor: "2024-01-01"
        },
        credibility: {
          min_tier: "secondary",
          require_two_sources_for: sourceRules.slice()
        }
      },
      objectives: {
        terminal: [],
        enabling: [],
        out_of_scope: []
      },
      mastery: {
        target_level: 3,
        granularity: "working",
        deep_dive_density: "high",
        field_disagreement: true
      },
      audience: {
        average: {
          age_band: "",
          education: "",
          background: "",
          technical: "mixed",
          role: "mixed"
        },
        floor: {
          age_band: "",
          education: "",
          background: "",
          technical: "non",
          role: ""
        },
        gender_mix: "",
        tone: "plain",
        accessibility: { reading_grade_cap: 9 }
      },
      length: {
        minutes: 60,
        slide_budget: 90,
        interaction_budget: {
          polls: 2,
          word_clouds: 4,
          quizzes: 1,
          final_test: true
        }
      },
      language: {
        primary: "en",
        localize_ui_strings: true,
        glossary_in_primary: true
      }
    };
  }

  async function loadTemplate() {
    try {
      var response = await fetch("brief.template.json", { cache: "no-store" });
      if (!response.ok) throw new Error("brief.template.json was not found.");
      template = await response.json();
      if (!window.BriefValidator.validateBrief(template, template).ok) {
        throw new Error("brief.template.json does not validate itself.");
      }
      setContractStatus("Setup ready", "ok");
    } catch (error) {
      setContractStatus("Using built-in setup", "warn");
    }
    syncOutput();
  }

  function bindEvents() {
    els.stepList.addEventListener("click", function (event) {
      var button = event.target.closest("[data-step]");
      if (!button) return;
      state.step = Number(button.dataset.step);
      render();
    });

    els.form.addEventListener("input", onInput);
    els.form.addEventListener("change", onChange);
    els.form.addEventListener("click", onClick);
    els.back.addEventListener("click", function () {
      state.step = Math.max(0, state.step - 1);
      render();
    });
    els.next.addEventListener("click", function () {
      if (state.step < steps.length - 1) {
        state.step += 1;
        render();
        return;
      }
      postBrief();
    });
    els.copy.addEventListener("click", copyBrief);
    els.download.addEventListener("click", downloadBrief);
  }

  function render() {
    var step = steps[state.step];
    els.stepList.innerHTML = steps.map(function (item, index) {
      var classes = ["step-button"];
      if (index === state.step) classes.push("active");
      if (index < state.step) classes.push("done");
      return (
        "<li><button type=\"button\" class=\"" + classes.join(" ") + "\" data-step=\"" + index + "\">" +
        "<span class=\"step-num\">" + String(index + 1).padStart(2, "0") + "</span>" +
        "<span><span class=\"step-label\">" + esc(item[1]) + "</span><span class=\"step-sub\">" +
        esc(item[2]) + "</span></span></button></li>"
      );
    }).join("");
    els.stepEyebrow.textContent = "Step " + (state.step + 1) + " of " + steps.length;
    els.stepTitle.textContent = step[1];
    els.progressFill.style.width = ((state.step + 1) / steps.length) * 100 + "%";
    els.form.innerHTML = "<p class=\"step-copy\">" + esc(step[3]) + "</p>" + renderStep(step[0]);
    els.back.disabled = state.step === 0;
    els.next.textContent = state.step === steps.length - 1 ? "Start generator" : "Next";
    syncOutput();
  }

  function renderStep(id) {
    if (id === "create") return createStep();
    if (id === "knowledge") return knowledgeStep();
    if (id === "objectives") return objectivesStep();
    if (id === "mastery") return masteryStep();
    if (id === "demographics") return demographicsStep();
    if (id === "length") return lengthStep();
    if (id === "language") return languageStep();
    return reviewStep();
  }

  function createStep() {
    return grid(
      inputField("Class title", "meta.title", "Example: AI Strategy for Healthcare Leaders") +
      inputField("Short link name", "meta.slug", "ai-strategy-healthcare-leaders") +
      inputField("Created", "meta.created", "", "datetime-local") +
      classTierPlanner()
    );
  }

  function classTierPlanner() {
    return card("Class tier and knowledge-base standard",
      "<p class=\"hint\">Choose the quality bar before research starts. The selected tier controls the minimum source floor, primary-source expectation, and minimum slide depth.</p>" +
      "<div class=\"mode-grid class-tier-grid\">" + classTierOptions().map(function (tier) {
        var selected = brief.class_tier.level === tier.id;
        return "<label class=\"mode-card tier-card\"><input type=\"radio\" name=\"classTier\" data-class-tier-level value=\"" + attr(tier.id) + "\"" +
          (selected ? " checked" : "") + "> <span><strong>" + esc(tier.label) + "</strong><small>" + esc(tier.description) + "</small></span></label>";
      }).join("") + "</div>" +
      classTierSummary(),
      "full class-tier-planner");
  }

  function classTierOptions() {
    return [
      { id: "briefing", label: "Quick briefing", sources: 4, primary: 1, slides: 30, description: "Short, source-aware orientation. Useful for overviews, not full mastery." },
      { id: "standard", label: "Standard class", sources: 8, primary: 2, slides: 40, description: "Solid internal training with enough evidence for reliable instruction." },
      { id: "professional", label: "Professional masterclass", sources: 12, primary: 3, slides: 60, description: "Default quality bar. Built for serious workplace learning and strong source discipline." },
      { id: "expert", label: "Expert / safety-critical", sources: 18, primary: 5, slides: 90, description: "Highest bar for technical, safety, compliance, infrastructure, or high-risk classes." }
    ];
  }

  function classTier() {
    var selected = brief.class_tier && brief.class_tier.level;
    return classTierOptions().find(function (tier) { return tier.id === selected; }) || classTierOptions()[2];
  }

  function classTierSummary() {
    var tier = classTier();
    return "<div class=\"standard-grid tier-standard-grid\">" +
      standardStat("Source floor", tier.sources + " usable sources") +
      standardStat("Primary-source floor", tier.primary + " primary sources") +
      standardStat("Minimum depth", tier.slides + " slides") +
      "</div>";
  }

  function knowledgeStep() {
    return (
      "<div class=\"form-grid single\">" +
      "<div class=\"field full upload-box\"><label>Upload source files</label><input type=\"file\" multiple data-file-upload>" +
      "<p class=\"hint\">The browser records file names as source paths. The later research stage ingests the actual files.</p></div>" +
      "<div class=\"field full\"><label>Add a source path, URL, video, or audio link</label><div class=\"source-row\">" +
      "<input type=\"text\" data-new-source-path placeholder=\"source.pdf, https://example.com/report, video URL, or audio URL\">" +
      sourceTypeSelect("", "data-new-source-type") +
      sourceTrustSelect("secondary", "data-new-source-trust") +
      "<button type=\"button\" class=\"primary\" data-add-source>Add</button></div>" +
      sourceRows() + "</div>" +
      knowledgeStandardCard() +
      researchOwnershipCard() +
      knowledgeDashboardCard() +
      researchWorkflowCard() +
      evidenceMapCard() +
      sourceCompositionCard() +
      grid(
        selectField("Evidence boundary", "knowledge_base.research.mode", [
          ["none", "Use only the sources I add"],
          ["grounded", "Analyze my source list"],
          ["collaborative", "May add verified research"]
        ]) +
        checkboxField("Allow verified web research", "knowledge_base.research.allow_web") +
        inputField("Recency floor", "knowledge_base.research.recency_floor", "2024-01-01", "date") +
        selectField("Minimum source tier", "knowledge_base.credibility.min_tier", [
          ["primary", "Primary"],
          ["secondary", "Secondary"],
          ["unknown", "Unknown allowed"]
        ]) +
        textareaField("Research seed prompts", "knowledge_base.research.seed_prompts", "One prompt per line") +
        sourceRuleFields()
      ) +
      "</div>"
    );
  }

  function objectivesStep() {
    return (
      "<div class=\"form-grid single\">" +
      "<div class=\"summary-card full assist-panel\"><h3>Draft the learning target</h3>" +
      "<p class=\"hint\">Use this as an early direction of travel. The final terminal and enabling learning objectives should be produced after the knowledge base is researched, analyzed, and matched to the learner profile.</p>" +
      objectiveModes() +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-ai=\"suggest\">Suggest draft gaps</button>" +
      "<button type=\"button\" class=\"ghost\" data-ai=\"draft\">Brainstorm with AI</button>" +
      "<button type=\"button\" class=\"primary\" data-ai=\"fill\">Draft early target</button></div>" +
      aiNotice() + "</div>" +
      textareaField("Initial terminal outcome ideas", "objectives.terminal", "Example: Change a tire safely using the correct tools") +
      textareaField("Initial enabling skill ideas", "objectives.enabling", "Example: Identify the jack points\nLoosen lug nuts safely\nCheck tire pressure after installation") +
      textareaField("Likely out of scope", "objectives.out_of_scope", "Example: Engine repair\nTowing procedures") +
      "</div>"
    );
  }

  function masteryStep() {
    return (
      "<div class=\"form-grid single\">" +
      card("Depth of instruction",
        grid(
          numberField("Target mastery level", "mastery.target_level", 1, 5) +
          selectField("Granularity", "mastery.granularity", [["survey", "Survey"], ["working", "Working"], ["deep", "Deep"]]) +
          checkboxField("Include where-the-field-disagrees material", "mastery.field_disagreement")
        ),
        "full") +
      deepDivePlanner() +
      "</div>"
    );
  }

  function deepDivePlanner() {
    var modes = [
      ["high", "Deep-dive heavy", "Recommended. Add deep dives throughout the class so complex topics get examples, edge cases, source notes, and presenter detail."],
      ["med", "Let Bernard decide", "Bernard adds deep dives where the source base, learner profile, and mastery level call for them."],
      ["low", "No deep dives", "Use only when the class must stay brief. The generator will still keep the core lesson complete."]
    ];
    return card("Deep dives",
      "<p class=\"hint\">Choose whether the finished class should include expandable deep-dive material. Deep dives are the richer explanation layer behind the slides.</p>" +
      "<div class=\"mode-grid deep-dive-mode-grid\">" + modes.map(function (mode) {
        return "<label class=\"mode-card\"><input type=\"radio\" name=\"deepDiveMode\" data-deep-dive-mode value=\"" + mode[0] + "\"" +
          (brief.mastery.deep_dive_density === mode[0] ? " checked" : "") + "> <span><strong>" + esc(mode[1]) +
          "</strong><small>" + esc(mode[2]) + "</small></span></label>";
      }).join("") + "</div>",
      "full deep-dive-planner");
  }

  function demographicsStep() {
    return grid(
      card("Typical learner", grid(
        inputField("Age band", "audience.average.age_band", "35-54") +
        inputField("Education", "audience.average.education", "College or equivalent work experience") +
        inputField("Background", "audience.average.background", "Department leaders") +
        selectField("Technical comfort", "audience.average.technical", technicalOptions()) +
        inputField("Role", "audience.average.role", "Manager, director, operator")
      ), "full") +
      card("Floor learner", grid(
        inputField("Age band", "audience.floor.age_band", "18+") +
        inputField("Education", "audience.floor.education", "High school") +
        inputField("Background", "audience.floor.background", "No prior topic knowledge") +
        selectField("Technical comfort", "audience.floor.technical", technicalOptions()) +
        inputField("Role", "audience.floor.role", "General audience")
      ), "full") +
      inputField("Gender mix", "audience.gender_mix", "Mixed") +
      selectField("Tone", "audience.tone", [
        ["plain", "Plain"],
        ["warm", "Warm"],
        ["executive", "Executive"],
        ["academic", "Academic"],
        ["workshop", "Workshop"]
      ]) +
      numberField("Reading grade cap", "audience.accessibility.reading_grade_cap", 3, 16) +
      card("Student language",
        "<p class=\"hint\">Choose the students' preferred language and whether the presentation should be fully translated or split-screen with English.</p>" +
        grid(languageControls()),
        "full")
    );
  }

  function lengthStep() {
    return grid(
      numberField("Minutes", "length.minutes", 10, 480) +
      numberField("Slide budget", "length.slide_budget", 30, 400) +
      numberField("Polls", "length.interaction_budget.polls", 0, 50) +
      numberField("Word clouds", "length.interaction_budget.word_clouds", 0, 50) +
      numberField("Quizzes", "length.interaction_budget.quizzes", 0, 50) +
      checkboxField("Include final test", "length.interaction_budget.final_test")
    );
  }

  function languageStep() {
    return grid(
      card("Presentation language",
        "<p class=\"hint\">For non-English learners, use translated mode for one language or split-screen mode for English plus the students' preferred language.</p>" +
        grid(languageControls()),
        "full") +
      checkboxField("Localize UI strings", "language.localize_ui_strings") +
      checkboxField("Glossary in primary language", "language.glossary_in_primary")
    );
  }

  function reviewStep() {
    var result = validate();
    var launchUrl = getLaunchUrl();
    return (
      "<div class=\"form-grid single\">" +
      card("Class package",
        "<div class=\"launch-summary\"><div><span class=\"mini-label\">Class</span><strong>" + esc(brief.meta.title || "Untitled class") + "</strong></div>" +
        "<div><span class=\"mini-label\">Language</span><strong>" + esc(languageSummary()) + "</strong></div>" +
        "<div><span class=\"mini-label\">Launch link</span><a href=\"" + attr(launchUrl) + "\" target=\"_blank\" rel=\"noreferrer\">" + esc(launchUrl) + "</a></div></div>") +
      "<div class=\"summary-card qr-card\"><h3>QR code</h3><p class=\"hint\">This code opens the Vercel launch link. After the deck generator is connected, this same area will point learners to the generated masterclass.</p>" +
      "<img class=\"qr-image large\" alt=\"QR code for the Vercel launch link\" src=\"" + attr(qrUrl(launchUrl)) + "\"></div>" +
      courseBlueprintCard() +
      card("Generator readiness",
        (result.ok ? "<div class=\"notice\">The class setup is ready for the generator.</div>" : "<div class=\"notice warn\">Fix the listed setup errors before starting the generator.</div>") +
        errorList(result.errors)) +
      card("Readiness notes", readinessNotes()) +
      "<div class=\"review-actions\"><button type=\"button\" class=\"ghost\" data-copy-launch>Copy launch link</button>" +
      "<button type=\"button\" class=\"primary\" data-post-review>Start generator</button></div>" +
      "<div id=\"postResult\" class=\"validation-box\"></div></div>"
    );
  }

  function grid(content) {
    return "<div class=\"form-grid\">" + content + "</div>";
  }

  function card(title, content, extraClass) {
    return "<div class=\"summary-card " + (extraClass || "") + "\"><h3>" + esc(title) + "</h3>" + content + "</div>";
  }

  function inputField(label, path, placeholder, type) {
    return field(label,
      "<input id=\"" + fieldId(path) + "\" type=\"" + (type || "text") + "\" data-path=\"" + path +
      "\" value=\"" + attr(formatValue(getPath(path), type)) + "\" placeholder=\"" + attr(placeholder || "") + "\">");
  }

  function numberField(label, path, min, max) {
    return field(label,
      "<input id=\"" + fieldId(path) + "\" type=\"number\" data-number-path=\"" + path +
      "\" min=\"" + min + "\" max=\"" + max + "\" value=\"" + attr(String(getPath(path))) + "\">");
  }

  function textareaField(label, path, placeholder) {
    return "<div class=\"field full\"><label for=\"" + fieldId(path) + "\">" + esc(label) + "</label>" +
      "<textarea id=\"" + fieldId(path) + "\" data-lines-path=\"" + path + "\" placeholder=\"" + attr(placeholder || "") + "\">" +
      esc(toLines(getPath(path))) + "</textarea></div>";
  }

  function selectField(label, path, options) {
    return field(label,
      "<select id=\"" + fieldId(path) + "\" data-path=\"" + path + "\">" + optionTags(options, getPath(path)) + "</select>");
  }

  function checkboxField(label, path) {
    return "<label class=\"choice\"><input type=\"checkbox\" data-boolean-path=\"" + path + "\"" +
      (getPath(path) ? " checked" : "") + "> <span>" + esc(label) + "</span></label>";
  }

  function field(label, control) {
    return "<div class=\"field\"><label>" + esc(label) + "</label>" + control + "</div>";
  }

  function optionTags(options, selected) {
    return options.map(function (option) {
      return "<option value=\"" + attr(option[0]) + "\"" + (String(option[0]) === String(selected) ? " selected" : "") + ">" +
        esc(option[1]) + "</option>";
    }).join("");
  }

  function sourceRows() {
    if (!brief.knowledge_base.uploads.length) return "<div class=\"hint\">No sources added yet.</div>";
    return "<div class=\"source-list\">" + brief.knowledge_base.uploads.map(function (source, index) {
      return "<div class=\"source-row\"><input type=\"text\" data-source-field=\"path\" data-source-index=\"" + index +
        "\" value=\"" + attr(source.path) + "\" aria-label=\"Source path\">" +
        sourceTypeSelect(source.type, "data-source-field=\"type\" data-source-index=\"" + index + "\"") +
        sourceTrustSelect(source.trust, "data-source-field=\"trust\" data-source-index=\"" + index + "\"") +
        "<button type=\"button\" class=\"remove-source\" data-remove-source=\"" + index + "\" aria-label=\"Remove source\">x</button></div>";
    }).join("") + "</div>";
  }

  function sourceCompositionCard() {
    return card("Knowledge base composition",
      "<p class=\"hint\">These are the sources Bernard and the generator may cite. URL, video, and audio links are visible immediately; local file names are queued until the ingestion stage extracts their text or transcript.</p>" +
      sourceCompositionList() +
      sourceQualityMetric(),
      "full kb-composition-card");
  }

  function knowledgeStandardCard() {
    var tier = classTier();
    var uploads = brief.knowledge_base.uploads || [];
    var total = uploads.length;
    var primary = uploads.filter(function (source) { return source.trust === "primary"; }).length;
    var sourceOk = total >= tier.sources;
    var primaryOk = primary >= tier.primary;
    var status = sourceOk && primaryOk ? "Meets selected standard" : "Needs more knowledge-base work";
    var missing = [];
    if (!sourceOk) missing.push((tier.sources - total) + " more usable source" + (tier.sources - total === 1 ? "" : "s"));
    if (!primaryOk) missing.push((tier.primary - primary) + " more primary source" + (tier.primary - primary === 1 ? "" : "s"));
    return card("Knowledge-base standard check",
      "<div class=\"standard-status " + (sourceOk && primaryOk ? "ok" : "warn") + "\"><strong>" + esc(status) + "</strong><span>" +
      esc(missing.length ? "Add " + missing.join(" and ") + " before treating this as generator-ready." : "The listed sources meet the selected class tier floor.") + "</span></div>" +
      "<div class=\"standard-grid\">" +
      standardStat("Selected tier", tier.label) +
      standardStat("Sources listed", total + " / " + tier.sources) +
      standardStat("Primary sources", primary + " / " + tier.primary) +
      standardStat("Slide floor", tier.slides + "+") +
      "</div>",
      "full kb-standard-card");
  }

  function researchOwnershipCard() {
    var modes = [
      ["creator", "I will build it", "The class creator adds the source list. Bernard can still analyze it later, but does not own source gathering."],
      ["assisted", "Help me research", "Bernard suggests search prompts, missing source types, and gaps while the class creator approves what goes into the knowledge base."],
      ["ai", "Assign to Bernard", "Bernard is responsible for finding enough verified sources during generation, then source verification and QA still gate the class."]
    ];
    return card("Who owns knowledge-base research?",
      "<p class=\"hint\">Choose the responsibility model before objectives are finalized. Final TLOs and ELOs should come after this research path is complete.</p>" +
      "<div class=\"mode-grid research-owner-grid\">" + modes.map(function (mode) {
        return "<label class=\"mode-card\"><input type=\"radio\" name=\"researchOwner\" data-research-owner value=\"" + mode[0] + "\"" +
          (brief.knowledge_base.research.owner === mode[0] ? " checked" : "") + "> <span><strong>" + esc(mode[1]) +
          "</strong><small>" + esc(mode[2]) + "</small></span></label>";
      }).join("") + "</div>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-research-action=\"plan\">Ask Bernard for research help</button>" +
      "<button type=\"button\" class=\"primary\" data-research-action=\"assign\">Assign research to Bernard</button></div>" +
      researchNotice(),
      "full research-owner-card assist-panel");
  }

  function researchNotice() {
    if (!state.researchStatus) return "";
    return "<div class=\"notice" + (state.researchStatus.warn ? " warn" : "") + "\">" + esc(state.researchStatus.text) + "</div>";
  }

  function knowledgeDashboardCard() {
    var score = knowledgeScore();
    var mix = sourceMix();
    var gaps = knowledgeGaps();
    return card("Knowledge Base Standard dashboard",
      "<div class=\"kb-score-row\"><div class=\"kb-score\"><strong>" + score.score + "</strong><span>/100</span></div>" +
      "<div><h4>" + esc(score.label) + "</h4><p class=\"hint\">" + esc(score.note) + "</p></div></div>" +
      "<div class=\"standard-grid\">" +
      standardStat("Standards", mix.standards) +
      standardStat("Technical guides", mix.technical) +
      standardStat("Safety / compliance", mix.safety) +
      standardStat("Training / certification", mix.training) +
      standardStat("Current practice", mix.practice) +
      "</div>" +
      "<div class=\"kb-gap-list\"><strong>Bernard should resolve these before final objectives:</strong>" +
      "<ul>" + gaps.map(function (gap) { return "<li>" + esc(gap) + "</li>"; }).join("") + "</ul></div>",
      "full kb-dashboard-card");
  }

  function researchWorkflowCard() {
    var tier = classTier();
    var searches = researchSearchPlan();
    return card("Research methodology",
      "<p class=\"hint\">This is the research sequence Bernard must satisfy before the class becomes a finished masterclass. The generator can draft only inside the approved evidence boundary.</p>" +
      "<div class=\"analysis-flow research-flow\"><span>Collect</span><span>Screen</span><span>Map</span><span>Approve</span></div>" +
      "<div class=\"method-grid\">" +
      "<div><h4>Required collection</h4><p>" + esc(tier.sources + " usable sources, including " + tier.primary + " primary sources.") + "</p></div>" +
      "<div><h4>Screening test</h4><p>Reject weak, outdated, unverifiable, duplicate, or vendor-only sources unless they are clearly labeled as context.</p></div>" +
      "<div><h4>Evidence map</h4><p>Every major objective, module, safety point, and assessment item needs a source anchor or a visible research gap.</p></div>" +
      "</div>" +
      "<details class=\"source-metric\" open><summary>Recommended research strings</summary><ul>" +
      searches.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("") +
      "</ul></details>",
      "full kb-method-card");
  }

  function evidenceMapCard() {
    var rows = evidenceRows();
    return card("Evidence map",
      "<p class=\"hint\">This draft map shows what the knowledge base can support right now. Rows marked as gaps should be researched before Bernard finalizes TLOs, ELOs, and slides.</p>" +
      "<div class=\"evidence-table\">" + rows.map(function (row) {
        return "<div class=\"evidence-row " + (row.ok ? "ok" : "warn") + "\">" +
          "<div><span class=\"mini-label\">" + esc(row.kind) + "</span><strong>" + esc(row.claim) + "</strong></div>" +
          "<div>" + row.sources.map(function (source) { return "<span class=\"source-chip\">" + esc(source) + "</span>"; }).join("") + "</div>" +
          "<p>" + esc(row.note) + "</p></div>";
      }).join("") + "</div>",
      "full evidence-map-card");
  }

  function sourceMix() {
    var counts = { standards: 0, technical: 0, safety: 0, training: 0, practice: 0 };
    (brief.knowledge_base.uploads || []).forEach(function (source) {
      var category = classifySource(source);
      counts[category] += 1;
    });
    return counts;
  }

  function classifySource(source) {
    var combined = [
      source && source.type,
      source && source.path
    ].join(" ").toLowerCase();
    if (/standard|ansi|tia|bicsi|iso|ieee|nec|nfpa|code|regulation/.test(combined)) return "standards";
    if (/safety|osha|hazard|ppe|compliance|risk|procedure/.test(combined)) return "safety";
    if (/certification|training|curriculum|course|credential|exam/.test(combined)) return "training";
    if (/manufacturer|install guide|installation guide|manual|spec|datasheet|technical|corning|commscope|belden|panduit/.test(combined)) return "technical";
    return "practice";
  }

  function knowledgeScore() {
    var tier = classTier();
    var uploads = brief.knowledge_base.uploads || [];
    var primary = uploads.filter(function (source) { return source.trust === "primary"; }).length;
    var mix = sourceMix();
    var sourcePart = Math.min(1, uploads.length / Math.max(1, tier.sources)) * 35;
    var primaryPart = Math.min(1, primary / Math.max(1, tier.primary)) * 25;
    var mixHits = ["standards", "technical", "safety", "training", "practice"].filter(function (key) { return mix[key] > 0; }).length;
    var mixPart = Math.min(1, mixHits / 4) * 25;
    var rulePart = Math.min(10, (brief.knowledge_base.credibility.require_two_sources_for || []).length * 3.5);
    var recencyPart = brief.knowledge_base.research.recency_floor ? 5 : 0;
    var score = Math.round(sourcePart + primaryPart + mixPart + rulePart + recencyPart);
    return {
      score: score,
      label: score >= 90 ? "Ready for masterclass generation" : score >= 70 ? "Close, but review gaps" : "Not ready yet",
      note: score >= 90
        ? "The source list meets the selected tier and has enough mix for a serious class."
        : "Keep building the knowledge base before treating the output as final."
    };
  }

  function knowledgeGaps() {
    var tier = classTier();
    var uploads = brief.knowledge_base.uploads || [];
    var primary = uploads.filter(function (source) { return source.trust === "primary"; }).length;
    var mix = sourceMix();
    var gaps = [];
    if (uploads.length < tier.sources) gaps.push("Add " + (tier.sources - uploads.length) + " more usable sources for the selected tier.");
    if (primary < tier.primary) gaps.push("Add " + (tier.primary - primary) + " more primary sources.");
    if (!mix.standards) gaps.push("Add at least one standards, code, regulator, or governing-body source where relevant.");
    if (!mix.technical) gaps.push("Add manufacturer, technical manual, specification, or install-guide evidence.");
    if (!mix.safety) gaps.push("Add safety, compliance, risk, or procedure evidence for technical classes.");
    if (!brief.knowledge_base.research.seed_prompts.length) gaps.push("Add research seed prompts so Bernard knows what to investigate.");
    if (!gaps.length) gaps.push("No major source-floor gaps are visible. The generator still verifies citations independently.");
    return gaps.slice(0, 6);
  }

  function researchSearchPlan() {
    var title = brief.meta.title || "the class topic";
    return [
      title + " standards governing body official guidance",
      title + " manufacturer installation guide technical manual",
      title + " safety procedure hazards PPE checklist",
      title + " certification training objectives assessment",
      title + " current best practices lessons learned",
      title + " common errors troubleshooting quality assurance"
    ];
  }

  function evidenceRows() {
    var uploads = brief.knowledge_base.uploads || [];
    var sourceLabels = uploads.map(function (source, index) { return "S" + String(index + 1).padStart(2, "0") + " " + sourceLabelFor(source.path || "Source"); });
    var terminal = brief.objectives.terminal.length ? brief.objectives.terminal : ["Final terminal learning objectives after knowledge-base analysis"];
    var enabling = brief.objectives.enabling.length ? brief.objectives.enabling.slice(0, 3) : ["Enabling skills after source analysis"];
    var rows = [];
    terminal.slice(0, 3).forEach(function (item, index) {
      rows.push(evidenceRow("Terminal outcome", item, sourceLabels.slice(index, index + 3)));
    });
    enabling.slice(0, 4).forEach(function (item, index) {
      rows.push(evidenceRow("Enabling skill", item, sourceLabels.slice(index + 1, index + 4)));
    });
    rows.push(evidenceRow("Safety / quality risk", "Claims involving risk, safety, standards, or procedure need two independent sources.", sourceLabels.filter(function (_, index) { return index % 2 === 0; }).slice(0, 4)));
    rows.push(evidenceRow("Out of scope", brief.objectives.out_of_scope.join("; ") || "Unsupported claims and topics outside the approved source boundary.", sourceLabels.slice(0, 2)));
    return rows.slice(0, 8);
  }

  function evidenceRow(kind, claim, sources) {
    var ok = sources && sources.length > 0;
    return {
      kind: kind,
      claim: claim,
      sources: ok ? sources : ["Gap"],
      ok: ok,
      note: ok ? "Mapped to the current source list for verification." : "Needs source evidence before this can become final class content."
    };
  }

  function courseBlueprintCard() {
    var modules = blueprintModules();
    return card("Course blueprint approval",
      "<p class=\"hint\">Approve the architecture before the generator writes slides. This is the course plan Bernard and the generator should follow.</p>" +
      "<div class=\"blueprint-grid\">" + modules.map(function (module) {
        return "<div class=\"blueprint-module\"><span>" + esc(module.slides + " slides") + "</span><strong>" + esc(module.title) + "</strong><p>" + esc(module.goal) + "</p></div>";
      }).join("") + "</div>" +
      "<label class=\"choice blueprint-approval\"><input type=\"checkbox\" data-blueprint-approved> <span>I approve this blueprint for generation.</span></label>",
      "full blueprint-card");
  }

  function blueprintModules() {
    var tier = classTier();
    var total = Math.max(tier.slides, Number(brief.length.slide_budget) || tier.slides);
    var teaching = Math.max(1, total - 1);
    var weights = [
      ["Orientation and learner baseline", 0.08, "Set purpose, audience floor, assumptions, and success criteria."],
      ["Knowledge base and source boundary", 0.12, "Show what sources can support, what is missing, and what must not be invented."],
      ["Core concepts and vocabulary", 0.18, "Teach essential terms, mental models, and decision points."],
      ["Guided practice and examples", 0.22, "Work through realistic cases, mistakes, and checks for understanding."],
      ["Deep dives, edge cases, and quality risks", 0.22, "Add expert detail, safety cautions, disagreement, and richer transfer examples."],
      ["Assessment, transfer, and works cited", 0.18, "Prove mastery, capture participation, and close with sources and next research needs."]
    ];
    var used = 0;
    return weights.map(function (item, index) {
      var slides = index === weights.length - 1 ? Math.max(1, teaching - used) : Math.max(1, Math.round(teaching * item[1]));
      used += slides;
      return { title: item[0], slides: slides, goal: item[2] };
    });
  }

  function standardStat(label, value) {
    return "<div class=\"standard-stat\"><span>" + esc(label) + "</span><strong>" + esc(value) + "</strong></div>";
  }

  function sourceCompositionList() {
    if (!brief.knowledge_base.uploads.length) {
      return "<div class=\"kb-empty\">Add at least one source so the class maker can build a works cited list and information-literacy report.</div>";
    }
    return "<div class=\"kb-composition-list\">" + brief.knowledge_base.uploads.map(function (source, index) {
      var path = source.path || "Untitled source";
      var type = source.type || "document";
      var trust = source.trust || "unknown";
      var link = /^https?:\/\//i.test(path);
      var media = type === "video" || type === "audio";
      var status = link ? "Link available" : "Queued for ingestion";
      if (media) status = link ? "Media link available" : "Media file queued";
      return "<div class=\"kb-source-card\">" +
        "<div class=\"kb-source-top\"><span>S" + String(index + 1).padStart(2, "0") + "</span><strong>" + esc(sourceLabelFor(path)) + "</strong></div>" +
        "<div class=\"kb-source-path\">" + (link ? "<a href=\"" + attr(path) + "\" target=\"_blank\" rel=\"noreferrer\">" + esc(path) + "</a>" : esc(path)) + "</div>" +
        "<div class=\"kb-source-meta\"><span>Type: " + esc(optionLabel(sourceTypeOptions(), type)) + "</span><span>Creator ranking: " + esc(optionLabel(sourceTrustOptions(), trust)) + "</span><span>" + esc(status) + "</span></div>" +
        "</div>";
    }).join("") + "</div>";
  }

  function sourceQualityMetric() {
    return "<details class=\"source-metric\"><summary>How source quality will be graded</summary>" +
      "<p><strong>Credibility ranking</strong> starts with the source type and the class maker's trust label: primary sources rank highest, secondary sources rank next, and unknown sources require extra caution.</p>" +
      "<p><strong>Reliability ranking</strong> asks whether the source is accessible, specific, recent enough for the claim, internally consistent, and corroborated by another independent source when the claim is statistical, forward-looking, or contested.</p>" +
      "<p><strong>Information-literacy finding</strong> explains whether the source can support factual claims now, should be used only for context, or needs a transcript/extracted text before Bernard can teach from it.</p>" +
      "</details>";
  }

  function sourceRuleFields() {
    return "<div class=\"field full\"><span class=\"mini-label\">Require two independent sources for</span><div class=\"choice-grid\">" +
      sourceRules.map(function (rule) {
        var checked = brief.knowledge_base.credibility.require_two_sources_for.indexOf(rule) !== -1;
        return "<label class=\"choice\"><input type=\"checkbox\" data-source-rule value=\"" + attr(rule) + "\"" +
          (checked ? " checked" : "") + "> <span>" + esc(rule) + "</span></label>";
      }).join("") + "</div></div>";
  }

  function objectiveModes() {
    var modes = [
      ["human", "Human-led", "The class creator writes the early target and can ask AI for draft gaps."],
      ["hybrid", "Human + AI", "AI suggests a provisional first pass, then the class creator edits it."],
      ["ai", "AI brainstorm", "AI drafts provisional target ideas from the brief. Final TLO/ELOs wait for research."]
    ];
    return "<div class=\"mode-grid\">" + modes.map(function (mode) {
      return "<label class=\"mode-card\"><input type=\"radio\" name=\"objectiveMode\" data-objective-mode value=\"" + mode[0] + "\"" +
        (state.objectiveMode === mode[0] ? " checked" : "") + "> <span><strong>" + esc(mode[1]) +
        "</strong><small>" + esc(mode[2]) + "</small></span></label>";
    }).join("") + "</div>";
  }

  function languageControls() {
    return controlSelect("Student preferred language", "data-student-language", state.studentLanguage, languages) +
      controlSelect("Presentation format", "data-language-delivery", state.delivery, [
        ["english", "English only"],
        ["translated", "Translate into student language"],
        ["split", "Split screen: English + student language"]
      ]);
  }

  function controlSelect(label, attrs, value, options) {
    return "<div class=\"field\"><label>" + esc(label) + "</label><select " + attrs + ">" + optionTags(options, value) + "</select></div>";
  }

  function aiNotice() {
    if (!state.aiStatus) return "";
    return "<div class=\"notice" + (state.aiStatus.warn ? " warn" : "") + "\">" + esc(state.aiStatus.text) + "</div>";
  }

  function technicalOptions() {
    return [["non", "Non-technical"], ["mixed", "Mixed"], ["technical", "Technical"]];
  }

  function sourceTypeSelect(value, attrs) {
    return "<select " + attrs + " aria-label=\"Source type\">" +
      optionTags(sourceTypeOptions(), value) +
      "</select>";
  }

  function sourceTypeOptions() {
    return [
      ["document", "Document"],
      ["pdf", "PDF"],
      ["url", "URL"],
      ["video", "Video"],
      ["audio", "Audio"],
      ["notes", "Notes"],
      ["data", "Data"],
      ["standard", "Standard / code"],
      ["manufacturer guide", "Manufacturer / technical guide"],
      ["safety procedure", "Safety / compliance procedure"],
      ["certification training", "Training / certification"]
    ];
  }

  function sourceTrustSelect(value, attrs) {
    return "<select " + attrs + " aria-label=\"Source trust\">" +
      optionTags(sourceTrustOptions(), value) +
      "</select>";
  }

  function sourceTrustOptions() {
    return [["primary", "Primary"], ["secondary", "Secondary"], ["unknown", "Unknown"]];
  }

  function onInput(event) {
    var target = event.target;
    if (target.dataset.path) {
      var value = target.value;
      if (target.dataset.path === "meta.created" && value) value = new Date(value).toISOString();
      if (target.dataset.path === "meta.slug") {
        state.slugTouched = true;
        value = slugify(value);
        target.value = value;
      }
      setPath(target.dataset.path, value);
      if (target.dataset.path === "meta.title" && !state.slugTouched) {
        brief.meta.slug = slugify(value);
        var slugInput = els.form.querySelector("[data-path=\"meta.slug\"]");
        if (slugInput) slugInput.value = brief.meta.slug;
      }
      syncOutput();
      return;
    }
    if (target.dataset.numberPath) {
      setPath(target.dataset.numberPath, parseNumber(target.value));
      syncOutput();
      return;
    }
    if (target.dataset.linesPath) {
      setPath(target.dataset.linesPath, toArray(target.value));
      syncOutput();
      return;
    }
    if (target.dataset.sourceField) {
      brief.knowledge_base.uploads[Number(target.dataset.sourceIndex)][target.dataset.sourceField] = target.value;
      syncOutput();
    }
  }

  function onChange(event) {
    var target = event.target;
    if (target.dataset.objectiveMode !== undefined) {
      state.objectiveMode = target.value;
      state.aiStatus = null;
      render();
      return;
    }
    if (target.dataset.researchOwner !== undefined) {
      applyResearchOwner(target.value);
      state.researchStatus = null;
      render();
      return;
    }
    if (target.dataset.deepDiveMode !== undefined) {
      brief.mastery.deep_dive_density = target.value;
      syncOutput();
      render();
      return;
    }
    if (target.dataset.classTierLevel !== undefined) {
      brief.class_tier.level = target.value;
      syncOutput();
      render();
      return;
    }
    if (target.dataset.studentLanguage !== undefined) {
      state.studentLanguage = target.value;
      applyLanguagePreference();
      render();
      return;
    }
    if (target.dataset.languageDelivery !== undefined) {
      state.delivery = target.value;
      applyLanguagePreference();
      render();
      return;
    }
    if (target.dataset.booleanPath) {
      setPath(target.dataset.booleanPath, target.checked);
      syncOutput();
      return;
    }
    if (target.dataset.sourceRule !== undefined) {
      brief.knowledge_base.credibility.require_two_sources_for = Array.from(
        els.form.querySelectorAll("[data-source-rule]:checked")
      ).map(function (box) { return box.value; });
      syncOutput();
      return;
    }
    if (target.dataset.fileUpload !== undefined) {
      Array.from(target.files || []).forEach(function (file) {
        brief.knowledge_base.uploads.push({ path: file.name, type: inferType(file.name, file.type), trust: "unknown" });
      });
      render();
    }
  }

  function onClick(event) {
    var aiButton = event.target.closest("[data-ai]");
    var researchButton = event.target.closest("[data-research-action]");
    var addButton = event.target.closest("[data-add-source]");
    var removeButton = event.target.closest("[data-remove-source]");
    if (aiButton) return draftObjectives(aiButton.dataset.ai);
    if (researchButton) return handleResearchAction(researchButton.dataset.researchAction);
    if (addButton) return addSource();
    if (removeButton) {
      brief.knowledge_base.uploads.splice(Number(removeButton.dataset.removeSource), 1);
      render();
      return;
    }
    if (event.target.closest("[data-copy-launch]")) return copyLaunchLink();
    if (event.target.closest("[data-post-review]")) return postBrief();
  }

  function addSource() {
    var pathInput = els.form.querySelector("[data-new-source-path]");
    var typeInput = els.form.querySelector("[data-new-source-type]");
    var trustInput = els.form.querySelector("[data-new-source-trust]");
    var path = pathInput.value.trim();
    if (!path) return;
    brief.knowledge_base.uploads.push({ path: path, type: typeInput.value, trust: trustInput.value });
    render();
  }

  function applyResearchOwner(owner) {
    brief.knowledge_base.research.owner = owner;
    if (owner === "creator") {
      if (brief.knowledge_base.research.mode === "collaborative") brief.knowledge_base.research.mode = "grounded";
      return;
    }
    brief.knowledge_base.research.mode = "collaborative";
    brief.knowledge_base.research.allow_web = true;
  }

  function mergeResearchPrompts(prompts) {
    var existing = brief.knowledge_base.research.seed_prompts || [];
    brief.knowledge_base.research.seed_prompts = merge(existing, prompts).slice(0, 18);
  }

  async function handleResearchAction(action) {
    if (action === "assign") {
      applyResearchOwner("ai");
      mergeResearchPrompts(researchSearchPlan());
      state.researchStatus = {
        text: "Research assigned to Bernard. During generation, Bernard will run verified OpenAI research, add source candidates only when URLs can be checked, and still pass source verification before a class is released."
      };
      render();
      return;
    }

    applyResearchOwner("assisted");
    mergeResearchPrompts(researchSearchPlan());
    state.researchStatus = { text: "Asking Bernard for a research plan..." };
    render();
    try {
      var response = await fetch("/api/genie", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: "knowledge",
          step_label: "Knowledge base",
          brief: brief,
          payload: {
            type: "research-help",
            question: "Help me research this topic enough to build the knowledge base. Identify missing source categories, search directions, and what should not become final learning objectives until verified."
          }
        })
      });
      var payload = await response.json().catch(function () {
        return { ok: false, errors: ["Bernard's research plan was not usable."] };
      });
      if (!response.ok || !payload.ok) throw new Error((payload.errors || ["Bernard could not make a research plan."]).join(" "));
      state.researchStatus = { text: payload.answer || "Bernard added research prompts and source gaps for the knowledge base." };
    } catch (error) {
      state.researchStatus = {
        warn: true,
        text: "Bernard could not connect, so I added the standard research prompts. Check OPENAI_API_KEY and OPENAI_MODEL in Vercel if you want live AI help."
      };
    }
    render();
  }

  async function draftObjectives(action) {
    state.aiStatus = { text: "Asking AI to review the class brief..." };
    render();
    try {
      var response = await fetch("/api/objectives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: action, mode: state.objectiveMode, brief: brief })
      });
      var payload = await response.json().catch(function () {
        return { ok: false, errors: ["AI response was not usable."] };
      });
      if (!response.ok || !payload.ok) throw new Error((payload.errors || ["AI assistance failed."]).join(" "));
      applyObjectiveDraft(payload.objectives || {}, action);
      state.aiStatus = { text: payload.message || "AI drafted provisional learning-target ideas. Review and edit them before generating." };
    } catch (error) {
      state.aiStatus = {
        warn: true,
        text: "AI could not finish: " + safeMessage(error && error.message ? error.message : "Check the OpenAI setup in Vercel, then redeploy.")
      };
    }
    render();
  }

  function applyObjectiveDraft(objectives, action) {
    var replace = action === "fill" || state.objectiveMode === "ai";
    brief.objectives.terminal = replace ? clean(objectives.terminal) : merge(brief.objectives.terminal, clean(objectives.terminal));
    brief.objectives.enabling = replace ? clean(objectives.enabling) : merge(brief.objectives.enabling, clean(objectives.enabling));
    brief.objectives.out_of_scope = replace ? clean(objectives.out_of_scope) : merge(brief.objectives.out_of_scope, clean(objectives.out_of_scope));
  }

  function applyLanguagePreference() {
    var language = state.studentLanguage || "en";
    if (state.delivery === "english" || language === "en") {
      brief.language.primary = "en";
      brief.language.localize_ui_strings = false;
      brief.language.glossary_in_primary = true;
      return;
    }
    brief.language.primary = state.delivery === "split" ? "en+" + language : language;
    brief.language.localize_ui_strings = true;
    brief.language.glossary_in_primary = true;
  }

  function syncOutput() {
    var result = validate();
    var launchUrl = getLaunchUrl();
    els.briefView.textContent = JSON.stringify(brief, null, 2);
    if (els.launchLink) {
      els.launchLink.href = launchUrl;
      els.launchLink.textContent = launchUrl;
    }
    if (els.drawerQr) els.drawerQr.src = qrUrl(launchUrl);
    els.validationBadge.textContent = result.ok ? "Valid" : "Needs fixes";
    els.validationBadge.classList.toggle("ok", result.ok);
    els.validationBadge.classList.toggle("warn", !result.ok);
    els.validationBox.innerHTML = result.ok ? "<strong>Setup check:</strong> Ready for the generator." : "<strong>Setup check:</strong>" + errorList(result.errors);
  }

  function validate() {
    return window.BriefValidator.validateBrief(brief, template);
  }

  function errorList(errors) {
    if (!errors || !errors.length) return "";
    return "<ul>" + errors.map(function (error) { return "<li>" + esc(error) + "</li>"; }).join("") + "</ul>";
  }

  function readinessNotes() {
    var warnings = [];
    if (!brief.meta.title.trim()) warnings.push("Add a class title.");
    if (!brief.knowledge_base.uploads.length && brief.knowledge_base.research.mode === "none") warnings.push("Research mode is uploads-only, but no sources are listed.");
    var tier = classTier();
    var primaryCount = brief.knowledge_base.uploads.filter(function (source) { return source.trust === "primary"; }).length;
    if (brief.knowledge_base.uploads.length < tier.sources || primaryCount < tier.primary) {
      if (brief.knowledge_base.research.owner === "ai") {
        warnings.push("Bernard is assigned to close the knowledge-base gap during generation; unverifiable sources will still be rejected.");
      } else {
        warnings.push("Knowledge base does not yet meet the " + tier.label + " standard: " + tier.sources + " usable sources and " + tier.primary + " primary sources are required.");
      }
    }
    if (!brief.objectives.terminal.length) warnings.push("Add an initial learning target if the creator already knows one.");
    if (!brief.objectives.enabling.length) warnings.push("Initial enabling skills are optional now; final ELOs should be produced after knowledge-base analysis.");
    if (!brief.audience.floor.background.trim()) warnings.push("Describe the floor learner's background.");
    warnings.push("Final TLOs and ELOs must be confirmed after research, knowledge-base analysis, and learner-profile review.");
    return warnings.length ? "<ul>" + warnings.map(function (text) { return "<li>" + esc(text) + "</li>"; }).join("") + "</ul>" : "<div class=\"notice\">This setup has the basics needed for the next milestone.</div>";
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(brief, null, 2));
      toast("Copied setup data to clipboard.");
    } catch (error) {
      toast("Clipboard was blocked. Open Advanced setup data and copy manually.", true);
    }
  }

  async function copyLaunchLink() {
    try {
      await navigator.clipboard.writeText(getLaunchUrl());
      toast("Copied the Vercel launch link.");
    } catch (error) {
      toast("Clipboard was blocked. Copy the visible launch link manually.", true);
    }
  }

  function downloadBrief() {
    var blob = new Blob([JSON.stringify(brief, null, 2) + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "class-setup.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function postBrief() {
    var result = validate();
    var postResult = byId("postResult");
    if (!postResult) {
      state.step = steps.length - 1;
      render();
      postResult = byId("postResult");
    }
    if (!result.ok) {
      postResult.innerHTML = "<div class=\"notice warn\">Fix setup errors before starting the generator.</div>";
      return;
    }
    postResult.innerHTML = "<div class=\"notice\">Validating setup...</div>";
    try {
      var response = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brief)
      });
      var payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error((payload.errors || ["Post failed."]).join(" "));
      postResult.innerHTML = "<div class=\"notice\">Class setup accepted. It is ready for the Milestone 2 generator hook.</div>";
    } catch (error) {
      postResult.innerHTML = "<div class=\"notice warn\">The setup is valid, but /api/brief is not reachable in this preview. On Vercel, this button posts the same setup data to the serverless validator.</div>";
    }
  }

  function toast(message, isWarning) {
    els.validationBox.innerHTML = "<div class=\"notice" + (isWarning ? " warn" : "") + "\">" + esc(message) + "</div>";
    window.setTimeout(syncOutput, 1800);
  }

  function setContractStatus(text, mode) {
    els.contractStatus.textContent = text;
    els.contractStatus.classList.remove("ok", "warn");
    els.contractStatus.classList.add(mode);
  }

  function getPath(path) {
    return path.split(".").reduce(function (value, key) { return value[key]; }, brief);
  }

  function setPath(path, value) {
    var keys = path.split(".");
    var target = brief;
    keys.slice(0, -1).forEach(function (key) { target = target[key]; });
    target[keys[keys.length - 1]] = value;
  }

  function parseNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : 0;
  }

  function toArray(value) {
    return value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  }

  function toLines(value) {
    return Array.isArray(value) ? value.join("\n") : "";
  }

  function clean(value) {
    return Array.isArray(value) ? value.map(function (item) { return String(item || "").trim(); }).filter(Boolean) : [];
  }

  function merge(existing, incoming) {
    var merged = existing.slice();
    incoming.forEach(function (item) {
      if (!merged.some(function (oldItem) { return oldItem.toLowerCase() === item.toLowerCase(); })) merged.push(item);
    });
    return merged;
  }

  function languageSummary() {
    var language = optionLabel(languages, state.studentLanguage);
    if (state.delivery === "split" && state.studentLanguage !== "en") return "English + " + language + " split screen";
    if (state.delivery === "translated" && state.studentLanguage !== "en") return language + " translation";
    return "English";
  }

  function optionLabel(options, value) {
    var match = options.find(function (option) { return option[0] === value; });
    return match ? match[1] : value;
  }

  function getLaunchUrl() {
    if (window.location && window.location.origin && window.location.origin !== "null") return window.location.origin + "/";
    return "https://your-vercel-project.vercel.app/";
  }

  function qrUrl(value) {
    return "/api/qr?url=" + encodeURIComponent(value);
  }

  function fieldId(path) {
    return "field-" + path.replace(/\./g, "-");
  }

  function slugify(value) {
    return String(value || "").toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }

  function inferType(name, mime) {
    var lower = name.toLowerCase();
    if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
    if (lower.startsWith("http://") || lower.startsWith("https://")) return "url";
    if ((mime || "").startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(lower)) return "video";
    if ((mime || "").startsWith("audio/") || /\.(mp3|m4a|wav|aac|ogg)$/i.test(lower)) return "audio";
    if (lower.endsWith(".csv") || lower.endsWith(".xlsx")) return "data";
    if (lower.endsWith(".txt") || lower.endsWith(".md")) return "notes";
    return "document";
  }

  function sourceLabelFor(value) {
    try {
      if (/^https?:\/\//i.test(value)) return new URL(value).hostname.replace(/^www\./, "");
    } catch (error) {}
    return String(value || "").split("/").pop() || value;
  }

  function formatValue(value, type) {
    if (type === "datetime-local" && value) {
      var date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 16);
    }
    return value == null ? "" : String(value);
  }

  function esc(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function safeMessage(value) {
    var keyPrefix = ["s", "k"].join("") + "-";
    var projectKeyPattern = new RegExp(keyPrefix + "proj-[A-Za-z0-9_-]+", "g");
    var anyKeyPattern = new RegExp(keyPrefix + "[A-Za-z0-9_-]+", "g");
    return String(value || "")
      .replace(projectKeyPattern, "[redacted OpenAI key]")
      .replace(anyKeyPattern, "[redacted API key]")
      .replace(/Bearer\s+[^"'`]+/g, "Bearer [redacted]");
  }

  function attr(value) {
    return esc(value).replace(/`/g, "&#96;");
  }
})();
