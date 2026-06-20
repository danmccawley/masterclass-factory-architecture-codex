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
  var recommendation = null;
  var generation = null;

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
    var copyClassUrl = closest(event.target, "[data-copy-class-url]");

    if (quick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      askGenie(quick.dataset.genieQuick);
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

    if (copyClassUrl) {
      event.preventDefault();
      event.stopImmediatePropagation();
      copyGeneratedClassUrl();
      return;
    }

    if (event.target === nextButton && currentStep().indexOf("review") !== -1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runGenerator();
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
      "length": "Use the sliders, exact boxes, or ask Genie to balance time, slide count, and learner load.",
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
      "<p class=\"hint\">Terminal and enabling objectives should be identified after sources are collected, researched, and analyzed. Genie can prepare conservative objective candidates for the next step; the later AI pipeline must still verify them against the corpus.</p>" +
      "<div class=\"analysis-flow\"><span>Sources</span><span>Research rules</span><span>KB analysis</span><span>TLO/ELO candidates</span></div>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-genie-quick=\"knowledge-check\">Check knowledge base</button>" +
      "<button type=\"button\" class=\"primary\" data-ai=\"fill\">Prepare objective candidates</button></div>";
    var grid = form.querySelector(".form-grid") || form;
    grid.appendChild(card);
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
      budgetControl("Slide budget", "length.slide_budget", Number(brief.length && brief.length.slide_budget) || 90, 10, 400, "slides");

    var help = document.createElement("div");
    help.className = "summary-card full assist-panel";
    help.setAttribute("data-enhanced-length-help", "true");
    help.innerHTML =
      "<h3>Genie budget help</h3>" +
      "<p class=\"hint\">Choose a preset in increments of 10, drag the slider, type an exact number, ask for a recommendation, or leave the decision to Genie.</p>" +
      "<div class=\"assist-actions\"><button type=\"button\" class=\"ghost\" data-length-ai=\"recommend\">Ask Genie for recommendation</button>" +
      "<button type=\"button\" class=\"primary\" data-length-ai=\"apply\">Leave it to Genie</button></div>" +
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
    setGenie("Thinking...");
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
        if (!response.ok || !body.ok) throw new Error((body.errors || ["Genie is not connected yet."]).join(" "));
        return body;
      });
    });
  }

  function fallbackAnswer(type) {
    if (type === "knowledge-check") return "Build the knowledge base first: add sources, set research rules, then use analysis to draft objective candidates. Final objectives should not be treated as finished until the corpus is verified.";
    if (type === "check-step") return "This step is safe to continue when the required fields are clear, the source assumptions are explicit, and the setup check says it is ready.";
    if (type === "recommend-length") return lengthText(fallbackRecommendation());
    return "Genie can guide this step even before the API key is connected. For final AI assistance, make sure OPENAI_API_KEY is set in Vercel and redeployed.";
  }

  function fallbackRecommendation() {
    var brief = parseBrief();
    var minutes = Number(brief.length && brief.length.minutes) || 60;
    var slides = Math.max(20, Math.min(400, nearestTen(Math.round(minutes * 1.5), 10)));
    return { minutes: nearestTen(minutes, 10), slide_budget: slides, polls: 2, word_clouds: 4, quizzes: 1, final_test: true, reason: "Balanced for a professional class pace with time for interaction and review." };
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
    return "Genie recommends " + value.minutes + " minutes, " + value.slide_budget + " slides, " + value.polls + " polls, " + value.word_clouds + " word clouds, and " + value.quizzes + " quiz. " + value.reason;
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
    var classUrl = publish.status === "published" ? (generation.class_url || publish.expected_url || "") : "";
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
      "<div class=\"generator-status\"><div class=\"notice\"><strong>QA:</strong> " + esc(generation.qa || "Not run") + " · <strong>Source check:</strong> " + (generation.source_verify && generation.source_verify.ok ? "PASS" : "Not run") + " · <strong>Mode:</strong> " + esc(generation.mode || "unknown") + "</div>" +
      publishNotice +
      (classUrl ? "<div class=\"class-url-card\"><span class=\"mini-label\">Generated class URL</span><a href=\"" + attr(classUrl) + "\" target=\"_blank\" rel=\"noreferrer\">" + esc(classUrl) + "</a><img class=\"qr-image\" alt=\"QR code for generated class\" src=\"/api/qr?url=" + encodeURIComponent(classUrl) + "\"><button type=\"button\" class=\"ghost\" data-copy-class-url>Copy class link</button></div>" : "") +
      "<div class=\"generated-actions\"><button type=\"button\" class=\"primary\" data-open-preview>Open preview</button><button type=\"button\" class=\"ghost\" data-download-preview>Download preview HTML</button><button type=\"button\" class=\"ghost\" data-download-bundle>Download deploy bundle</button><button type=\"button\" class=\"ghost\" data-download-script>Download presenter script</button></div>" +
      (stages ? "<details class=\"generated-meta\"><summary>Pipeline stages</summary><ul>" + stages + "</ul></details>" : "") +
      (warnings ? "<details class=\"generated-meta\"><summary>Warnings and source notes</summary><ul>" + warnings + "</ul></details>" : "") +
      "</div><div class=\"generated-files\">" +
      filePreview("content.js", files["content.js"]) + filePreview("glossary.js", files["glossary.js"]) + filePreview("source.js", files["source.js"]) + "</div>";
  }

  async function runGenerator() {
    if (validationBox) validationBox.innerHTML = "<div class=\"notice\">Starting the generator...</div>";
    try {
      await fetch("/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parseBrief()) });
      var response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: parseBrief(), publish: true }) });
      var payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error((payload.errors || ["Generator failed."]).join(" "));
      generation = payload;
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
