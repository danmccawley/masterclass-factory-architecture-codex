(function attachBriefValidator(root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BriefValidator = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createBriefValidator() {
  "use strict";

  var DEFAULT_TEMPLATE = {
    meta: { title: "", slug: "", created: "", engine_contract: "v-texas" },
    class_tier: { level: "professional" },
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
        require_two_sources_for: [
          "statistics",
          "forward-looking claims",
          "contested points"
        ]
      }
    },
    objectives: { terminal: [], enabling: [], out_of_scope: [] },
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

  var ENUMS = {
    "meta.engine_contract": ["v-texas"],
    "class_tier.level": ["briefing", "standard", "professional", "expert"],
    "knowledge_base.research.owner": ["creator", "assisted", "ai"],
    "knowledge_base.research.mode": ["none", "grounded", "collaborative"],
    "knowledge_base.credibility.min_tier": ["primary", "secondary", "unknown"],
    "mastery.granularity": ["survey", "working", "deep"],
    "mastery.deep_dive_density": ["low", "med", "high"],
    "audience.average.technical": ["non", "mixed", "technical"],
    "audience.floor.technical": ["non", "mixed", "technical"],
    "audience.tone": ["plain", "warm", "executive", "academic", "workshop"]
  };

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function typeName(value) {
    if (Array.isArray(value)) return "array";
    if (isPlainObject(value)) return "object";
    return typeof value;
  }

  function formatPath(parts) {
    return parts.length ? parts.join(".") : "brief";
  }

  function exactKeys(value, template, path, errors) {
    var expected = Object.keys(template);
    var actual = Object.keys(value);
    expected.forEach(function checkMissing(key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(formatPath(path.concat(key)) + " is missing.");
      }
    });
    actual.forEach(function checkExtra(key) {
      if (!Object.prototype.hasOwnProperty.call(template, key)) {
        errors.push(formatPath(path.concat(key)) + " is not in brief.template.json.");
      }
    });
  }

  function validateShape(value, template, path, errors) {
    if (Array.isArray(template)) {
      if (!Array.isArray(value)) {
        errors.push(formatPath(path) + " must be an array.");
      }
      return;
    }

    if (isPlainObject(template)) {
      if (!isPlainObject(value)) {
        errors.push(formatPath(path) + " must be an object.");
        return;
      }
      exactKeys(value, template, path, errors);
      Object.keys(template).forEach(function validateChild(key) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateShape(value[key], template[key], path.concat(key), errors);
        }
      });
      return;
    }

    if (typeof value !== typeof template) {
      errors.push(
        formatPath(path) +
          " must be " +
          typeName(template) +
          ", not " +
          typeName(value) +
          "."
      );
    }
  }

  function expectStringArray(value, path, errors) {
    if (!Array.isArray(value)) {
      errors.push(path + " must be an array.");
      return;
    }
    value.forEach(function validateString(item, index) {
      if (typeof item !== "string") {
        errors.push(path + "[" + index + "] must be a string.");
      }
    });
  }

  function expectInteger(value, path, errors, min, max) {
    if (!Number.isInteger(value)) {
      errors.push(path + " must be an integer.");
      return;
    }
    if (typeof min === "number" && value < min) {
      errors.push(path + " must be at least " + min + ".");
    }
    if (typeof max === "number" && value > max) {
      errors.push(path + " must be no more than " + max + ".");
    }
  }

  function expectEnum(value, path, errors) {
    var allowed = ENUMS[path];
    if (!allowed) return;
    if (allowed.indexOf(value) === -1) {
      errors.push(path + " must be one of: " + allowed.join(", ") + ".");
    }
  }

  function validateUploads(uploads, errors) {
    if (!Array.isArray(uploads)) {
      errors.push("knowledge_base.uploads must be an array.");
      return;
    }
    uploads.forEach(function validateUpload(upload, index) {
      var path = "knowledge_base.uploads[" + index + "]";
      if (!isPlainObject(upload)) {
        errors.push(path + " must be an object.");
        return;
      }
      exactKeys(upload, { path: "", type: "", trust: "" }, ["knowledge_base", "uploads", "[" + index + "]"], errors);
      ["path", "type", "trust"].forEach(function validateUploadString(key) {
        if (typeof upload[key] !== "string") {
          errors.push(path + "." + key + " must be a string.");
        }
      });
      if (typeof upload.trust === "string" && ["primary", "secondary", "unknown"].indexOf(upload.trust) === -1) {
        errors.push(path + ".trust must be one of: primary, secondary, unknown.");
      }
    });
  }

  function validateDateString(value, path, errors) {
    if (typeof value !== "string") return;
    if (value && Number.isNaN(Date.parse(value))) {
      errors.push(path + " must be an ISO-readable date string.");
    }
  }

  function validateExtras(brief, errors) {
    validateUploads(brief.knowledge_base.uploads, errors);

    [
      "knowledge_base.research.seed_prompts",
      "knowledge_base.credibility.require_two_sources_for",
      "objectives.terminal",
      "objectives.enabling",
      "objectives.out_of_scope"
    ].forEach(function validateArray(path) {
      var value = path.split(".").reduce(function dig(object, key) {
        return object && object[key];
      }, brief);
      expectStringArray(value, path, errors);
    });

    Object.keys(ENUMS).forEach(function validateEnum(path) {
      var value = path.split(".").reduce(function dig(object, key) {
        return object && object[key];
      }, brief);
      expectEnum(value, path, errors);
    });

    validateDateString(brief.meta.created, "meta.created", errors);
    validateDateString(brief.knowledge_base.research.recency_floor, "knowledge_base.research.recency_floor", errors);

    expectInteger(brief.mastery.target_level, "mastery.target_level", errors, 1, 5);
    expectInteger(brief.length.minutes, "length.minutes", errors, 10, 480);
    expectInteger(brief.length.slide_budget, "length.slide_budget", errors, 1, 400);
    expectInteger(brief.length.interaction_budget.polls, "length.interaction_budget.polls", errors, 0, 50);
    expectInteger(brief.length.interaction_budget.word_clouds, "length.interaction_budget.word_clouds", errors, 0, 50);
    expectInteger(brief.length.interaction_budget.quizzes, "length.interaction_budget.quizzes", errors, 0, 50);
    expectInteger(brief.audience.accessibility.reading_grade_cap, "audience.accessibility.reading_grade_cap", errors, 3, 16);
  }

  function validateBrief(brief, template) {
    var contract = template || DEFAULT_TEMPLATE;
    var errors = [];
    if (!isPlainObject(brief)) {
      return { ok: false, errors: ["brief must be an object."] };
    }
    validateShape(brief, contract, [], errors);
    if (!errors.length) {
      validateExtras(brief, errors);
    }
    return { ok: errors.length === 0, errors: errors };
  }

  return {
    DEFAULT_TEMPLATE: DEFAULT_TEMPLATE,
    validateBrief: validateBrief
  };
});
