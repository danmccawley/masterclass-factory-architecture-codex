(function initClassCreator() {
  "use strict";

  var steps = [
    {
      id: "create",
      title: "Create",
      short: "Name the class",
      copy: "Start with the title and stable deck slug. The engine contract stays pinned to v-texas."
    },
    {
      id: "knowledge",
      title: "Knowledge base",
      short: "Sources and research",
      copy: "Add source files or URLs, then choose how tightly later stages may research around them."
    },
    {
      id: "objectives",
      title: "Objectives",
      short: "Learning target",
      copy: "Define what the learner should be able to do, the supporting skills, and what is out of scope."
    },
    {
      id: "mastery",
      title: "Mastery",
      short: "Depth and checks",
      copy: "Set the intended assessment level and how much disagreement or deep-dive material the course should include."
    },
    {
      id: "demographics",
      title: "Demographics",
      short: "Typical and floor",
      copy: "Describe the typical learner and the floor learner. The floor learner controls reading level and clarity."
    },
    {
      id: "length",
      title: "Length",
      short: "Time and budget",
      copy: "Choose the class length, slide budget, and interaction budget that the curriculum stage must obey."
    },
    {
      id: "language",
      title: "Language",
      short: "Locale and glossary",
      copy: "Set the primary teaching language and whether UI strings and glossary entries should localize."
    },
    {
      id: "review",
      title: "Review & Generate",
      short: "Validate JSON",
      copy: "Review the exact brief.json. Milestone 1 can download it or post it to /api/brief for contract validation."
    }
  ];

  var defaultTags = ["statistics", "forward-looking claims", "contested points"];
  var currentStep = 0;
  var slugTouched = false;
  var template = window.BriefValidator.DEFAULT_TEMPLATE;
  var brief = makeBrief();

  var els = {
    stepList: document.getElementById("stepList"),
    stepEyebrow: document.getElementById("stepEyebrow"),
    stepTitle: document.getElementById("stepTitle"),
    progressFill: document.getElementById("progressFill"),
    form: document.getElementById("wizardForm"),
    back: document.getElementById("backButton"),
    next: document.getElementById("nextButton"),
    briefView: document.getElementById("briefView"),
    validationBadge: document.getElementById("validationBadge"),
    validationBox: document.getElementById("validationBox"),
    contractStatus: document.getElementById("contractStatus"),
    copy: document.getElementById("copyButton"),
    download: document.getElementById("downloadButton")
  };

  loadTemplate();
  render();
  bindEvents();

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
          require_two_sources_for: defaultTags.slice()
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

  function bindEvents() {
    els.stepList.addEventListener("click", function onStepClick(event) {
      var button = event.target.closest("[data-step-index]");
      if (!button) return;
      currentStep = Number(button.dataset.stepIndex);
      render();
    });

    els.form.addEventListener("input", onFormInput);
    els.form.addEventListener("change", onFormChange);
    els.form.addEventListener("click", onFormClick);

    els.back.addEventListener("click", function goBack() {
      if (currentStep > 0) {
        currentStep -= 1;
        render();
      }
    });

    els.next.addEventListener("click", function goNextOrPost() {
      if (currentStep < steps.length - 1) {
        currentStep += 1;
        render();
        return;
      }
      postBrief();
    });

    els.copy.addEventListener("click", copyBrief);
    els.download.addEventListener("click", downloadBrief);
  }

  async function loadTemplate() {
    try {
      var response = await fetch("brief.template.json", { cache: "no-store" });
      if (!response.ok) throw new Error("brief.template.json was not found.");
      template = await response.json();
      var templateResult = window.BriefValidator.validateBrief(template, template);
      if (!templateResult.ok) {
        throw new Error("brief.template.json does not validate itself.");
      }
      setContractStatus("Contract loaded", "ok");
      updateBriefView();
    } catch (error) {
      setContractStatus("Using embedded contract", "warn");
    }
  }

  function setContractStatus(text, mode) {
    els.contractStatus.textContent = text;
    els.contractStatus.classList.remove("ok", "warn");
    els.contractStatus.classList.add(mode);
  }

  function render() {
    renderStepList();
    renderCurrentStep();
    updateBriefView();
  }

  function renderStepList() {
    els.stepList.innerHTML = steps
      .map(function mapStep(step, index) {
        var classes = ["step-button"];
        if (index === currentStep) classes.push("active");
        if (index < currentStep) classes.push("done");
        return (
          "<li>" +
          '<button type="button" class="' +
          classes.join(" ") +
          '" data-step-index="' +
          index +
          '">' +
          '<span class="step-num">' +
          String(index + 1).padStart(2, "0") +
          "</span>" +
          "<span>" +
          '<span class="step-label">' +
          escapeHtml(step.title) +
          "</span>" +
          '<span class="step-sub">' +
          escapeHtml(step.short) +
          "</span>" +
          "</span>" +
          "</button>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderCurrentStep() {
    var step = steps[currentStep];
    els.stepEyebrow.textContent = "Step " + (currentStep + 1) + " of " + steps.length;
    els.stepTitle.textContent = step.title;
    els.progressFill.style.width = ((currentStep + 1) / steps.length) * 100 + "%";
    els.form.innerHTML =
      '<p class="step-copy">' + escapeHtml(step.copy) + "</p>" + renderStepBody(step.id);
    els.back.disabled = currentStep === 0;
    els.next.textContent = currentStep === steps.length - 1 ? "Generate" : "Next";
  }

  function renderStepBody(id) {
    if (id === "create") return renderCreate();
    if (id === "knowledge") return renderKnowledge();
    if (id === "objectives") return renderObjectives();
    if (id === "mastery") return renderMastery();
    if (id === "demographics") return renderDemographics();
    if (id === "length") return renderLength();
    if (id === "language") return renderLanguage();
    return renderReview();
  }

  function renderCreate() {
    return (
      '<div class="form-grid">' +
      textField("Class title", "meta.title", brief.meta.title, "Example: AI Strategy for Healthcare Leaders") +
      textField("Deck slug", "meta.slug", brief.meta.slug, "ai-strategy-healthcare-leaders") +
      textField("Created", "meta.created", brief.meta.created, "", "datetime-local") +
      selectField("Engine contract", "meta.engine_contract", brief.meta.engine_contract, [["v-texas", "v-texas"]]) +
      "</div>"
    );
  }

  function renderKnowledge() {
    return (
      '<div class="form-grid single">' +
      '<div class="field full upload-box">' +
      "<label>Upload source files</label>" +
      '<input type="file" multiple data-file-upload>' +
      '<p class="hint">The browser records file names as source paths in brief.json. The later research stage ingests the actual files.</p>' +
      "</div>" +
      '<div class="field full">' +
      "<label>Add a source path or URL</label>" +
      '<div class="source-row">' +
      '<input type="text" data-new-source-path placeholder="source.pdf or https://example.com/report">' +
      sourceTypeSelect("", "data-new-source-type") +
      sourceTrustSelect("secondary", "data-new-source-trust") +
      '<button type="button" class="primary" data-add-source>Add</button>' +
      "</div>" +
      renderSources() +
      "</div>" +
      '<div class="form-grid">' +
      selectField("Research mode", "knowledge_base.research.mode", brief.knowledge_base.research.mode, [
        ["none", "Uploads only"],
        ["grounded", "Grounded in corpus"],
        ["collaborative", "May propose new sources"]
      ]) +
      checkboxField("Allow web research in collaborative mode", "knowledge_base.research.allow_web", brief.knowledge_base.research.allow_web) +
      textField("Recency floor", "knowledge_base.research.recency_floor", brief.knowledge_base.research.recency_floor, "2024-01-01", "date") +
      selectField("Minimum source tier", "knowledge_base.credibility.min_tier", brief.knowledge_base.credibility.min_tier, [
        ["primary", "Primary"],
        ["secondary", "Secondary"],
        ["unknown", "Unknown allowed"]
      ]) +
      textAreaField("Research seed prompts", "knowledge_base.research.seed_prompts", toLines(brief.knowledge_base.research.seed_prompts), "One prompt per line") +
      renderSourceRules() +
      "</div>" +
      "</div>"
    );
  }

  function renderObjectives() {
    return (
      '<div class="form-grid single">' +
      textAreaField("Terminal objectives", "objectives.terminal", toLines(brief.objectives.terminal), "One must-do outcome per line") +
      textAreaField("Enabling objectives", "objectives.enabling", toLines(brief.objectives.enabling), "One supporting skill per line") +
      textAreaField("Out of scope", "objectives.out_of_scope", toLines(brief.objectives.out_of_scope), "One excluded topic per line") +
      "</div>"
    );
  }

  function renderMastery() {
    return (
      '<div class="form-grid">' +
      numberField("Target mastery level", "mastery.target_level", brief.mastery.target_level, 1, 5) +
      selectField("Granularity", "mastery.granularity", brief.mastery.granularity, [
        ["survey", "Survey"],
        ["working", "Working"],
        ["deep", "Deep"]
      ]) +
      selectField("Deep-dive density", "mastery.deep_dive_density", brief.mastery.deep_dive_density, [
        ["low", "Low"],
        ["med", "Medium"],
        ["high", "High"]
      ]) +
      checkboxField("Include where-the-field-disagrees material", "mastery.field_disagreement", brief.mastery.field_disagreement) +
      "</div>"
    );
  }

  function renderDemographics() {
    return (
      '<div class="form-grid">' +
      '<div class="summary-card full"><h3>Typical learner</h3><div class="form-grid">' +
      textField("Age band", "audience.average.age_band", brief.audience.average.age_band, "35-54") +
      textField("Education", "audience.average.education", brief.audience.average.education, "College or equivalent work experience") +
      textField("Background", "audience.average.background", brief.audience.average.background, "Department leaders") +
      selectField("Technical comfort", "audience.average.technical", brief.audience.average.technical, technicalOptions()) +
      textField("Role", "audience.average.role", brief.audience.average.role, "Manager, director, operator") +
      "</div></div>" +
      '<div class="summary-card full"><h3>Floor learner</h3><div class="form-grid">' +
      textField("Age band", "audience.floor.age_band", brief.audience.floor.age_band, "18+") +
      textField("Education", "audience.floor.education", brief.audience.floor.education, "High school") +
      textField("Background", "audience.floor.background", brief.audience.floor.background, "No prior topic knowledge") +
      selectField("Technical comfort", "audience.floor.technical", brief.audience.floor.technical, technicalOptions()) +
      textField("Role", "audience.floor.role", brief.audience.floor.role, "General audience") +
      "</div></div>" +
      textField("Gender mix", "audience.gender_mix", brief.audience.gender_mix, "Mixed") +
      selectField("Tone", "audience.tone", brief.audience.tone, [
        ["plain", "Plain"],
        ["warm", "Warm"],
        ["executive", "Executive"],
        ["academic", "Academic"],
        ["workshop", "Workshop"]
      ]) +
      numberField("Reading grade cap", "audience.accessibility.reading_grade_cap", brief.audience.accessibility.reading_grade_cap, 3, 16) +
      "</div>"
    );
  }

  function renderLength() {
    return (
      '<div class="form-grid">' +
      numberField("Minutes", "length.minutes", brief.length.minutes, 10, 480) +
      numberField("Slide budget", "length.slide_budget", brief.length.slide_budget, 1, 400) +
      numberField("Polls", "length.interaction_budget.polls", brief.length.interaction_budget.polls, 0, 50) +
      numberField("Word clouds", "length.interaction_budget.word_clouds", brief.length.interaction_budget.word_clouds, 0, 50) +
      numberField("Quizzes", "length.interaction_budget.quizzes", brief.length.interaction_budget.quizzes, 0, 50) +
      checkboxField("Include final test", "length.interaction_budget.final_test", brief.length.interaction_budget.final_test) +
      "</div>"
    );
  }

  function renderLanguage() {
    return (
      '<div class="form-grid">' +
      selectField("Primary language", "language.primary", brief.language.primary, [
        ["en", "English"],
        ["es", "Spanish"],
        ["fr", "French"],
        ["de", "German"],
        ["pt", "Portuguese"],
        ["it", "Italian"]
      ]) +
      checkboxField("Localize UI strings", "language.localize_ui_strings", brief.language.localize_ui_strings) +
      checkboxField("Glossary in primary language", "language.glossary_in_primary", brief.language.glossary_in_primary) +
      "</div>"
    );
  }

  function renderReview() {
    var result = window.BriefValidator.validateBrief(brief, template);
    var readiness = readinessWarnings();
    return (
      '<div class="form-grid single">' +
      '<div class="summary-card">' +
      "<h3>Contract status</h3>" +
      (result.ok
        ? '<div class="notice">brief.json matches the exact Milestone 1 contract.</div>'
        : '<div class="notice warn">Fix the listed contract errors before posting.</div>') +
      renderErrorList(result.errors) +
      "</div>" +
      '<div class="summary-card">' +
      "<h3>Readiness notes</h3>" +
      (readiness.length
        ? "<ul>" + readiness.map(function item(text) { return "<li>" + escapeHtml(text) + "</li>"; }).join("") + "</ul>"
        : '<div class="notice">This brief has the basics needed for the next milestone.</div>') +
      "</div>" +
      '<div class="review-actions">' +
      '<button type="button" class="ghost" data-copy-review>Copy JSON</button>' +
      '<button type="button" class="ghost" data-download-review>Download brief.json</button>' +
      '<button type="button" class="primary" data-post-review>POST brief.json</button>' +
      "</div>" +
      '<div id="postResult" class="validation-box"></div>' +
      "</div>"
    );
  }

  function renderSources() {
    if (!brief.knowledge_base.uploads.length) {
      return '<div class="hint">No sources added yet.</div>';
    }
    return (
      '<div class="source-list">' +
      brief.knowledge_base.uploads
        .map(function sourceRow(source, index) {
          return (
            '<div class="source-row">' +
            '<input type="text" data-source-field="path" data-source-index="' +
            index +
            '" value="' +
            escapeAttr(source.path) +
            '" aria-label="Source path">' +
            sourceTypeSelect(source.type, 'data-source-field="type" data-source-index="' + index + '"') +
            sourceTrustSelect(source.trust, 'data-source-field="trust" data-source-index="' + index + '"') +
            '<button type="button" class="remove-source" data-remove-source="' +
            index +
            '" aria-label="Remove source">x</button>' +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderSourceRules() {
    return (
      '<div class="field full">' +
      '<span class="mini-label">Require two independent sources for</span>' +
      '<div class="choice-grid">' +
      defaultTags
        .map(function mapTag(tag) {
          var checked = brief.knowledge_base.credibility.require_two_sources_for.indexOf(tag) !== -1;
          return (
            '<label class="choice">' +
            '<input type="checkbox" data-source-rule value="' +
            escapeAttr(tag) +
            '"' +
            (checked ? " checked" : "") +
            "> " +
            '<span>' +
            escapeHtml(tag) +
            "</span>" +
            "</label>"
          );
        })
        .join("") +
      "</div>" +
      "</div>"
    );
  }

  function textField(label, path, value, placeholder, type) {
    return (
      '<div class="field">' +
      '<label for="' +
      fieldId(path) +
      '">' +
      escapeHtml(label) +
      "</label>" +
      '<input id="' +
      fieldId(path) +
      '" type="' +
      (type || "text") +
      '" data-path="' +
      path +
      '" value="' +
      escapeAttr(formatInputValue(value, type)) +
      '" placeholder="' +
      escapeAttr(placeholder || "") +
      '">' +
      "</div>"
    );
  }

  function numberField(label, path, value, min, max) {
    return (
      '<div class="field">' +
      '<label for="' +
      fieldId(path) +
      '">' +
      escapeHtml(label) +
      "</label>" +
      '<input id="' +
      fieldId(path) +
      '" type="number" data-number-path="' +
      path +
      '" min="' +
      min +
      '" max="' +
      max +
      '" value="' +
      escapeAttr(String(value)) +
      '">' +
      "</div>"
    );
  }

  function textAreaField(label, path, value, placeholder) {
    return (
      '<div class="field full">' +
      '<label for="' +
      fieldId(path) +
      '">' +
      escapeHtml(label) +
      "</label>" +
      '<textarea id="' +
      fieldId(path) +
      '" data-lines-path="' +
      path +
      '" placeholder="' +
      escapeAttr(placeholder || "") +
      '">' +
      escapeHtml(value) +
      "</textarea>" +
      "</div>"
    );
  }

  function selectField(label, path, value, options) {
    return (
      '<div class="field">' +
      '<label for="' +
      fieldId(path) +
      '">' +
      escapeHtml(label) +
      "</label>" +
      '<select id="' +
      fieldId(path) +
      '" data-path="' +
      path +
      '">' +
      options
        .map(function option(opt) {
          return (
            '<option value="' +
            escapeAttr(opt[0]) +
            '"' +
            (opt[0] === value ? " selected" : "") +
            ">" +
            escapeHtml(opt[1]) +
            "</option>"
          );
        })
        .join("") +
      "</select>" +
      "</div>"
    );
  }

  function checkboxField(label, path, value) {
    return (
      '<label class="choice">' +
      '<input type="checkbox" data-boolean-path="' +
      path +
      '"' +
      (value ? " checked" : "") +
      "> " +
      "<span>" +
      escapeHtml(label) +
      "</span>" +
      "</label>"
    );
  }

  function sourceTypeSelect(value, attrs) {
    var options = [
      ["document", "Document"],
      ["pdf", "PDF"],
      ["url", "URL"],
      ["notes", "Notes"],
      ["data", "Data"]
    ];
    return (
      "<select " +
      attrs +
      ' aria-label="Source type">' +
      options
        .map(function opt(option) {
          return (
            '<option value="' +
            option[0] +
            '"' +
            (option[0] === value ? " selected" : "") +
            ">" +
            option[1] +
            "</option>"
          );
        })
        .join("") +
      "</select>"
    );
  }

  function sourceTrustSelect(value, attrs) {
    var options = [
      ["primary", "Primary"],
      ["secondary", "Secondary"],
      ["unknown", "Unknown"]
    ];
    return (
      "<select " +
      attrs +
      ' aria-label="Source trust">' +
      options
        .map(function opt(option) {
          return (
            '<option value="' +
            option[0] +
            '"' +
            (option[0] === value ? " selected" : "") +
            ">" +
            option[1] +
            "</option>"
          );
        })
        .join("") +
      "</select>"
    );
  }

  function technicalOptions() {
    return [
      ["non", "Non-technical"],
      ["mixed", "Mixed"],
      ["technical", "Technical"]
    ];
  }

  function onFormInput(event) {
    var target = event.target;
    if (target.dataset.path) {
      var value = target.value;
      if (target.dataset.path === "meta.created" && value) {
        value = new Date(value).toISOString();
      }
      setPath(target.dataset.path, value);
      if (target.dataset.path === "meta.title" && !slugTouched) {
        brief.meta.slug = slugify(value);
        var slugInput = els.form.querySelector('[data-path="meta.slug"]');
        if (slugInput) slugInput.value = brief.meta.slug;
      }
      if (target.dataset.path === "meta.slug") {
        slugTouched = true;
        brief.meta.slug = slugify(value);
        target.value = brief.meta.slug;
      }
      updateBriefView();
      return;
    }

    if (target.dataset.numberPath) {
      setPath(target.dataset.numberPath, parseNumber(target.value));
      updateBriefView();
      return;
    }

    if (target.dataset.linesPath) {
      setPath(target.dataset.linesPath, toArray(target.value));
      updateBriefView();
      return;
    }

    if (target.dataset.sourceField) {
      var index = Number(target.dataset.sourceIndex);
      var key = target.dataset.sourceField;
      brief.knowledge_base.uploads[index][key] = target.value;
      updateBriefView();
    }
  }

  function onFormChange(event) {
    var target = event.target;
    if (target.dataset.path || target.dataset.numberPath || target.dataset.linesPath || target.dataset.sourceField) {
      onFormInput(event);
      return;
    }

    if (target.dataset.booleanPath) {
      setPath(target.dataset.booleanPath, target.checked);
      updateBriefView();
      return;
    }

    if (target.dataset.sourceRule !== undefined) {
      brief.knowledge_base.credibility.require_two_sources_for = Array.from(
        els.form.querySelectorAll("[data-source-rule]:checked")
      ).map(function checked(box) {
        return box.value;
      });
      updateBriefView();
      return;
    }

    if (target.dataset.fileUpload !== undefined) {
      Array.from(target.files || []).forEach(function addFile(file) {
        brief.knowledge_base.uploads.push({
          path: file.name,
          type: inferType(file.name, file.type),
          trust: "unknown"
        });
      });
      renderCurrentStep();
      updateBriefView();
    }
  }

  function onFormClick(event) {
    var addButton = event.target.closest("[data-add-source]");
    if (addButton) {
      var pathInput = els.form.querySelector("[data-new-source-path]");
      var typeInput = els.form.querySelector("[data-new-source-type]");
      var trustInput = els.form.querySelector("[data-new-source-trust]");
      var path = pathInput.value.trim();
      if (!path) return;
      brief.knowledge_base.uploads.push({
        path: path,
        type: typeInput.value,
        trust: trustInput.value
      });
      renderCurrentStep();
      updateBriefView();
      return;
    }

    var removeButton = event.target.closest("[data-remove-source]");
    if (removeButton) {
      brief.knowledge_base.uploads.splice(Number(removeButton.dataset.removeSource), 1);
      renderCurrentStep();
      updateBriefView();
      return;
    }

    if (event.target.closest("[data-copy-review]")) {
      copyBrief();
      return;
    }
    if (event.target.closest("[data-download-review]")) {
      downloadBrief();
      return;
    }
    if (event.target.closest("[data-post-review]")) {
      postBrief();
    }
  }

  function updateBriefView() {
    var json = JSON.stringify(brief, null, 2);
    var result = window.BriefValidator.validateBrief(brief, template);
    els.briefView.textContent = json;
    els.validationBadge.textContent = result.ok ? "Valid" : "Needs fixes";
    els.validationBadge.classList.toggle("ok", result.ok);
    els.validationBadge.classList.toggle("warn", !result.ok);
    els.validationBox.innerHTML = result.ok
      ? "<strong>Contract check:</strong> Valid against brief.template.json."
      : "<strong>Contract check:</strong>" + renderErrorList(result.errors);
    if (steps[currentStep].id === "review") {
      var postResult = document.getElementById("postResult");
      if (postResult) postResult.innerHTML = "";
    }
  }

  function renderErrorList(errors) {
    if (!errors || !errors.length) return "";
    return "<ul>" + errors.map(function errorItem(error) {
      return "<li>" + escapeHtml(error) + "</li>";
    }).join("") + "</ul>";
  }

  function readinessWarnings() {
    var warnings = [];
    if (!brief.meta.title.trim()) warnings.push("Add a class title.");
    if (!brief.knowledge_base.uploads.length && brief.knowledge_base.research.mode === "none") {
      warnings.push("Research mode is uploads-only, but no sources are listed.");
    }
    if (!brief.objectives.terminal.length) warnings.push("Add at least one terminal objective.");
    if (!brief.objectives.enabling.length) warnings.push("Add enabling objectives so the lesson plan has structure.");
    if (!brief.audience.floor.background.trim()) warnings.push("Describe the floor learner's background.");
    return warnings;
  }

  async function copyBrief() {
    var text = JSON.stringify(brief, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied brief.json to clipboard.");
    } catch (error) {
      toast("Clipboard was blocked. Select the JSON drawer and copy manually.", true);
    }
  }

  function downloadBrief() {
    var blob = new Blob([JSON.stringify(brief, null, 2) + "\n"], {
      type: "application/json"
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "brief.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function postBrief() {
    var result = window.BriefValidator.validateBrief(brief, template);
    var postResult = document.getElementById("postResult");
    if (!postResult) {
      currentStep = steps.length - 1;
      render();
      postResult = document.getElementById("postResult");
    }
    if (!result.ok) {
      postResult.innerHTML = '<div class="notice warn">Fix contract errors before posting.</div>';
      return;
    }

    postResult.innerHTML = '<div class="notice">Posting to /api/brief...</div>';
    try {
      var response = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brief)
      });
      var payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error((payload.errors || ["Post failed."]).join(" "));
      }
      postResult.innerHTML =
        '<div class="notice">POST accepted. brief.json is ready for the Milestone 2 generator hook.</div>';
    } catch (error) {
      postResult.innerHTML =
        '<div class="notice warn">The JSON is valid, but /api/brief is not reachable in this preview. On Vercel, this button posts the same brief.json to the serverless validator.</div>';
    }
  }

  function toast(message, isWarning) {
    els.validationBox.innerHTML =
      '<div class="notice' + (isWarning ? " warn" : "") + '">' + escapeHtml(message) + "</div>";
    window.setTimeout(updateBriefView, 1800);
  }

  function setPath(path, value) {
    var parts = path.split(".");
    var target = brief;
    for (var index = 0; index < parts.length - 1; index += 1) {
      target = target[parts[index]];
    }
    target[parts[parts.length - 1]] = value;
  }

  function parseNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : 0;
  }

  function toArray(value) {
    return value
      .split(/\r?\n/)
      .map(function trimLine(line) {
        return line.trim();
      })
      .filter(Boolean);
  }

  function toLines(value) {
    return value.join("\n");
  }

  function fieldId(path) {
    return "field-" + path.replace(/\./g, "-");
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function inferType(name, mime) {
    var lower = name.toLowerCase();
    if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
    if (lower.startsWith("http://") || lower.startsWith("https://")) return "url";
    if (lower.endsWith(".csv") || lower.endsWith(".xlsx")) return "data";
    if (lower.endsWith(".txt") || lower.endsWith(".md")) return "notes";
    return "document";
  }

  function formatInputValue(value, type) {
    if (type === "datetime-local" && value) {
      var date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 16);
      }
    }
    return value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
})();
