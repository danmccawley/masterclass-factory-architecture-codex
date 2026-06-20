(function enhanceClassCreator() {
  "use strict";

  var form = document.getElementById("wizardForm");
  var stepTitle = document.getElementById("stepTitle");
  var stepList = document.getElementById("stepList");
  var nextButton = document.getElementById("nextButton");
  var briefView = document.getElementById("briefView");
  var validationBox = document.getElementById("validationBox");
  var genieStep = document.getElementById("genieStep");
  var genieResponse = document.getElementById("genieResponse");
  var genieInput = document.getElementById("genieInput");
  var genieAsk = document.getElementById("genieAskButton");
  var mobileMenuButton = document.getElementById("mobileMenuButton");
  var recommendation = null;
  var generation = null;
  var generatorTrackerTimer = null;
  var generatorTrackerIndex = 0;
  var generatorStages = [
    { label: "Order received", detail: "Validating the class setup and generator contract." },
    { label: "Knowledge base", detail: "Building the source list and source-quality report." },
    { label: "Research kitchen", detail: "Analyzing sources and shaping source-grounded objectives." },
    { label: "Blueprint check", detail: "Confirming the approved course architecture and slide allocation." },
    { label: "Lesson recipe", detail: "Sequencing the lesson map, checks, and deep dives." },
    { label: "Slide oven", detail: "Writing every teaching slide required by the slide budget." },
    { label: "Source check", detail: "Checking citations against the approved knowledge base." },
    { label: "QA counter", detail: "Testing schema, quality, participation design, and class shell behavior." },
    { label: "Out for launch", detail: "Preparing the preview, QR code, presenter script, and GitHub/Vercel handoff." }
  ];

  if (!form || !stepTitle || !briefView) return;

  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("input", onBudgetInput, true);
  document.addEventListener("change", onBudgetInput, true);
  if (genieAsk) genieAsk.addEventListener("click", function () { askGenie("chat"); });

  var observer = new MutationObserver(enhanceCurrentStep);
  observer.observe(form, { childList: true, subtree: true });
  observer.observe(stepTitle, { childList: true, characterData: true, subtree: true });
  if (stepList) observer.observe(stepList, { childList: true, subtree: true });
  enhanceCurrentStep();

  function onDocumentClick(event) {
    var quick = closest(event.target, "[data-genie-quick]");
    var lengthButton = closest(event.target, "[data-length-ai]");
    var reviewPost = closest(event.target, "[data-post-review]");
    var openPreview = closest(event.target, "[data-open-preview]");
    var downloadPreview = closest(event.target, "[data-download-preview]");
    var downloadBundle = closest(event.target, "[data-download-bundle]");
    var downloadScript = closest(event.target, "[data-download-script]");
    var downloadHandout = closest(event.target, "[data-download-handout]");
    var downloadGuide = closest(event.target, "[data-download-guide]");
    var downloadAnswerKey = closest(event.target, "[data-download-answer-key]");
    var copyClassUrl = closest(event.target, "[data-copy-class-url]");
    var closeTracker = closest(event.target, "[data-close-tracker]");
    var mobileMenu = closest(event.target, "#mobileMenuButton");
    var stepButton = closest(event.target, ".step-button");
    var librarianCheck = closest(event.target, "[data-librarian-check]");

    if (mobileMenu) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleMobileMenu();
      return;
    }

    if (librarianCheck) {
      event.preventDefault();
      event.stopImmediatePropagation();
      checkLibrarian();
      return;
    }

    if (closeTracker) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeGeneratorTracker();
      return;
    }

    if (quick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMobileMenu();
      askGenie(quick.dataset.genieQuick);
      return;
    }

    if (stepButton) {
      closeMobileMenu();
      return;
    }

    if (lengthButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      recommendLength(lengthButton.dataset.lengthAi === "apply");
      return;
    }

    if (reviewPost) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runGenerator();
      return;
    }

    if (openPreview) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openGeneratedPreview();
      return;
    }

    if (downloadPreview) {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadGeneratedPreview();
      return;
    }

    if (downloadBundle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadGeneratedBundle();
      return;
    }

    if (downloadScript) {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadPresenterScript();
      return;
    }

    if (downloadHandout) {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadBundleFile("student-handout.md", classSlug() + "-student-handout.md", "text/markdown");
      return;
    }

    if (downloadGuide) {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadBundleFile("facilitator-guide.md", classSlug() + "-facilitator-guide.md", "text/markdown");
      return;
    }

    if (downloadAnswerKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      downloadBundleFile("quiz-answer-key.md", classSlug() + "-quiz-answer-key.md", "text/markdown");
      return;
    }

    if (copyClassUrl) {
      event.preventDefault();
      event.stopImmediatePropagation();
      copyGeneratedClassUrl();
      return;
    }

    if (event.target === nextButton && currentStep().indexOf("review") !== -1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMobileMenu();
      runGenerator();
    }
  }

  function toggleMobileMenu() {
    var open = !document.body.classList.contains("mobile-menu-open");
    document.body.classList.toggle("mobile-menu-open", open);
    if (mobileMenuButton) {
      mobileMenuButton.setAttribute("aria-expanded", String(open));
      mobileMenuButton.textContent = open ? "× Close" : "☰ Menu";
    }
  }

  function closeMobileMenu() {
    document.body.classList.remove("mobile-menu-open");
    if (mobileMenuButton) {
      mobileMenuButton.setAttribute("aria-expanded", "false");
      mobileMenuButton.textContent = "☰ Menu";
    }
  }

  function closest(target, selector) {
    if (target && target.closest) return target.closest(selector);
    if (target && target.parentElement) return target.parentElement.closest(selector);
    return null;
  }

  function onBudgetInput(event) {
    var path = event.target.dataset.enhanceBudget;
    if (!path) return;
    var value = clampNumber(event.target.value, attrNumber(event.target, "min", 0), attrNumber(event.target, "max", 999));
    updateSourceNumber(path, value);
    syncBudgetControls(path, value);
  }

  function enhanceCurrentStep() {
    updateGenieContext();
    renameObjectiveStep();
    enhanceKnowledgeStep();
    enhanceLengthStep();
    enhanceReviewStep();
  }

  function currentStep() {
    return String(stepTitle.textContent || "").trim().toLowerCase();
  }

  function parseBrief() {
    try {
      return JSON.parse(briefView.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  function updateGenieContext() {
    if (!genieStep) return;
    var title = stepTitle.textContent || "this step";
    var hints = {
      "knowledge base": "Build the knowledge base first. Objective candidates should come from source and research analysis.",
      "learning target": "Treat these as provisional ideas. Final TLOs and ELOs belong after knowledge-base analysis.",
      "learning objectives": "Review and approve the TLO/ELO candidates after the knowledge base is analyzed.",
      "length": "Use the sliders, exact boxes, or ask Bernard to balance time, slide count, and learner load.",
      "review & generate": "Start the generator only after the setup check is valid."
    };
    var key = Object.keys(hints).find(function (item) { return currentStep().indexOf(item) !== -1; });
    genieStep.textContent = "Current step: " + title + ". " + (hints[key] || "Ask for a check, a recommendation, or next-step guidance.");
  }

  function renameObjectiveStep() {
    if (currentStep().indexOf("learning target") === -1) return;
    stepTitle.textContent = "Learning Objectives";
    var copy = form.querySelector(".step-copy");
    if (copy) {
      copy.textContent = "Review the terminal and enabling learning objectives after the knowledge base is researched and analyzed. Drafts here are candidates until the source-grounded pipeline confirms them.";
    }
    var labels = stepList ? stepList.querySelectorAll(".step-label") : [];
    Array.from(labels).forEach(function (label) {
      if (label.textContent === "Learning Target") label.textContent = "Learning Objectives";
    });
  }

  function enhanceKnowledgeStep() {
    if (currentStep().indexOf("knowledge base") === -1 || form.querySelector("[data-enhanced-analysis]")) return;
    var card = document.createElement("div");
    card.className = "summary-card full assist-panel";
    card.setAttribute("data-enhanced-analysis", "true");
    card.innerHTML =
      "<h3>Knowledge-base analysis</h3>" +
      "<p class=\"hint\">Terminal and enabling objectives should be identified after sources are collected, researched, and analyzed. Bernard can prepare conservative objective candidates for the next step; the later AI pipeline must still verify them against the corpus.</p>" +
      "<div class=\"analysis-flow\"><span>Sources</span><span>Research rules</span><span>KB analysis</span><span>TLO/ELO candidates</span></div>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-genie-quick=\"knowledge-check\">Check knowledge base</button>" +
      "<button type=\"button\" class=\"primary\" data-ai=\"fill\">Prepare objective candidates</button></div>";
    var grid = form.querySelector(".form-grid") || form;
    grid.appendChild(card);

    var librarian = document.createElement("div");
    librarian.className = "summary-card full librarian-panel";
    librarian.setAttribute("data-librarian-panel", "true");
    librarian.innerHTML =
      "<h3>Knowledge Librarian</h3>" +
      "<p class=\"hint\">Reserved masterclasses need upkeep after they are generated. The Librarian checks saved class source lists, watches for freshness signals, and flags classes that should be refreshed instead of silently going stale.</p>" +
      "<div class=\"analysis-flow\"><span>Reserve</span><span>Source check</span><span>Freshness report</span><span>Regenerate queue</span></div>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-librarian-check>Check reserve library</button></div>" +
      "<div class=\"notice\" data-librarian-result>Weekly checks can run on Vercel. Reports are saved when KV storage is configured.</div>";
    grid.appendChild(librarian);
  }

  function enhanceLengthStep() {
    if (currentStep().indexOf("length") === -1 || form.querySelector("[data-enhanced-length]") || form.querySelector("[data-budget-path]")) return;
    var minutes = form.querySelector("[data-number-path=\"length.minutes\"]");
    var slides = form.querySelector("[data-number-path=\"length.slide_budget\"]");
    if (!minutes || !slides) return;

    hideField(minutes);
    hideField(slides);

    var brief = parseBrief();
    var planner = document.createElement("div");
    planner.className = "length-planner full";
    planner.setAttribute("data-enhanced-length", "true");
    planner.innerHTML =
      budgetControl("Class length", "length.minutes", Number(brief.length && brief.length.minutes) || 60, 10, 480, "minutes") +
      budgetControl("Slide budget", "length.slide_budget", Math.max(30, Number(brief.length && brief.length.slide_budget) || 90), 30, 400, "slides");

    var help = document.createElement("div");
    help.className = "summary-card full assist-panel";
    help.setAttribute("data-enhanced-length-help", "true");
    help.innerHTML =
      "<h3>Bernard budget help</h3>" +
      "<p class=\"hint\">Choose a preset in increments of 10, drag the slider, type an exact number, ask for a recommendation, or leave the decision to Bernard.</p>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-length-ai=\"recommend\">Ask Bernard for recommendation</button>" +
      "<button type=\"button\" class=\"primary\" data-length-ai=\"apply\">Leave it to Bernard</button></div>" +
      "<div class=\"notice\" data-length-result>No recommendation yet.</div>";

    var grid = form.querySelector(".form-grid") || form;
    grid.insertBefore(help, grid.firstChild);
    grid.insertBefore(planner, help);
  }

  function budgetControl(label, path, value, min, max, unit) {
    return "<div class=\"budget-control\"><div class=\"budget-control-head\"><h3>" + esc(label) + "</h3><p class=\"hint\">Choose a preset in steps of 10, type an exact value, or use the slider.</p></div>" +
      "<div class=\"budget-row\"><label class=\"budget-field\"><span class=\"mini-label\">Preset drop-down</span><select min=\"" + min + "\" max=\"" + max + "\" data-budget-unit=\"" + unit + "\" data-enhance-budget=\"" + path + "\">" +
      budgetOptions(value, min, max, unit) + "</select></label>" +
      "<label class=\"budget-field\"><span class=\"mini-label\">Exact number</span><input type=\"number\" min=\"" + min + "\" max=\"" + max + "\" value=\"" + value + "\" data-enhance-budget=\"" + path + "\"></label></div>" +
      "<label class=\"range-row\"><span class=\"mini-label\">Slider</span><input type=\"range\" min=\"" + min + "\" max=\"" + max + "\" step=\"10\" value=\"" + nearestTen(value, min) + "\" data-enhance-budget=\"" + path + "\"></label>" +
      "<div class=\"budget-scale\"><span>" + min + " " + unit + "</span><span>" + max + " " + unit + "</span></div></div>";
  }

  function budgetOptions(current, min, max, unit) {
    var html = current % 10 ? "<option value=\"" + current + "\">" + current + " " + unit + " (custom)</option>" : "";
    for (var value = min; value <= max; value += 10) {
      html += "<option value=\"" + value + "\"" + (nearestTen(current, min) === value ? " selected" : "") + ">" + value + " " + unit + "</option>";
    }
    return html;
  }

  function hideField(input) {
    var field = input.closest(".field");
    if (field) field.style.display = "none";
  }

  function syncBudgetControls(path, rawValue) {
    var value = Number(rawValue) || 0;
    Array.from(form.querySelectorAll("[data-enhance-budget=\"" + path + "\"]")).forEach(function (control) {
      if (control.tagName === "SELECT") ensureCustomOption(control, value);
      control.value = control.type === "range" ? String(nearestTen(value, attrNumber(control, "min", 0))) : String(value);
    });
  }

  function ensureCustomOption(select, value) {
    var exact = String(value);
    var existing = Array.from(select.options).some(function (option) { return option.value === exact; });
    var custom = select.querySelector("[data-custom-option]");
    if (existing) {
      if (custom && custom.value !== exact) custom.remove();
      return;
    }
    if (!custom) {
      custom = document.createElement("option");
      custom.setAttribute("data-custom-option", "true");
      select.insertBefore(custom, select.firstChild);
    }
    var unit = select.getAttribute("data-budget-unit") || "";
    custom.value = exact;
    custom.textContent = exact + (unit ? " " + unit : "") + " (custom)";
  }

  function updateNumber(path, value) {
    updateSourceNumber(path, value);
    syncBudgetControls(path, value);
  }

  function updateSourceNumber(path, value) {
    Array.from(form.querySelectorAll(
      "[data-number-path=\"" + path + "\"]," +
      "[data-budget-path=\"" + path + "\"]"
    )).forEach(function (input) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function clampNumber(rawValue, min, max) {
    var value = Number(rawValue);
    if (!Number.isFinite(value)) value = min;
    value = Math.trunc(value);
    return Math.max(min, Math.min(max, value));
  }

  function attrNumber(element, name, fallback) {
    var value = Number(element.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
  }

  async function askGenie(type) {
    var question = genieInput ? genieInput.value.trim() : "";
    setGenie("Bernard is thinking...");
    try {
      var payload = await callGenie(type, question);
      setGenie(payload.answer || fallbackAnswer(type));
      if (payload.recommendation && (type === "recommend-length" || type === "length")) {
        recommendation = payload.recommendation;
        showRecommendation(recommendation);
      }
    } catch (error) {
      setGenie(fallbackAnswer(type));
    }
  }

  async function recommendLength(apply) {
    setGenie(apply ? "Choosing the class length and slide budget..." : "Asking for a length recommendation...");
    try {
      var payload = await callGenie("recommend-length", "Recommend the class length, slide budget, and interactions.");
      recommendation = payload.recommendation || fallbackRecommendation();
    } catch (error) {
      recommendation = fallbackRecommendation();
    }
    showRecommendation(recommendation);
    setGenie(lengthText(recommendation));
    if (apply) applyRecommendation(recommendation);
  }

  function callGenie(type, question) {
    return fetch("/api/genie", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        step: currentStep(),
        step_label: stepTitle.textContent,
        brief: parseBrief(),
        payload: { type: type, question: question }
      })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body.ok) throw new Error((body.errors || ["Bernard is not connected yet."]).join(" "));
        return body;
      });
    });
  }

  function fallbackAnswer(type) {
    if (type === "knowledge-check") return "Build the knowledge base first: choose the class tier, add enough sources to meet that tier's source floor, set research rules, then use analysis to draft objective candidates. Final objectives should not be treated as finished until the corpus is verified.";
    if (type === "check-step") return "This step is safe to continue when the required fields are clear, the source assumptions are explicit, and the setup check says it is ready.";
    if (type === "recommend-length") return lengthText(fallbackRecommendation());
    return "Bernard can guide this step even before the API key is connected. For final AI assistance, make sure OPENAI_API_KEY is set in Vercel and redeployed.";
  }

  function fallbackRecommendation() {
    var brief = parseBrief();
    var minutes = Number(brief.length && brief.length.minutes) || 60;
    var currentSlides = Number(brief.length && brief.length.slide_budget) || 90;
    var slides = Math.max(currentSlides, 30, Math.min(400, nearestTen(Math.round(minutes * 1.5), 10)));
    return { minutes: nearestTen(minutes, 10), slide_budget: slides, polls: 2, word_clouds: 4, quizzes: 1, final_test: true, reason: "Never shortened for experienced learners; technical familiarity is used to add deeper examples, edge cases, and practice." };
  }

  function showRecommendation(value) {
    var box = form.querySelector("[data-length-result]");
    if (box) box.textContent = lengthText(value);
  }

  function applyRecommendation(value) {
    updateNumber("length.minutes", value.minutes);
    updateNumber("length.slide_budget", value.slide_budget);
    updateNumber("length.interaction_budget.polls", value.polls);
    updateNumber("length.interaction_budget.word_clouds", value.word_clouds);
    updateNumber("length.interaction_budget.quizzes", value.quizzes);
    syncBudgetControls("length.minutes", value.minutes);
    syncBudgetControls("length.slide_budget", value.slide_budget);
  }

  function lengthText(value) {
    return "Bernard recommends " + value.minutes + " minutes, " + value.slide_budget + " slides, " + value.polls + " polls, " + value.word_clouds + " word clouds, and " + value.quizzes + " quiz. " + value.reason;
  }

  async function checkLibrarian() {
    var box = form.querySelector("[data-librarian-result]");
    if (box) box.textContent = "The Librarian is checking saved classes and source freshness...";
    try {
      var response = await fetch("/api/librarian");
      var payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error((payload.errors || [payload.error || "Librarian check failed."]).join(" "));
      var count = payload.summary && payload.summary.classes_checked ? payload.summary.classes_checked : 0;
      var review = payload.summary && payload.summary.classes_needing_review ? payload.summary.classes_needing_review : 0;
      var saved = payload.saved ? " Report saved." : " Add KV storage to save periodic history.";
      var message = "Librarian checked " + count + " saved class" + (count === 1 ? "" : "es") + ". " + review + " need review." + saved;
      if (box) box.textContent = message;
      setGenie(message);
    } catch (error) {
      var fallback = "The Librarian endpoint runs on Vercel. Local static preview cannot run /api/librarian.";
      if (box) box.textContent = fallback;
      setGenie(fallback);
    }
  }

  function enhanceReviewStep() {
    if (currentStep().indexOf("review") === -1 || form.querySelector("[data-enhanced-generator]")) return;
    var card = document.createElement("div");
    card.className = "summary-card full";
    card.setAttribute("data-enhanced-generator", "true");
    card.innerHTML = generatorHtml();
    var actions = form.querySelector(".review-actions");
    if (actions && actions.parentNode) actions.parentNode.insertBefore(card, actions);
    else form.appendChild(card);
  }

  function generatorHtml() {
    if (!generation) return "<h3>Generated masterclass</h3><p class=\"hint\">No masterclass has been generated in this session yet. Start generator will build the content layer, run source verification and QA, assemble the deck template, and prepare a preview plus deployable bundle.</p>";
    var files = generation.files || {};
    var publish = generation.publish || {};
    var quality = generation.quality || {};
    var standard = generation.knowledge_standard || quality.knowledge_standard || {};
    var classUrl = publish.status === "published" ? (generation.class_url || publish.expected_url || "") : "";
    var slideCount = Number(generation.slide_count || 0);
    var requestedSlides = Number(generation.requested_slide_budget || 0);
    var slideText = slideCount ? slideCount + (requestedSlides ? " / " + requestedSlides + " requested" : "") : "unknown";
    var deepDiveText = Number(generation.deep_dive_count || 0) + " / " + Number(generation.required_deep_dive_count || 0) + " required";
    var densityText = Number(generation.average_visible_slide_words || 0) + " words/slide; " + Number(generation.average_deep_dive_words || 0) + " words/deep dive";
    var qualityText = quality.score ? quality.score + " / 100 (" + (quality.status || "checked") + ")" : "Not run";
    var standardText = standard.tier ? (standard.tier.label + " · " + (standard.ok ? "KB PASS" : "KB needs work")) : "Not checked";
    var exportsText = (generation.exports || (generation.bundle && generation.bundle.manifest && generation.bundle.manifest.exports) || []).join(", ");
    var stages = (generation.stage_reports || []).map(function (stage) {
      return "<li><strong>" + esc(stage.stage || "stage") + ":</strong> " + (stage.ok ? "passed" : esc(stage.message || "used fallback")) + "</li>";
    }).join("");
    var warnings = (generation.warnings || []).map(function (warning) {
      return "<li>" + esc(warning) + "</li>";
    }).join("");
    var publishNotice = "";
    if (publish.status === "published") {
      publishNotice = "<div class=\"notice\"><strong>Published:</strong> GitHub received the generated class. Vercel should launch it at the link below after the GitHub deployment finishes.</div>";
    } else if (publish.status === "not_configured") {
      publishNotice = "<div class=\"notice warn\"><strong>Generated, not auto-published yet:</strong> Add GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in Vercel to let the Factory send classes to GitHub automatically.</div>";
    } else if (publish.status === "failed") {
      publishNotice = "<div class=\"notice warn\"><strong>Generated, publish failed:</strong> " + esc(publish.message || "GitHub publish failed.") + "</div>";
    }
    return "<h3>Generated masterclass</h3>" +
      "<div class=\"generator-status\"><div class=\"notice\"><strong>QA:</strong> " + esc(generation.qa || "Not run") + " · <strong>Knowledge standard:</strong> " + esc(standardText) + " · <strong>Source check:</strong> " + (generation.source_verify && generation.source_verify.ok ? "PASS" : "Not run") + " · <strong>Quality:</strong> " + esc(qualityText) + " · <strong>Slides:</strong> " + esc(slideText) + " · <strong>Deep dives:</strong> " + esc(deepDiveText) + " · <strong>Depth:</strong> " + esc(densityText) + " · <strong>Mode:</strong> " + esc(generation.mode || "unknown") + "</div>" +
      publishNotice +
      (classUrl ? "<div class=\"class-url-card\"><span class=\"mini-label\">Generated class URL</span><a href=\"" + attr(classUrl) + "\" target=\"_blank\" rel=\"noreferrer\">" + esc(classUrl) + "</a><img class=\"qr-image\" alt=\"QR code for generated class\" src=\"/api/qr?url=" + encodeURIComponent(classUrl) + "\"><button type=\"button\" class=\"ghost\" data-copy-class-url>Copy class link</button></div>" : "") +
      (exportsText ? "<div class=\"notice\"><strong>Exports:</strong> " + esc(exportsText) + "</div>" : "") +
      "<div class=\"generated-actions\"><button type=\"button\" class=\"primary\" data-open-preview>Open preview</button><button type=\"button\" class=\"ghost\" data-download-handout>Download student handout</button><button type=\"button\" class=\"ghost\" data-download-guide>Download facilitator guide</button><button type=\"button\" class=\"ghost\" data-download-answer-key>Download answer key</button><button type=\"button\" class=\"ghost\" data-download-preview>Download preview HTML</button><button type=\"button\" class=\"ghost\" data-download-bundle>Download deploy bundle</button><button type=\"button\" class=\"ghost\" data-download-script>Download presenter script</button></div>" +
      (stages ? "<details class=\"generated-meta\"><summary>Pipeline stages</summary><ul>" + stages + "</ul></details>" : "") +
      (quality.score ? "<details class=\"generated-meta\"><summary>Quality audit</summary>" + qualityHtml(quality) + "</details>" : "") +
      (warnings ? "<details class=\"generated-meta\"><summary>Warnings and source notes</summary><ul>" + warnings + "</ul></details>" : "") +
      "</div><div class=\"generated-files\">" +
      filePreview("content.js", files["content.js"]) + filePreview("glossary.js", files["glossary.js"]) + filePreview("source.js", files["source.js"]) + "</div>";
  }

  function qualityHtml(quality) {
    var scores = quality.scores || {};
    var scoreRows = Object.keys(scores).map(function (key) {
      return "<li><strong>" + esc(key.replace(/_/g, " ")) + ":</strong> " + esc(scores[key]) + " / 100</li>";
    }).join("");
    var recs = (quality.recommendations || []).map(function (item) {
      return "<li>" + esc(item) + "</li>";
    }).join("");
    return "<div class=\"notice\"><strong>Release quality:</strong> " + esc(quality.score || "0") + " / 100 · " + esc(quality.status || "checked") + "</div>" +
      (scoreRows ? "<ul>" + scoreRows + "</ul>" : "") +
      (recs ? "<p><strong>Recommendations</strong></p><ul>" + recs + "</ul>" : "");
  }

  function trackerHtml() {
    var steps = generatorStages.map(function (stage, index) {
      return "<div class=\"tracker-step\" data-tracker-step=\"" + index + "\"><span>" + String(index + 1).padStart(2, "0") + "</span><strong>" + esc(stage.label) + "</strong><small>Waiting</small></div>";
    }).join("");
    return "<section class=\"tracker-card\" aria-live=\"polite\">" +
      "<p class=\"kicker\">Masterclass Factory</p>" +
      "<h2>Generator tracker</h2>" +
      "<div class=\"tracker-now\"><span>Current stage</span><strong data-tracker-now-stage>Starting</strong></div>" +
      "<p class=\"tracker-detail\" data-tracker-detail>Starting the generator.</p>" +
      "<div class=\"tracker-road\">" + steps + "</div>" +
      "<div class=\"tracker-progress\"><span data-tracker-progress></span></div>" +
      "<p class=\"tracker-small\" data-tracker-small>This stays on screen until the masterclass package is ready. Bernard is coordinating source analysis, lesson writing, source verification, QA, quality scoring, and launch packaging.</p>" +
      "<div class=\"tracker-actions\"><button type=\"button\" class=\"ghost\" data-close-tracker>Hide tracker</button></div>" +
      "</section>";
  }

  function startGeneratorTracker() {
    closeGeneratorTracker();
    generatorTrackerIndex = 0;
    var tracker = document.createElement("div");
    tracker.className = "generator-tracker-screen";
    tracker.setAttribute("data-generator-tracker", "true");
    tracker.innerHTML = trackerHtml();
    document.body.appendChild(tracker);
    setGeneratorTrackerStage(0);
    generatorTrackerTimer = window.setInterval(function () {
      if (generatorTrackerIndex < generatorStages.length - 2) {
        setGeneratorTrackerStage(generatorTrackerIndex + 1);
      }
    }, 1700);
    return tracker;
  }

  function setGeneratorTrackerStage(index, detail) {
    generatorTrackerIndex = Math.max(0, Math.min(generatorStages.length - 1, index));
    var tracker = document.querySelector("[data-generator-tracker]");
    if (!tracker) return;
    var active = generatorStages[generatorTrackerIndex];
    Array.from(tracker.querySelectorAll("[data-tracker-step]")).forEach(function (step) {
      var stepIndex = Number(step.getAttribute("data-tracker-step"));
      step.classList.toggle("done", stepIndex < generatorTrackerIndex);
      step.classList.toggle("active", stepIndex === generatorTrackerIndex);
      var status = step.querySelector("small");
      if (status) status.textContent = stepIndex < generatorTrackerIndex ? "Done" : stepIndex === generatorTrackerIndex ? "In progress" : "Waiting";
    });
    var nowStage = tracker.querySelector("[data-tracker-now-stage]");
    if (nowStage) nowStage.textContent = active.label;
    var detailBox = tracker.querySelector("[data-tracker-detail]");
    if (detailBox) detailBox.textContent = detail || active.detail;
    var progress = tracker.querySelector("[data-tracker-progress]");
    if (progress) progress.style.width = Math.round(((generatorTrackerIndex + 1) / generatorStages.length) * 100) + "%";
  }

  function completeGeneratorTracker(payload) {
    if (generatorTrackerTimer) window.clearInterval(generatorTrackerTimer);
    generatorTrackerTimer = null;
    setGeneratorTrackerStage(generatorStages.length - 1, "Masterclass generated. QA passed. Launch package is ready.");
    var tracker = document.querySelector("[data-generator-tracker]");
    if (!tracker) return;
    tracker.classList.add("complete");
    var small = tracker.querySelector("[data-tracker-small]");
    var slideCount = payload && payload.slide_count ? payload.slide_count : "the requested";
    if (small) small.textContent = "Built " + slideCount + " slides, assembled the deck shell, and prepared the preview, QR code, presenter script, and deploy bundle.";
    var action = tracker.querySelector("[data-close-tracker]");
    if (action) action.textContent = "See generated class package";
  }

  function failGeneratorTracker(error) {
    if (generatorTrackerTimer) window.clearInterval(generatorTrackerTimer);
    generatorTrackerTimer = null;
    var tracker = document.querySelector("[data-generator-tracker]");
    if (!tracker) return;
    tracker.classList.add("failed");
    var detail = tracker.querySelector("[data-tracker-detail]");
    if (detail) detail.textContent = "The generator needs attention: " + (error && error.message ? error.message : "unknown error");
    var small = tracker.querySelector("[data-tracker-small]");
    if (small) small.textContent = "Nothing was published from this failed run. Fix the message shown on the page, then start the generator again.";
    var action = tracker.querySelector("[data-close-tracker]");
    if (action) action.textContent = "Return to setup";
  }

  function closeGeneratorTracker() {
    if (generatorTrackerTimer) window.clearInterval(generatorTrackerTimer);
    generatorTrackerTimer = null;
    var tracker = document.querySelector("[data-generator-tracker]");
    if (tracker && tracker.parentNode) tracker.parentNode.removeChild(tracker);
  }

  async function runGenerator() {
    var approval = form.querySelector("[data-blueprint-approved]");
    if (approval && !approval.checked) {
      var message = "Approve the course blueprint first. That keeps the generator from writing slides before the class architecture is accepted.";
      if (validationBox) validationBox.innerHTML = "<div class=\"notice warn\">" + esc(message) + "</div>";
      setGenie(message);
      try { approval.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (error) {}
      return;
    }
    if (validationBox) validationBox.innerHTML = "<div class=\"notice\">Starting the generator...</div>";
    startGeneratorTracker();
    try {
      setGeneratorTrackerStage(0, "Checking that the setup data matches the contract.");
      await fetch("/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parseBrief()) });
      setGeneratorTrackerStage(1, "Building the knowledge base and source-quality list.");
      var response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: parseBrief(), publish: true }) });
      setGeneratorTrackerStage(6, "Running source verification and QA.");
      var payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error((payload.errors || ["Generator failed."]).join(" "));
      generation = payload;
      completeGeneratorTracker(payload);
      if (payload.publish && payload.publish.status === "published") {
        setGenie("Masterclass generated and sent to GitHub. Vercel should launch it at the generated class URL after the GitHub deployment finishes.");
      } else {
        setGenie("Masterclass generated with " + (payload.qa || "QA status unknown") + ". Open the preview now. Auto-publish will turn on once the GitHub token env vars are added in Vercel.");
      }
      enhanceReviewStep();
      var card = form.querySelector("[data-enhanced-generator]");
      if (card) card.innerHTML = generatorHtml();
      if (validationBox) validationBox.innerHTML = "<div class=\"notice\">Generator complete. Preview, deploy bundle, and presenter script are shown in Review & Generate.</div>";
    } catch (error) {
      failGeneratorTracker(error);
      if (validationBox) validationBox.innerHTML = "<div class=\"notice warn\">Generator could not finish here: " + esc(error.message || "Unknown error") + "</div>";
    }
  }

  function filePreview(name, content) {
    return "<details class=\"generated-file\"><summary>" + esc(name) + "</summary><pre>" + esc(String(content || "Not generated yet.").slice(0, 2400)) + "</pre></details>";
  }

  function openGeneratedPreview() {
    if (!generation || !generation.preview_html) return setGenie("Generate a masterclass first, then the preview opens here.");
    var url = URL.createObjectURL(new Blob([generation.preview_html], { type: "text/html" }));
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function downloadGeneratedPreview() {
    if (!generation || !generation.preview_html) return setGenie("Generate a masterclass first, then the preview can be downloaded.");
    downloadText(classSlug() + "-masterclass-preview.html", generation.preview_html, "text/html");
  }

  function downloadGeneratedBundle() {
    if (!generation || !generation.bundle) return setGenie("Generate a masterclass first, then the deploy bundle can be downloaded.");
    downloadText(classSlug() + "-deploy-bundle.json", JSON.stringify(generation.bundle, null, 2) + "\n", "application/json");
  }

  function downloadPresenterScript() {
    if (!generation || !generation.presenter_script) return setGenie("Generate a masterclass first, then the presenter script can be downloaded.");
    downloadText(classSlug() + "-presenter-script.md", generation.presenter_script + "\n", "text/markdown");
  }

  function downloadBundleFile(name, filename, type) {
    var files = generation && generation.bundle && generation.bundle.files;
    if (!files || !files[name]) return setGenie("Generate a masterclass first, then " + name + " can be downloaded.");
    downloadText(filename || name, files[name], type || "text/plain");
  }

  async function copyGeneratedClassUrl() {
    var url = generation && (generation.class_url || (generation.publish && generation.publish.expected_url));
    if (!url) return setGenie("There is no generated class URL yet.");
    try {
      await navigator.clipboard.writeText(url);
      setGenie("Copied the generated class link.");
    } catch (error) {
      setGenie("Clipboard was blocked. Copy the visible generated class link manually.");
    }
  }

  function downloadText(filename, content, type) {
    var url = URL.createObjectURL(new Blob([content], { type: type || "text/plain" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function classSlug() {
    var brief = parseBrief();
    return String((brief.meta && (brief.meta.slug || brief.meta.title)) || "masterclass")
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "masterclass";
  }

  function setGenie(text) {
    if (genieResponse) genieResponse.textContent = text;
  }

  function nearestTen(value, min) {
    return min + Math.round((Number(value) - min) / 10) * 10;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function attr(value) {
    return esc(value).replace(/`/g, "&#96;");
  }
})();
