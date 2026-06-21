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
  // The knowledge base, once resolved-and-sealed at step 2, lives here and is
  // merged into every generate call so the server skips KB resolution entirely.
  var sealedKnowledgeBase = null;
  var generatorTrackerTimer = null;
  var generatorTrackerIndex = 0;
  var generatorFailedIndex = -1;
  var generatorProgress = [];
  var generatorStages = [
    {
      label: "Order received",
      detail: "Validating the class setup and generator contract.",
      work: ["Check the class setup data", "Confirm the generator contract", "Prepare the run"]
    },
    {
      label: "Knowledge base",
      detail: "Building the source list and source-quality report.",
      work: ["Collect uploaded and requested sources", "Measure the selected knowledge-base standard", "Block the run if the source floor is not met"]
    },
    {
      label: "Research kitchen",
      detail: "Bernard is searching, checking source URLs, and rejecting anything unverifiable. This can take a little time on AI-owned research.",
      work: ["Search for additional credible sources", "Check candidate source URLs", "Reject unverifiable or weak sources"]
    },
    {
      label: "Blueprint check",
      detail: "Confirming the approved course architecture and slide allocation.",
      work: ["Confirm the class tier and slide budget", "Match lesson structure to the learner profile", "Keep the course from being shortened because learners are advanced"]
    },
    {
      label: "Lesson recipe",
      detail: "Sequencing the lesson map, checks, and deep dives.",
      work: ["Build the lesson sequence", "Place knowledge checks and participation prompts", "Plan deep dives where the topic needs more depth"]
    },
    {
      label: "Slide oven",
      detail: "Writing every teaching slide required by the slide budget.",
      work: ["Write the required slide count", "Fill presenter notes and student-facing content", "Repair thin slides before QA"]
    },
    {
      label: "Source check",
      detail: "Checking citations against the approved knowledge base.",
      work: ["Verify slide claims against source sections", "Check the works-cited slide", "Block unsupported claims"]
    },
    {
      label: "QA counter",
      detail: "Testing schema, quality, participation design, and class shell behavior.",
      work: ["Run schema checks", "Score class quality and participation design", "Block launch if quality gates fail"]
    },
    {
      label: "Out for launch",
      detail: "Preparing the preview, QR code, presenter script, and GitHub/Vercel handoff.",
      work: ["Assemble the preview package", "Prepare QR and class launch links", "Send the generated files toward GitHub and Vercel"]
    }
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

  // The brief sent to the generator. If the human sealed the knowledge base at
  // step 2, that sealed knowledge_base is authoritative and is merged in here so
  // the server short-circuits KB resolution (knowledge_base.sealed === true) and
  // never re-litigates it. If nothing is sealed, the brief passes through as-is.
  function briefForGenerate() {
    var brief = parseBrief();
    if (sealedKnowledgeBase) {
      brief.knowledge_base = JSON.parse(JSON.stringify(sealedKnowledgeBase));
      if (sealedKnowledgeBase._class_tier) {
        brief.class_tier = Object.assign({}, brief.class_tier, sealedKnowledgeBase._class_tier);
      }
    }
    return brief;
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
      "<p class=\"hint\">The knowledge base is resolved and <strong>sealed here</strong>. Review the sources Bernard can find, deal with any shortfall (add sources, accept a tier, or build anyway), then seal it. Once sealed, the knowledge base is locked and is never raised again downstream &mdash; the only exception is a human-approved advancement opportunity.</p>" +
      "<div class=\"analysis-flow\"><span>Sources</span><span>Research rules</span><span>KB review &amp; score</span><span>Seal</span></div>" +
      "<div class=\"assist-actions\">" +
      "<button type=\"button\" class=\"primary\" data-kb-review>Review &amp; seal knowledge base</button>" +
      "<button type=\"button\" class=\"ghost\" data-ai=\"fill\">Prepare objective candidates</button></div>" +
      "<div class=\"kb-step-result\" data-kb-step-result></div>";
    var grid = form.querySelector(".form-grid") || form;
    grid.appendChild(card);

    var reviewBtn = card.querySelector("[data-kb-review]");
    if (reviewBtn) reviewBtn.addEventListener("click", function () { runKnowledgeBaseReview(reviewBtn); });

    // If a seal already exists in this session, reflect it immediately.
    if (sealedKnowledgeBase && sealedKnowledgeBase.seal) {
      renderSealedState({
        seal: sealedKnowledgeBase.seal,
        score: sealedKnowledgeBase.seal.score,
        tier: sealedKnowledgeBase.seal.tier,
        floor_met: sealedKnowledgeBase.seal.floor_met
      });
    }

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

  // Run the interactive review against /api/knowledge-base (review mode) and
  // render the result inline on the step.
  async function runKnowledgeBaseReview(btn) {
    var target = form.querySelector("[data-kb-step-result]");
    if (!target) return;
    if (btn) { btn.disabled = true; btn.textContent = "Reviewing the knowledge base..."; }
    target.innerHTML = "<div class=\"notice\">Bernard is reviewing the knowledge base...</div>";
    try {
      var response = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "review", brief: parseBrief() })
      });
      var payload = await response.json();
      if (!response.ok || !payload.ok) { throw new Error((payload.errors || ["Could not review the knowledge base."]).join(" ")); }
      renderKbStepReview(payload, target);
    } catch (error) {
      target.innerHTML = "<div class=\"notice kb-error\">" + esc(error.message || "Review failed.") + "</div>";
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = "Review &amp; seal knowledge base"; }
    }
  }

  // Render the review on the STEP. Unlike the generate-time review (which runs
  // the generator), every actionable choice here SEALS the knowledge base.
  function renderKbStepReview(payload, target) {
    if (payload.status === "ready") {
      target.innerHTML =
        "<div class=\"notice kb-review\">" +
        "<h3>Knowledge base meets the floor</h3>" +
        scoreHtml(payload.score) +
        "<p>Source floor is met for the <strong>" + esc(payload.tier || "selected") + "</strong> tier. Seal it to lock it in and move on.</p>" +
        "<div class=\"assist-actions\"><button type=\"button\" class=\"primary\" data-kb-seal=\"as_is\">Seal knowledge base</button></div>" +
        "</div>";
      var sealBtn = target.querySelector("[data-kb-seal]");
      if (sealBtn) sealBtn.addEventListener("click", function () { sealKnowledgeBaseDecision("as_is", null, target); });
      return;
    }

    var co = payload.change_order || {};
    var rec = co.recommendation || {};
    var options = payload.options || co.options || [];
    var challenges = (co.challenges || []).map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("");
    var box = document.createElement("div");
    box.className = "notice change-order kb-review";
    box.innerHTML =
      "<h3>Knowledge base review &mdash; resolve and seal</h3>" +
      "<p class=\"kb-review-lead\">Here's the status. Deal with it now, then seal. <strong>Sealing locks the knowledge base for the rest of the build.</strong></p>" +
      scoreHtml(payload.score || co.score) +
      (co.situation ? "<p><strong>Status.</strong> " + esc(co.situation) + "</p>" : "") +
      (challenges ? "<details><summary>Analysis</summary><ul>" + challenges + "</ul></details>" : "") +
      (rec.summary ? "<p><strong>Bernard's recommendation.</strong> " + esc(rec.summary) + "</p>" : "") +
      "<p><strong>Resolve it:</strong></p>" +
      optionsHtml(options) +
      conversationalBoxHtml();
    target.innerHTML = "";
    target.appendChild(box);
    wireKbStepOptions(box, target);
    wireConversationalBox(box);
  }

  // On the STEP, option clicks SEAL the KB (they do not run the generator).
  function wireKbStepOptions(box, target) {
    box.querySelectorAll("[data-option-id]").forEach(function (btn) {
      var id = btn.getAttribute("data-option-id");
      var token = {};
      try { token = JSON.parse(btn.getAttribute("data-option-token") || "{}"); } catch (e) { token = {}; }
      btn.addEventListener("click", function () {
        if (token && token.proceed_anyway) { sealKnowledgeBaseDecision("proceed_anyway", null, target); }
        else if (token && token.accept_tier) { sealKnowledgeBaseDecision("accept_tier", { tier: token.accept_tier }, target); }
        else if (id === "search_again") { remediateKnowledgeBase(btn); }
        else if (id === "add_source") { goToKnowledgeBaseStep(); }
        else if (id === "decline_build") { setGenie("Knowledge base left open. Add sources or adjust, then review and seal when ready."); }
        else if (id === "ask_bernard") {
          var input = box.querySelector("[data-bernard-input]");
          if (input) { input.focus(); try { input.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }
        } else if (token && Object.keys(token).length) {
          // Any other build-style token → treat as a proceed-anyway seal.
          sealKnowledgeBaseDecision("proceed_anyway", null, target);
        }
      });
    });
  }

  // Seal the knowledge base via /api/knowledge-base (seal mode). On success the
  // sealed knowledge_base becomes authoritative for every later generate call.
  async function sealKnowledgeBaseDecision(decision, extra, target) {
    target = target || form.querySelector("[data-kb-step-result]");
    if (target) target.innerHTML = "<div class=\"notice\">Sealing the knowledge base...</div>";
    try {
      var body = Object.assign({ mode: "seal", decision: decision, brief: parseBrief() }, extra || {});
      var response = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      var payload = await response.json();
      if (!response.ok || !payload.ok || !payload.sealed) { throw new Error((payload.errors || ["Could not seal the knowledge base."]).join(" ")); }
      // Store the sealed knowledge_base (carrying its seal snapshot) and any
      // tier decision, so briefForGenerate() merges them into the build.
      sealedKnowledgeBase = (payload.brief && payload.brief.knowledge_base) ? payload.brief.knowledge_base : { sealed: true, seal: payload.seal };
      if (payload.brief && payload.brief.class_tier) sealedKnowledgeBase._class_tier = payload.brief.class_tier;
      renderSealedState(payload, target);
    } catch (error) {
      if (target) target.innerHTML = "<div class=\"notice kb-error\">" + esc(error.message || "Seal failed.") + "</div>";
    }
  }

  // Render the sealed state: a clear, locked summary with the option to re-open.
  function renderSealedState(payload, target) {
    target = target || form.querySelector("[data-kb-step-result]");
    if (!target) return;
    var seal = payload.seal || {};
    target.innerHTML =
      "<div class=\"notice kb-sealed\">" +
      "<h3>&#128274; Knowledge base sealed</h3>" +
      scoreHtml(payload.score && payload.score.components ? payload.score : null) +
      "<p>" + esc(payload.message || "The knowledge base is sealed and will not be raised again during this build.") + "</p>" +
      "<ul class=\"kb-sealed-meta\">" +
      "<li>Floor met: <strong>" + (payload.floor_met ? "yes" : "no &mdash; evidence-limited") + "</strong></li>" +
      (payload.tier ? "<li>Tier: <strong>" + esc(payload.tier) + "</strong></li>" : "") +
      (seal.score != null ? "<li>Score at seal: <strong>" + esc(seal.score && seal.score.score != null ? seal.score.score : seal.score) + "</strong></li>" : "") +
      "</ul>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-kb-unseal>Re-open knowledge base</button></div>" +
      "</div>";
    var unseal = target.querySelector("[data-kb-unseal]");
    if (unseal) unseal.addEventListener("click", function () {
      sealedKnowledgeBase = null;
      target.innerHTML = "<div class=\"notice\">Knowledge base re-opened. Review and seal again when ready.</div>";
    });
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
      budgetControl("Slide budget", "length.slide_budget", Math.max(1, Number(brief.length && brief.length.slide_budget) || 90), 1, 400, "slides");

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
      return "<a class=\"tracker-step\" href=\"#tracker-stage-detail-" + index + "\" data-tracker-step=\"" + index + "\" aria-label=\"Watch progress for " + attr(stage.label) + "\">" +
        "<span>" + String(index + 1).padStart(2, "0") + "</span><strong>" + esc(stage.label) + "</strong>" +
        "<em class=\"tracker-odometer\" data-tracker-percent>0%</em><small>Waiting</small></a>";
    }).join("");
    var panels = generatorStages.map(function (stage, index) {
      var work = (stage.work || [stage.detail]).map(function (item) {
        return "<li>" + esc(item) + "</li>";
      }).join("");
      return "<section class=\"tracker-stage-panel\" id=\"tracker-stage-detail-" + index + "\" data-tracker-panel=\"" + index + "\" tabindex=\"-1\">" +
        "<div class=\"tracker-stage-panel-head\"><div><p>Stage " + String(index + 1).padStart(2, "0") + "</p><h3>" + esc(stage.label) + "</h3></div>" +
        "<em class=\"tracker-odometer\" data-panel-percent>0%</em></div>" +
        "<p class=\"tracker-stage-status\" data-panel-status>Waiting</p>" +
        "<p>" + esc(stage.detail) + "</p>" +
        "<ul>" + work + "</ul></section>";
    }).join("");
    return "<section class=\"tracker-card\" aria-live=\"polite\">" +
      "<p class=\"kicker\">Masterclass Factory</p>" +
      "<h2>Generator tracker</h2>" +
      "<div class=\"tracker-now\"><span>Current stage</span><strong data-tracker-now-stage>Starting</strong></div>" +
      "<p class=\"tracker-detail\" data-tracker-detail>Starting the generator.</p>" +
      "<div class=\"tracker-road\">" + steps + "</div>" +
      "<div class=\"tracker-progress\"><span data-tracker-progress></span></div>" +
      "<p class=\"tracker-small\" data-tracker-small>This stays on screen until the masterclass package is ready. Bernard is coordinating source analysis, lesson writing, source verification, QA, quality scoring, and launch packaging.</p>" +
      "<div class=\"tracker-stage-panels\" aria-label=\"Generator stage details\">" + panels + "</div>" +
      "<div class=\"tracker-actions\"><button type=\"button\" class=\"ghost\" data-close-tracker>Hide tracker</button></div>" +
      "</section>";
  }

  function startGeneratorTracker() {
    closeGeneratorTracker();
    generatorTrackerIndex = 0;
    generatorFailedIndex = -1;
    generatorProgress = generatorStages.map(function () { return 0; });
    var tracker = document.createElement("div");
    tracker.className = "generator-tracker-screen";
    tracker.setAttribute("data-generator-tracker", "true");
    tracker.innerHTML = trackerHtml();
    document.body.appendChild(tracker);
    setGeneratorTrackerStage(0);
    generatorTrackerTimer = window.setInterval(function () {
      tickGeneratorOdometer();
    }, 950);
    return tracker;
  }

  function tickGeneratorOdometer() {
    if (!generatorProgress.length) return;
    var current = generatorProgress[generatorTrackerIndex] || 0;
    if (generatorTrackerIndex < generatorStages.length - 1) {
      generatorProgress[generatorTrackerIndex] = Math.min(94, current + (current < 45 ? 5 : current < 75 ? 3 : 1));
    }
    updateTrackerOdometers();
  }

  function markTrackerStagePassed(index) {
    if (!generatorProgress.length) generatorProgress = generatorStages.map(function () { return 0; });
    var passed = Math.max(0, Math.min(generatorStages.length - 1, index));
    generatorProgress[passed] = 100;
    updateTrackerOdometers();
  }

  function trackerStatusForStep(stepIndex) {
    var percent = Math.round(generatorProgress[stepIndex] || 0);
    if (stepIndex === generatorFailedIndex) return "Blocked";
    if (percent >= 100) return "Done";
    if (stepIndex === generatorTrackerIndex) return "In progress";
    return "Waiting";
  }

  function updateTrackerOdometers() {
    var tracker = document.querySelector("[data-generator-tracker]");
    if (!tracker) return;
    Array.from(tracker.querySelectorAll("[data-tracker-step]")).forEach(function (step) {
      var stepIndex = Number(step.getAttribute("data-tracker-step"));
      var percentValue = Math.round(generatorProgress[stepIndex] || 0);
      var statusValue = trackerStatusForStep(stepIndex);
      var percent = step.querySelector("[data-tracker-percent]");
      if (percent) percent.textContent = percentValue + "%";
      step.classList.toggle("done", statusValue === "Done");
      step.classList.toggle("active", stepIndex === generatorTrackerIndex);
      step.classList.toggle("blocked", statusValue === "Blocked");
      step.setAttribute("aria-valuenow", String(percentValue));
      var status = step.querySelector("small");
      if (status) status.textContent = statusValue;
    });
    Array.from(tracker.querySelectorAll("[data-tracker-panel]")).forEach(function (panel) {
      var panelIndex = Number(panel.getAttribute("data-tracker-panel"));
      var panelPercentValue = Math.round(generatorProgress[panelIndex] || 0);
      var panelStatusValue = trackerStatusForStep(panelIndex);
      var panelPercent = panel.querySelector("[data-panel-percent]");
      if (panelPercent) panelPercent.textContent = panelPercentValue + "%";
      panel.classList.toggle("done", panelStatusValue === "Done");
      panel.classList.toggle("active", panelIndex === generatorTrackerIndex);
      panel.classList.toggle("blocked", panelStatusValue === "Blocked");
      var panelStatus = panel.querySelector("[data-panel-status]");
      if (panelStatus) panelStatus.textContent = panelStatusValue;
    });
    var progress = tracker.querySelector("[data-tracker-progress]");
    if (progress) progress.style.width = Math.round(generatorProgress.reduce(function (sum, value) { return sum + value; }, 0) / generatorStages.length) + "%";
  }

  function setGeneratorTrackerStage(index, detail) {
    generatorTrackerIndex = Math.max(0, Math.min(generatorStages.length - 1, index));
    var tracker = document.querySelector("[data-generator-tracker]");
    if (!tracker) return;
    var active = generatorStages[generatorTrackerIndex];
    if (!generatorProgress.length) generatorProgress = generatorStages.map(function () { return 0; });
    generatorProgress[generatorTrackerIndex] = Math.max(generatorProgress[generatorTrackerIndex] || 0, 8);
    var nowStage = tracker.querySelector("[data-tracker-now-stage]");
    if (nowStage) nowStage.textContent = active.label;
    var detailBox = tracker.querySelector("[data-tracker-detail]");
    if (detailBox) detailBox.textContent = detail || active.detail;
    updateTrackerOdometers();
  }

  function completeGeneratorTracker(payload) {
    if (generatorTrackerTimer) window.clearInterval(generatorTrackerTimer);
    generatorTrackerTimer = null;
    generatorFailedIndex = -1;
    generatorProgress = generatorStages.map(function () { return 100; });
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

  function trackerIndexForFailure(error) {
    var stage = String(error && (error.failed_stage || error.stage) || "").toLowerCase();
    if (/knowledge-base-standard|knowledge_base|source-floor|primary-source/.test(stage)) return 1;
    if (/knowledge-base-discovery|research/.test(stage)) return 2;
    if (/blueprint/.test(stage)) return 3;
    if (/lesson|curriculum/.test(stage)) return 4;
    if (/author|slide|content-density|deep-dive/.test(stage)) return 5;
    if (/source|citation/.test(stage)) return 6;
    if (/qa|quality|schema/.test(stage)) return 7;
    var message = String(error && error.message || "").toLowerCase();
    if (/knowledge base|usable sources|primary sources|source floor/.test(message)) return 1;
    if (/research|bernard searched|web research/.test(message)) return 2;
    if (/slide|deep-dive|too thin/.test(message)) return 5;
    return generatorTrackerIndex;
  }

  function failGeneratorTracker(error) {
    if (generatorTrackerTimer) window.clearInterval(generatorTrackerTimer);
    generatorTrackerTimer = null;
    var tracker = document.querySelector("[data-generator-tracker]");
    if (!tracker) return;
    generatorFailedIndex = trackerIndexForFailure(error);
    setGeneratorTrackerStage(generatorFailedIndex, "The generator stopped here because this gate did not pass.");
    generatorProgress[generatorTrackerIndex] = Math.min(generatorProgress[generatorTrackerIndex] || 0, 94);
    updateTrackerOdometers();
    tracker.classList.add("failed");
    var detail = tracker.querySelector("[data-tracker-detail]");
    if (detail) detail.textContent = "The generator needs attention: " + (error && error.message ? error.message : "unknown error");
    var small = tracker.querySelector("[data-tracker-small]");
    if (small) small.textContent = "Nothing was published from this failed run. Fix the message shown on the page, then start the generator again.";
    var action = tracker.querySelector("[data-close-tracker]");
    if (action) action.textContent = "Return to setup";

    // When the failure is the knowledge-base source floor, offer a one-click
    // "have Bernard find the missing sources" path instead of a dead end.
    var isKbGate = generatorFailedIndex === 1 ||
      /knowledge-base-standard|source-floor|primary-source/.test(String(error && (error.failed_stage || error.stage) || "").toLowerCase()) ||
      /usable sources|primary sources|source floor/.test(String(error && error.message || "").toLowerCase());
    if (isKbGate) {
      var actions = tracker.querySelector(".tracker-actions");
      if (actions && !actions.querySelector("[data-remediate]")) {
        var fix = document.createElement("button");
        fix.type = "button";
        fix.className = "primary";
        fix.setAttribute("data-remediate", "true");
        fix.textContent = "Have Bernard find the missing sources";
        fix.addEventListener("click", function () { remediateKnowledgeBase(fix); });
        actions.insertBefore(fix, actions.firstChild);
      }
    }
  }

  async function remediateKnowledgeBase(button) {
    var tracker = document.querySelector("[data-generator-tracker]");
    var detail = tracker && tracker.querySelector("[data-tracker-detail]");
    var small = tracker && tracker.querySelector("[data-tracker-small]");
    if (button) { button.disabled = true; button.textContent = "Bernard is searching for sources..."; }
    if (small) small.textContent = "Bernard is running source discovery and checking each URL. This can take a little time.";
    try {
      var response = await fetch("/api/remediate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: parseBrief() })
      });
      var payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error((payload.errors || ["Remediation failed."]).join(" "));
      }
      var added = payload.added_sources || [];
      if (!added.length) {
        if (detail) detail.textContent = "Bernard could not verify any new sources. " + (payload.remaining_message || "");
        if (small) small.textContent = (payload.notes || []).join(" ") || "Try adding sources manually, then start the generator again.";
        if (button) { button.disabled = false; button.textContent = "Try Bernard again"; }
        return;
      }

      // Show the proposed sources for human approval before they go into the brief.
      var list = added.map(function (source) {
        return "<li><strong>" + esc(source.trust || "unknown") + "</strong> &middot; " +
          "<a href=\"" + attr(source.path) + "\" target=\"_blank\" rel=\"noopener\">" + esc(source.path) + "</a></li>";
      }).join("");
      var box = document.createElement("div");
      box.className = "notice";
      box.setAttribute("data-remediation-result", "true");
      box.innerHTML = "<strong>Bernard verified " + added.length + " source" + (added.length === 1 ? "" : "s") + ".</strong>" +
        (payload.would_meet_standard
          ? " Accepting these would meet the " + esc(payload.tier) + " source floor."
          : " This still leaves a gap: " + esc(payload.remaining_message || "")) +
        "<ul>" + list + "</ul>" +
        "<div class=\"assist-actions\">" +
        "<button type=\"button\" class=\"primary\" data-accept-sources>Add these sources to the setup</button>" +
        "<button type=\"button\" class=\"ghost\" data-dismiss-sources>Not now</button></div>";
      if (validationBox) {
        validationBox.innerHTML = "";
        validationBox.appendChild(box);
      }
      box.querySelector("[data-accept-sources]").addEventListener("click", function () {
        applyRemediatedSources(added);
        box.innerHTML = "<strong>Added " + added.length + " source" + (added.length === 1 ? "" : "s") + " to the setup.</strong> Review them on the Knowledge Base step, then start the generator again.";
        closeGeneratorTracker();
      });
      box.querySelector("[data-dismiss-sources]").addEventListener("click", function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      });
      if (detail) detail.textContent = "Bernard proposed sources. Review and accept them below the tracker.";
      try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (scrollError) {}
    } catch (remediationError) {
      if (detail) detail.textContent = "Source discovery failed: " + (remediationError && remediationError.message ? remediationError.message : "unknown error");
      if (button) { button.disabled = false; button.textContent = "Try Bernard again"; }
    }
  }

  // Write accepted sources into the live form's knowledge-base source list so
  // parseBrief() will include them on the next run. The exact DOM hook depends
  // on how the Knowledge Base step stores uploads; this dispatches a custom
  // event the wizard listens for, falling back to a hidden JSON field.
  function applyRemediatedSources(sources) {
    var event;
    try {
      event = new CustomEvent("masterclass:add-sources", { detail: { sources: sources } });
    } catch (eventError) {
      event = document.createEvent("CustomEvent");
      event.initCustomEvent("masterclass:add-sources", true, true, { sources: sources });
    }
    document.dispatchEvent(event);

    var hidden = form.querySelector("[data-extra-sources]");
    if (hidden) {
      var existing = [];
      try { existing = JSON.parse(hidden.value || "[]"); } catch (parseError) { existing = []; }
      hidden.value = JSON.stringify(existing.concat(sources));
    }
  }

  function closeGeneratorTracker() {
    if (generatorTrackerTimer) window.clearInterval(generatorTrackerTimer);
    generatorTrackerTimer = null;
    generatorFailedIndex = -1;
    var tracker = document.querySelector("[data-generator-tracker]");
    if (tracker && tracker.parentNode) tracker.parentNode.removeChild(tracker);
  }

  // Read a response body as JSON without ever throwing. A server timeout (504)
  // or platform error returns plain text ("An error o..."), and JSON.parse on
  // that is exactly what used to crash the run into a hard "blocked" state.
  async function readJsonSafe(response) {
    var bodyText = "";
    try { bodyText = await response.text(); } catch (e) { return null; }
    try { return JSON.parse(bodyText); } catch (e) { return null; }
  }

  // A non-JSON / timeout response must NEVER dead-end the job. The factory's
  // rule is that the human is the only off-switch, so surface choices instead
  // of a wall: retry, build with what exists, or have Bernard find sources.
  function presentGeneratorSnag(status) {
    if (generatorTrackerTimer) window.clearInterval(generatorTrackerTimer);
    generatorTrackerTimer = null;
    var tracker = document.querySelector("[data-generator-tracker]");
    if (tracker) {
      tracker.classList.remove("failed");
      var detail = tracker.querySelector("[data-tracker-detail]");
      if (detail) detail.textContent = "Bernard's research run took too long on the server" + (status ? " (status " + status + ")" : "") + " and was stopped. Nothing is lost and nothing is blocked.";
      var small = tracker.querySelector("[data-tracker-small]");
      if (small) small.textContent = "Choose how to proceed below — the job is not blocked.";
      var close = tracker.querySelector("[data-close-tracker]");
      if (close) close.textContent = "Return to setup";
    }
    if (!validationBox) return;
    validationBox.innerHTML =
      "<div class=\"notice warn\">" +
      "<p><strong>Bernard hit a snag, not a wall.</strong> The research step timed out on the server. Nothing is blocked — you decide how to proceed:</p>" +
      "<div class=\"assist-actions\">" +
      "<button type=\"button\" class=\"primary\" data-snag-retry>Try the generator again</button> " +
      "<button type=\"button\" data-snag-sources>Have Bernard find sources</button> " +
      "<button type=\"button\" data-snag-build>Build now with what exists</button>" +
      "</div></div>";
    var retry = validationBox.querySelector("[data-snag-retry]");
    if (retry) retry.addEventListener("click", function () { runGenerator(); });
    var src = validationBox.querySelector("[data-snag-sources]");
    if (src) src.addEventListener("click", function () { remediateKnowledgeBase(src); });
    var build = validationBox.querySelector("[data-snag-build]");
    if (build) build.addEventListener("click", function () { runGeneratorWithApproval({ proceed_anyway: true }); });
    setGenie("The research step timed out on the server. Nothing is blocked — you can retry, have me find sources, or build now with what exists.");
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
      markTrackerStagePassed(0);
      setGeneratorTrackerStage(1, "Building the knowledge base and source-quality list.");
      var response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: briefForGenerate(), publish: true }) });
      var payload = await readJsonSafe(response);
      if (!payload) { presentGeneratorSnag(response.status); return; }
      if (!response.ok || !payload.ok) {
        // The knowledge-base gate never dead-ends. A change order (scarce topic
        // or a met lower tier) or a precise human request is presented for a
        // decision instead of a bare failure.
        if (payload.status === "knowledge_base_review") {
          presentKnowledgeBaseReview(payload);
          return;
        }
        if (payload.status === "needs_decision" && payload.change_order) {
          presentChangeOrder(payload);
          return;
        }
        if (payload.status === "needs_decision" && payload.resolution === "quality_decision") {
          presentQualityDecision(payload);
          return;
        }
        if (payload.status === "qa_structural") {
          presentStructuralBlock(payload);
          return;
        }
        if (payload.status === "needs_human") {
          presentHumanRequest(payload);
          return;
        }
        var failure = new Error((payload.errors || ["Generator failed."]).join(" "));
        failure.failed_stage = payload.failed_stage || "";
        failure.stage_reports = payload.stage_reports || [];
        failure.knowledge_standard = payload.knowledge_standard || null;
        failure.source_discovery = payload.source_discovery || null;
        throw failure;
      }
      markTrackerStagePassed(1);
      setGeneratorTrackerStage(2, "Knowledge base passed. Research and source-grounded objectives are complete.");
      markTrackerStagePassed(2);
      setGeneratorTrackerStage(3, "Blueprint passed. Lesson plan, slides, and deep dives were built from the approved knowledge base.");
      markTrackerStagePassed(3);
      setGeneratorTrackerStage(4, "Lesson recipe passed. Slide generation and content-depth repair are complete.");
      markTrackerStagePassed(4);
      setGeneratorTrackerStage(5, "Slides are built. Running citation verification.");
      markTrackerStagePassed(5);
      setGeneratorTrackerStage(6, "Running source verification and QA.");
      markTrackerStagePassed(6);
      generation = payload;
      completeGeneratorTracker(payload);
      if (payload.publish && payload.publish.status === "published") {
        setGenie("Masterclass generated and sent to GitHub. Vercel should launch it at the generated class URL after the GitHub deployment finishes.");
      } else {
        setGenie("Masterclass generated with " + (payload.qa || "QA status unknown") + ". Open the preview now. Auto-publish will turn on once the GitHub token env vars are added in Vercel.");
      }
      enhanceReviewStep();
      maybeShowAdvancementOpportunity(payload);
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

  // Re-run the generator with an approval token (accept_tier or accept_change_order).
  async function runGeneratorWithApproval(extra) {
    if (validationBox) validationBox.innerHTML = "<div class=\"notice\">Applying your decision and building the class...</div>";
    startGeneratorTracker();
    try {
      setGeneratorTrackerStage(0, "Re-checking the setup with your approved change order.");
      markTrackerStagePassed(0);
      setGeneratorTrackerStage(1, "Building the knowledge base on the approved scope.");
      var body = Object.assign({ brief: briefForGenerate(), publish: true }, extra || {});
      var response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      var payload = await readJsonSafe(response);
      if (!payload) { presentGeneratorSnag(response.status); return; }
      if (!response.ok || !payload.ok) {
        if (payload.status === "knowledge_base_review") { presentKnowledgeBaseReview(payload); return; }
        if (payload.status === "needs_decision" && payload.change_order) { presentChangeOrder(payload); return; }
        if (payload.status === "needs_decision" && payload.resolution === "quality_decision") { presentQualityDecision(payload); return; }
        if (payload.status === "qa_structural") { presentStructuralBlock(payload); return; }
        if (payload.status === "needs_human") { presentHumanRequest(payload); return; }
        throw new Error((payload.errors || ["Generator failed."]).join(" "));
      }
      for (var i = 1; i <= 6; i += 1) markTrackerStagePassed(i);
      generation = payload; // <-- store it; without this the built class is discarded
      completeGeneratorTracker(payload);
      enhanceReviewStep();
      maybeShowAdvancementOpportunity(payload);
      var card = form.querySelector("[data-enhanced-generator]");
      if (card) card.innerHTML = generatorHtml();
      var built = (payload.slide_count || "the requested") + " slide" + (payload.slide_count === 1 ? "" : "s");
      var noteBits = ["Class built — " + built + "."];
      if (payload.knowledge_standard && payload.knowledge_standard.evidence_limited) {
        noteBits.push("Flagged evidence-limited (below the source floor) by your decision.");
      }
      if (payload.quality && payload.quality.published_below_bar) {
        noteBits.push("Published below the quality bar by your decision.");
      }
      if (validationBox) {
        validationBox.innerHTML = "<div class=\"notice\">" + esc(noteBits.join(" ")) +
          " <button type=\"button\" class=\"link-btn\" data-open-built-preview>Open the preview</button> or see the full package in Review &amp; Generate.</div>";
        var openBtn = validationBox.querySelector("[data-open-built-preview]");
        if (openBtn) openBtn.addEventListener("click", openGeneratedPreview);
      }
    } catch (error) {
      failGeneratorTracker(error);
      if (validationBox) validationBox.innerHTML = "<div class=\"notice warn\">Could not finish: " + esc(error.message || "Unknown error") + "</div>";
    }
  }

  // Render the knowledge-base score as a compact badge + component bars.
  function scoreHtml(score) {
    if (!score) return "";
    var bandClass = score.band === "excellent" ? "score-excellent"
      : score.band === "strong" ? "score-strong"
      : score.band === "usable" ? "score-usable" : "score-thin";
    var c = score.components || {};
    function bar(label, val) {
      return "<div class=\"score-bar-row\"><span class=\"score-bar-label\">" + esc(label) + "</span>" +
        "<span class=\"score-bar-track\"><span class=\"score-bar-fill\" style=\"width:" + Math.max(0, Math.min(100, val || 0)) + "%\"></span></span>" +
        "<span class=\"score-bar-val\">" + (val || 0) + "</span></div>";
    }
    return "<div class=\"kb-score " + bandClass + "\">" +
      "<div class=\"kb-score-head\"><span class=\"kb-score-num\">" + (score.score || 0) + "<span class=\"kb-score-den\">/100</span></span>" +
      "<span class=\"kb-score-band\">" + esc(score.band || "") + "</span></div>" +
      "<div class=\"kb-score-bars\">" + bar("Coverage", c.coverage) + bar("Authority", c.authority) + bar("Recency", c.recency) + "</div>" +
      (score.summary ? "<p class=\"kb-score-summary\">" + esc(score.summary) + "</p>" : "") +
      "</div>";
  }

  // Render the structured options as clickable choices. Build options carry a
  // token and run the generator with it; research/input/conversational options
  // wire to their handlers.
  function optionsHtml(options) {
    if (!options || !options.length) return "";
    return "<div class=\"resolution-options\">" + options.map(function (o) {
      return "<button type=\"button\" class=\"resolution-option option-" + esc(o.kind || "") + "\" " +
        "data-option-id=\"" + attr(o.id) + "\"" +
        (o.token ? " data-option-token=\"" + attr(JSON.stringify(o.token)) + "\"" : "") + ">" +
        "<span class=\"option-label\">" + esc(o.label) + "</span>" +
        (o.detail ? "<span class=\"option-detail\">" + esc(o.detail) + "</span>" : "") +
        "</button>";
    }).join("") + "</div>";
  }

  // The conversational box: human describes what they want; Bernard replies and,
  // if a re-search is implied, proposes it and asks for confirmation first.
  function conversationalBoxHtml() {
    return "<div class=\"bernard-chat\" data-bernard-chat>" +
      "<label class=\"bernard-chat-label\">Talk it through with Bernard</label>" +
      "<textarea class=\"bernard-chat-input\" data-bernard-input rows=\"2\" " +
      "placeholder=\"e.g. 'Focus on OSHA standards', 'I have a PDF to add — how?', or 'why isn't this enough?'\"></textarea>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"primary\" data-bernard-send>Ask Bernard</button></div>" +
      "<div class=\"bernard-chat-thread\" data-bernard-thread></div>" +
      "</div>";
  }

  function wireResolutionUI(box) {
    // Build options (carry a token) re-run the generator with that approval.
    box.querySelectorAll("[data-option-token]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var token = {};
        try { token = JSON.parse(btn.getAttribute("data-option-token")); } catch (e) { token = {}; }
        runGeneratorWithApproval(token);
      });
    });
    // Non-token options by id.
    box.querySelectorAll("[data-option-id]").forEach(function (btn) {
      if (btn.getAttribute("data-option-token")) return;
      var id = btn.getAttribute("data-option-id");
      btn.addEventListener("click", function () {
        if (id === "search_again") { remediateKnowledgeBase(btn); }
        else if (id === "add_source") { goToKnowledgeBaseStep(); }
        else if (id === "decline_build") { declineBuild(box); }
        else if (id === "ask_bernard") {
          var input = box.querySelector("[data-bernard-input]");
          if (input) { input.focus(); try { input.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }
        }
      });
    });
    wireConversationalBox(box);
  }

  function goToKnowledgeBaseStep() {
    var step = form.querySelector("[data-step=\"knowledge-base\"], #step-knowledge-base, [data-step-name=\"Knowledge base\"]");
    if (step && step.scrollIntoView) { try { step.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }
    setGenie("Add a source on the Knowledge Base step — paste a URL or upload a document — then start the generator again.");
  }

  function wireConversationalBox(box) {
    var sendBtn = box.querySelector("[data-bernard-send]");
    var input = box.querySelector("[data-bernard-input]");
    var thread = box.querySelector("[data-bernard-thread]");
    if (!sendBtn || !input || !thread) return;
    sendBtn.addEventListener("click", async function () {
      var q = (input.value || "").trim();
      if (!q) { input.focus(); return; }
      thread.innerHTML += "<div class=\"chat-turn chat-you\"><strong>You:</strong> " + esc(q) + "</div>";
      input.value = "";
      sendBtn.disabled = true; sendBtn.textContent = "Bernard is thinking...";
      try {
        var response = await fetch("/api/genie", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief: parseBrief(),
            step: "knowledge base",
            step_label: "Knowledge base recovery",
            payload: { question: q, context: "The knowledge base did not meet the requested floor. Help the user decide: refine the search, add a source, lower the tier, proceed evidence-limited, or explain the gap. If you recommend searching again, say so explicitly." }
          })
        });
        var payload = await response.json();
        if (!response.ok || !payload.ok) { throw new Error((payload.errors || ["Bernard could not respond."]).join(" ")); }
        var answer = payload.answer || "Bernard reviewed this, but had nothing to add.";
        thread.innerHTML += "<div class=\"chat-turn chat-bernard\"><strong>Bernard:</strong> " + esc(answer) + "</div>";
        // If Bernard's answer implies a re-search, offer a confirm button (no auto-run).
        if (/search again|re-?search|look again|another round|run discovery|find more sources/i.test(answer)) {
          var confirm = document.createElement("div");
          confirm.className = "assist-actions chat-confirm";
          confirm.innerHTML = "<button type=\"button\" class=\"primary\" data-confirm-research>Yes, have Bernard search again</button>";
          thread.appendChild(confirm);
          confirm.querySelector("[data-confirm-research]").addEventListener("click", function (e) {
            remediateKnowledgeBase(e.target);
          });
        }
        try { thread.scrollIntoView({ behavior: "smooth", block: "end" }); } catch (e) {}
      } catch (error) {
        thread.innerHTML += "<div class=\"chat-turn chat-bernard chat-error\"><strong>Bernard:</strong> " + esc(error.message || "Could not respond.") + "</div>";
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = "Ask Bernard";
      }
    });
  }

  // Present a CHANGE ORDER: score, situation, options menu, conversational box.
  function presentChangeOrder(payload) {
    closeGeneratorTracker();
    var co = payload.change_order || {};
    var rec = co.recommendation || {};
    var challenges = (co.challenges || []).map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("");
    var tried = (co.what_bernard_tried || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    var options = payload.options || co.options || [];

    var box = document.createElement("div");
    box.className = "notice change-order";
    box.innerHTML =
      "<h3>Here's what Bernard built — your call on next steps</h3>" +
      scoreHtml(payload.score || co.score) +
      "<p><strong>Situation.</strong> " + esc(co.situation || "") + "</p>" +
      (challenges ? "<p><strong>Challenges.</strong></p><ul>" + challenges + "</ul>" : "") +
      (rec.summary ? "<p><strong>Bernard's recommendation.</strong> " + esc(rec.summary) + "</p>" : "") +
      "<p><strong>Your options:</strong></p>" +
      optionsHtml(options) +
      (tried ? "<details><summary>What Bernard tried</summary><ul>" + tried + "</ul></details>" : "") +
      conversationalBoxHtml();
    if (validationBox) { validationBox.innerHTML = ""; validationBox.appendChild(box); }
    wireResolutionUI(box);
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (error) {}
  }

  // Present the precise request when the floor is not met — now graded and with
  // the full options menu + conversational box (never a bare wall).
  function presentHumanRequest(payload) {
    closeGeneratorTracker();
    var hr = payload.human_request || {};
    var co = payload.change_order || {};
    var options = payload.options || co.options || [];
    var tried = (hr.what_i_tried || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");

    var box = document.createElement("div");
    box.className = "notice change-order";
    box.innerHTML =
      "<h3>" + esc(hr.headline || "Here's where the knowledge base landed") + "</h3>" +
      scoreHtml(payload.score || co.score) +
      "<p>You decide how to proceed — nothing is blocked:</p>" +
      optionsHtml(options) +
      (tried ? "<details><summary>What Bernard tried</summary><ul>" + tried + "</ul></details>" : "") +
      conversationalBoxHtml();
    if (validationBox) { validationBox.innerHTML = ""; validationBox.appendChild(box); }
    wireResolutionUI(box);
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (error) {}
  }


  // Render a quality-score badge (0-100) with band coloring, like the KB score.
  function qualityScoreHtml(score, band) {
    if (score == null) return "";
    var bandClass = band === "excellent" ? "score-excellent"
      : band === "strong" ? "score-strong"
      : band === "usable" ? "score-usable" : "score-thin";
    return "<div class=\"kb-score " + bandClass + "\">" +
      "<div class=\"kb-score-head\"><span class=\"kb-score-num\">" + score + "<span class=\"kb-score-den\">/100</span></span>" +
      "<span class=\"kb-score-band\">" + esc(band || "") + "</span></div></div>";
  }

  // QUALITY DECISION: deck is structurally sound but scored below the release
  // bar. Graded, with ship-anyway / auto-improve / ask-Bernard. Never a wall.
  function presentQualityDecision(payload) {
    closeGeneratorTracker();
    var qo = payload.qa_outcome || {};
    var options = payload.options || qo.options || [];
    var weak = (qo.weakest_areas || []).map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("");
    var box = document.createElement("div");
    box.className = "notice change-order";
    box.innerHTML =
      "<h3>" + esc(qo.headline || "Your class is below the quality bar — your call") + "</h3>" +
      qualityScoreHtml(payload.quality_score, payload.quality_band) +
      (qo.explanation ? "<p>" + esc(qo.explanation) + "</p>" : "") +
      (weak ? "<p><strong>Weakest areas:</strong></p><ul>" + weak + "</ul>" : "") +
      "<p><strong>Your options:</strong></p>" +
      optionsHtml(options) +
      conversationalBoxHtml();
    if (validationBox) { validationBox.innerHTML = ""; validationBox.appendChild(box); }
    wireResolutionUI(box);
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (error) {}
  }

  // STRUCTURAL BLOCK: genuinely unshippable (broken build / missing citations).
  // Explained clearly with a regenerate path — not a raw error wall.
  function presentStructuralBlock(payload) {
    closeGeneratorTracker();
    var qo = payload.qa_outcome || {};
    var options = payload.options || qo.options || [];
    var issues = (qo.structural_issues || []).map(function (s) {
      return "<li><strong>" + esc(s.kind || "issue") + ":</strong> " + esc(s.issue) + "</li>";
    }).join("");
    var box = document.createElement("div");
    box.className = "notice warn";
    box.innerHTML =
      "<h3>" + esc(qo.headline || "The generated class has structural problems") + "</h3>" +
      (qo.explanation ? "<p>" + esc(qo.explanation) + "</p>" : "") +
      (issues ? "<details open><summary>What needs fixing</summary><ul>" + issues + "</ul></details>" : "") +
      "<p><strong>Your options:</strong></p>" +
      optionsHtml(options) +
      conversationalBoxHtml();
    if (validationBox) { validationBox.innerHTML = ""; validationBox.appendChild(box); }
    // 'regenerate' option re-runs the generator from scratch.
    box.querySelectorAll("[data-option-id]").forEach(function (btn) {
      if (btn.getAttribute("data-option-id") === "regenerate") {
        btn.addEventListener("click", function () { runGenerator(); });
      }
    });
    wireConversationalBox(box);
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (error) {}
  }

  function declineBuild(box) {
    if (validationBox) {
      validationBox.innerHTML = "<div class=\"notice\">No problem — the build is paused. Add sources or adjust the setup on the Knowledge Base step, then start the generator again whenever you're ready. Nothing was generated.</div>";
    }
    setGenie("Build paused at your request. Add sources or adjust the setup, then start the generator again whenever you're ready.");
  }

  // KNOWLEDGE BASE REVIEW: the floor was not met, but nothing is blocked. Show
  // the status, score, analysis, and recommendations — with "Build it anyway"
  // as the prominent default. The human is the only off-switch.
  // The ONE door that can reopen a sealed knowledge base. On a successful build,
  // the server may report a non-blocking advancement opportunity (a stronger
  // primary source found after seal). We surface it as an optional notice; it
  // never changed the build, and folding it in requires the human to re-open,
  // add the source, re-seal, and regenerate. Nothing is automatic.
  function maybeShowAdvancementOpportunity(payload) {
    var op = payload && payload.advancement_opportunity;
    if (!op || !validationBox) return;
    var candidates = (op.candidates || []).map(function (c) {
      return "<li><a href=\"" + attr(c.path || c.url || "#") + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + esc(c.title || c.path || "source") + "</a></li>";
    }).join("");
    var box = document.createElement("div");
    box.className = "notice kb-advancement";
    box.innerHTML =
      "<h3>&#11014; Advancement opportunity</h3>" +
      "<p>" + esc(op.headline || "A stronger source surfaced after the knowledge base was sealed.") + "</p>" +
      (op.detail ? "<p class=\"hint\">" + esc(op.detail) + "</p>" : "") +
      (candidates ? "<ul class=\"kb-advancement-list\">" + candidates + "</ul>" : "") +
      (op.execute_via ? "<p class=\"hint\"><strong>To fold it in:</strong> " + esc(op.execute_via) + "</p>" : "") +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-advance-reopen>Re-open knowledge base to add it</button></div>";
    validationBox.appendChild(box);
    var reopen = box.querySelector("[data-advance-reopen]");
    if (reopen) reopen.addEventListener("click", function () {
      sealedKnowledgeBase = null;
      goToKnowledgeBaseStep();
      setGenie("Knowledge base re-opened so you can add the stronger source, then review and seal again before regenerating.");
    });
  }

  function presentKnowledgeBaseReview(payload) {
    closeGeneratorTracker();
    var co = payload.change_order || {};
    var rec = co.recommendation || {};
    var options = payload.options || co.options || [];
    var challenges = (co.challenges || []).map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("");
    var tried = (co.what_bernard_tried || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    var box = document.createElement("div");
    box.className = "notice change-order kb-review";
    box.innerHTML =
      "<h3>Knowledge base review — your call on how to proceed</h3>" +
      "<p class=\"kb-review-lead\">Research is done. The class can be built right now — here's the status so you can decide. <strong>Nothing is blocked.</strong></p>" +
      scoreHtml(payload.score || co.score) +
      (co.situation ? "<p><strong>Status.</strong> " + esc(co.situation) + "</p>" : "") +
      (challenges ? "<details><summary>Analysis</summary><ul>" + challenges + "</ul></details>" : "") +
      (rec.summary ? "<p><strong>Bernard's recommendation.</strong> " + esc(rec.summary) + "</p>" : "") +
      "<p><strong>Your options:</strong></p>" +
      optionsHtml(options) +
      (tried ? "<details><summary>What Bernard tried</summary><ul>" + tried + "</ul></details>" : "") +
      conversationalBoxHtml();
    if (validationBox) { validationBox.innerHTML = ""; validationBox.appendChild(box); }
    wireResolutionUI(box);
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (error) {}
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
