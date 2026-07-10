"use strict";

function intakePrompt() {
  return [
    "Hi, I'm Bernard. Tell me the topic, audience, length, format, must-cover items, and any materials you already trust.",
    "I'll turn that into a plain-language brief, gather sources, build a Knowledge Core, ask you to seal it, then create the full masterclass package."
  ].join(" ");
}

function explainSeal(coreSummary) {
  return "Once you approve, this becomes the locked foundation for everything I build. I found " +
    coreSummary.items + " verified knowledge items across " + coreSummary.sources + " sources.";
}

function failureOptions(message) {
  return {
    message: message,
    options: [
      { id: "retry", label: "Try again" },
      { id: "find_more_sources", label: "Have Bernard find more sources" },
      { id: "narrow_scope", label: "Narrow the class scope" },
      { id: "proceed_flagged", label: "Build anyway with gaps clearly flagged" }
    ]
  };
}

module.exports = {
  intakePrompt: intakePrompt,
  explainSeal: explainSeal,
  failureOptions: failureOptions
};
