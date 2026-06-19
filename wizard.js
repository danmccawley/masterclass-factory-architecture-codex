(function initClassCreator() {
  "use strict";

  var steps = [
    ["create", "Create", "Name the class", "Start with the class title and a short link-friendly name. The required engine version stays fixed in the background."],
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
    aiStatus: null
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
      knowledge_base: {
        uploads: [],
        research: {
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
        deep_dive_density: "med",
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
      inputField("Created", "meta.created", "", "datetime-local")
    );
  }

  function knowledgeStep() {
    return (
      "<div class=\"form-grid single\">" +
      "<div class=\"field full upload-box\"><label>Upload source files</label><input type=\"file\" multiple data-file-upload>" +
      "<p class=\"hint\">The browser records file names as source paths. The later research stage ingests the actual files.</p></div>" +
      "<div class=\"field full\"><label>Add a source path or URL</label><div class=\"source-row\">" +
      "<input type=\"text\" data-new-source-path placeholder=\"source.pdf or https://example.com/report\">" +
      sourceTypeSelect("", "data-new-source-type") +
      sourceTrustSelect("secondary", "data-new-source-trust") +
      "<button type=\"button\" class=\"primary\" data-add-source>Add</button></div>" +
      sourceRows() + "</div>" +
      grid(
        selectField("Research mode", "knowledge_base.research.mode", [
          ["none", "Uploads only"],
          ["grounded", "Grounded in corpus"],
          ["collaborative", "May propose new sources"]
        ]) +
        checkboxField("Allow web research in collaborative mode", "knowledge_base.research.allow_web") +
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
    return grid(
      numberField("Target mastery level", "mastery.target_level", 1, 5) +
      selectField("Granularity", "mastery.granularity", [["survey", "Survey"], ["working", "Working"], ["deep", "Deep"]]) +
      selectField("Deep-dive density", "mastery.deep_dive_density", [["low", "Low"], ["med", "Medium"], ["high", "High"]]) +
      checkboxField("Include where-the-field-disagrees material", "mastery.field_disagreement")
    );
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
      numberField("Slide budget", "length.slide_budget", 1, 400) +
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
      card("Generator readiness",
        (result.ok ? "<div class=\"notice\">The class setup is ready for the generator.</div>" : "<div class=\"notice warn\">Fix the listed setup errors before starting the generator.</div>") +
        errorList(result.errors)) +
      card("Readiness notes", readinessNotes()) +
      "<div class=\"review-actions\"><button type=\"button\" class=\"ghost\" data-copy-launch>Copy launch link</button>" +
      "<button type=\"button\" class=\"ghost\" data-copy-review>Copy setup data</button>" +
      "<button type=\"button\" class=\"ghost\" data-download-review>Download setup file</button>" +
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
      optionTags([["document", "Document"], ["pdf", "PDF"], ["url", "URL"], ["notes", "Notes"], ["data", "Data"]], value) +
      "</select>";
  }

  function sourceTrustSelect(value, attrs) {
    return "<select " + attrs + " aria-label=\"Source trust\">" +
      optionTags([["primary", "Primary"], ["secondary", "Secondary"], ["unknown", "Unknown"]], value) +
      "</select>";
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
    var addButton = event.target.closest("[data-add-source]");
    var removeButton = event.target.closest("[data-remove-source]");
    if (aiButton) return draftObjectives(aiButton.dataset.ai);
    if (addButton) return addSource();
    if (removeButton) {
      brief.knowledge_base.uploads.splice(Number(removeButton.dataset.removeSource), 1);
      render();
      return;
    }
    if (event.target.closest("[data-copy-launch]")) return copyLaunchLink();
    if (event.target.closest("[data-copy-review]")) return copyBrief();
    if (event.target.closest("[data-download-review]")) return downloadBrief();
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
    var language = labelFor(languages, state.studentLanguage);
    if (state.delivery === "split" && state.studentLanguage !== "en") return "English + " + language + " split screen";
    if (state.delivery === "translated" && state.studentLanguage !== "en") return language + " translation";
    return "English";
  }

  function labelFor(options, value) {
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
    if (lower.endsWith(".csv") || lower.endsWith(".xlsx")) return "data";
    if (lower.endsWith(".txt") || lower.endsWith(".md")) return "notes";
    return "document";
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
    return String(value || "")
      .replace(/sk-proj-[A-Za-z0-9_-]+/g, "[redacted OpenAI key]")
      .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted API key]")
      .replace(/Bearer\s+[^"'`]+/g, "Bearer [redacted]");
  }

  function attr(value) {
    return esc(value).replace(/`/g, "&#96;");
  }
})();
