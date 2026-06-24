/* ============================================================================
   curriculum-coherence.js — Deterministic coherence checks over a manifest.
   ----------------------------------------------------------------------------
   The piece that turns "the model promised the classes build on each other"
   into something verified. Pure logic, no network.

   Severity model (mirrors the platform's never-dead-end stance):
     - "error"   : structural — a real build problem (cycles, missing/forward
                   prerequisites). These set ok=false.
     - "warning" : quality signal worth a human's eye (duplication, weak
                   program-outcome coverage). Informative, never blocking.
     - "info"    : neutral observations.

   Output:
     {
       ok,                       // true when there are no errors
       findings: [ { severity, code, message, class?, related? } ],
       summary: { errors, warnings, infos },
       graph: { nodes:[slug], edges:[[from,to]] }   // prereq -> dependent
     }
============================================================================ */

var STOPWORDS = {
  the: 1, a: 1, an: 1, of: 1, to: 1, and: 1, or: 1, in: 1, on: 1, for: 1, with: 1,
  by: 1, at: 1, from: 1, as: 1, is: 1, are: 1, be: 1, this: 1, that: 1, it: 1, its: 1,
  their: 1, your: 1, you: 1, how: 1, why: 1, what: 1, when: 1, which: 1, into: 1,
  // objective verbs that carry no topic content
  explain: 1, describe: 1, list: 1, define: 1, identify: 1, understand: 1, use: 1,
  using: 1, apply: 1, applies: 1, demonstrate: 1, recognize: 1, summarize: 1,
  outline: 1, discuss: 1, compare: 1, analyze: 1, evaluate: 1, create: 1, build: 1,
  learner: 1, learners: 1, student: 1, students: 1, class: 1, able: 1, will: 1
};

function tokenize(text) {
  var set = {};
  String(text == null ? "" : text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .forEach(function (w) {
      if (w.length >= 3 && !STOPWORDS[w]) set[w] = true;
    });
  return set;
}

function normObjective(text) {
  return String(text == null ? "" : text).toLowerCase().replace(/\s+/g, " ").trim().replace(/[.;:!?]+$/, "").trim();
}

function classList(manifest) {
  return (manifest && Array.isArray(manifest.classes)) ? manifest.classes : [];
}

/* Build the prerequisite graph: edge prereq -> dependent. */
function buildGraph(manifest) {
  var classes = classList(manifest);
  var nodes = classes.map(function (c) { return c.slug; });
  var known = {};
  nodes.forEach(function (s) { known[s] = true; });
  var edges = [];
  classes.forEach(function (c) {
    (c.prerequisites || []).forEach(function (p) {
      var slug = p; // prerequisites are slug references
      if (known[slug]) edges.push([slug, c.slug]);
    });
  });
  return { nodes: nodes, edges: edges };
}

/* DFS cycle detection over the prereq->dependent edges. Returns array of cycles. */
function detectCycles(graph) {
  var adj = {};
  graph.nodes.forEach(function (n) { adj[n] = []; });
  graph.edges.forEach(function (e) { if (adj[e[0]]) adj[e[0]].push(e[1]); });

  var WHITE = 0, GRAY = 1, BLACK = 2;
  var color = {}, stack = [], cycles = [];
  graph.nodes.forEach(function (n) { color[n] = WHITE; });

  function visit(node) {
    color[node] = GRAY;
    stack.push(node);
    (adj[node] || []).forEach(function (next) {
      if (color[next] === GRAY) {
        var i = stack.indexOf(next);
        cycles.push(stack.slice(i).concat(next));
      } else if (color[next] === WHITE) {
        visit(next);
      }
    });
    stack.pop();
    color[node] = BLACK;
  }
  graph.nodes.forEach(function (n) { if (color[n] === WHITE) visit(n); });
  return cycles;
}

function analyzeCoherence(manifest) {
  var findings = [];
  function add(severity, code, message, klass, related) {
    findings.push({ severity: severity, code: code, message: message, class: klass || null, related: related || null });
  }

  var classes = classList(manifest);
  var graph = buildGraph(manifest);

  if (classes.length === 0) {
    add("error", "empty_curriculum", "The curriculum has no classes.");
    return finalize(findings, graph);
  }

  var bySlug = {};
  classes.forEach(function (c) { bySlug[c.slug] = c; });

  // 1) Unresolved + forward prerequisites
  classes.forEach(function (c) {
    (c.prerequisites || []).forEach(function (p) {
      var dep = bySlug[p];
      if (!dep) {
        add("error", "unresolved_prerequisite",
          "\"" + c.title + "\" requires \"" + p + "\", which is not a class in this curriculum.", c.slug, [p]);
      } else if (dep.order >= c.order) {
        add("error", "forward_prerequisite",
          "\"" + c.title + "\" (class " + c.order + ") requires \"" + dep.title + "\" (class " + dep.order + "), which is not taught earlier.", c.slug, [dep.slug]);
      }
    });
  });

  // 2) Cycles
  detectCycles(graph).forEach(function (cycle) {
    var titles = cycle.map(function (s) { return (bySlug[s] && bySlug[s].title) || s; });
    add("error", "prerequisite_cycle", "Prerequisite cycle: " + titles.join(" \u2192 ") + ".", null, cycle);
  });

  // 3) Redundancy: same terminal objective established by more than one class
  var byObjective = {};
  classes.forEach(function (c) {
    (c.terminal || []).forEach(function (t) {
      var key = normObjective(t);
      if (!key) return;
      (byObjective[key] = byObjective[key] || []).push(c);
    });
  });
  Object.keys(byObjective).forEach(function (key) {
    var owners = byObjective[key];
    if (owners.length > 1) {
      add("warning", "duplicate_objective",
        "The objective \"" + key + "\" is a terminal goal of " + owners.length + " classes; if that isn't deliberate spaced review, it may be redundant.",
        null, owners.map(function (c) { return c.slug; }));
    }
  });

  // 4) Outcome rollup (CLO -> PLO coverage)
  var outcome = normObjective(manifest && manifest.program_outcome);
  if (!outcome) {
    add("warning", "no_program_outcome",
      "No program-level outcome is set, so coherence can't verify the curriculum builds toward a stated goal.");
  } else {
    var outcomeTokens = tokenize(outcome);
    var covered = {};
    classes.forEach(function (c) {
      (c.terminal || []).forEach(function (t) {
        var tt = tokenize(t);
        Object.keys(tt).forEach(function (w) { covered[w] = true; });
      });
    });
    var missing = Object.keys(outcomeTokens).filter(function (w) { return !covered[w]; });
    var total = Object.keys(outcomeTokens).length;
    if (total > 0 && missing.length / total > 0.5) {
      add("warning", "weak_outcome_coverage",
        "The class objectives may not fully cover the program outcome. Concepts with no matching class objective: " + missing.slice(0, 8).join(", ") + ".",
        null, null);
    }
  }

  return finalize(findings, graph);
}

function finalize(findings, graph) {
  var summary = { errors: 0, warnings: 0, infos: 0 };
  findings.forEach(function (f) {
    if (f.severity === "error") summary.errors += 1;
    else if (f.severity === "warning") summary.warnings += 1;
    else summary.infos += 1;
  });
  return { ok: summary.errors === 0, findings: findings, summary: summary, graph: graph };
}

module.exports = {
  analyzeCoherence: analyzeCoherence,
  buildGraph: buildGraph,
  detectCycles: detectCycles,
  _internal: { tokenize: tokenize, normObjective: normObjective, buildGraph: buildGraph, detectCycles: detectCycles, analyzeCoherence: analyzeCoherence }
};
