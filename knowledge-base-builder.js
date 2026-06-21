/* knowledge-base-builder.js
   Knowledge Base Builder — saturation-control panel, vanilla JS.
   -------------------------------------------------------------------
   No build step, no React, no dependencies. Matches the v2.0 prototype:
   mastery ladder, diminishing-returns chart, per-sub-question list with
   L5 auto-saturation, closeable/structural thread tags, decision bar,
   inline Bernard chat.

   Load order in your HTML:
     <link rel="stylesheet" href="knowledge-base-builder.css">
     <script src="knowledge-base-builder.js"></script>

   Mount:
     mountKnowledgeBaseBuilder("#kb-root");                 // self-driving demo
     mountKnowledgeBaseBuilder(document.getElementById("x"), {
       topic: "...",
       points: [...],          // [{ inc, mastery, claims }]
       checkpoints: [...],     // see DEMO_CHECKPOINTS for shape
       onContinue: function () {},
       onNarrow:   function () {},
       onAccept:   function (finalState) {},
       onSendMessage: async function (text, state) { return "Bernard reply"; }
     });

   Wiring real research instead of the scripted demo: feed live `points`
   and `checkpoints` from your research endpoint. L5 rule: set a
   sub-question's level to 5 the moment its new-claims count is 0 for a
   full increment — the UI renders that row as saturated/done on its own.

   Returns a handle: { destroy() }  to tear the panel down.
*/
(function (global) {
  "use strict";

  var LEVELS = [
    { n: 1, name: "Orientation" },
    { n: 2, name: "Working" },
    { n: 3, name: "Substantiated" },
    { n: 4, name: "Expert" },
    { n: 5, name: "Saturation" }
  ];

  var DEMO_POINTS = [
    { inc: 1, mastery: 3.0, claims: 14 },
    { inc: 2, mastery: 4.0, claims: 12 },
    { inc: 3, mastery: 4.4, claims: 6 }
  ];

  var DEMO_CHECKPOINTS = [
    {
      pt: 0, sources: 13, overall: 3.0, rec: "continue",
      recText: "Spine is solid. The celebration arc and the contested points are still single-sourced.",
      sq: [
        { name: "Commemorated event", level: 4 },
        { name: "Why June 19 (the delay)", level: 4 },
        { name: "Evolution of celebrations", level: 2 },
        { name: "Path to recognition", level: 4 },
        { name: "Contested / myths", level: 2 }
      ],
      threads: [
        { name: "Celebration arc 1866 to present", gain: "high", type: "closeable" },
        { name: "Contested points and myths", gain: "high", type: "closeable" },
        { name: "Read-aloud conflict", gain: "medium", type: "closeable" }
      ]
    },
    {
      pt: 1, sources: 32, overall: 4.0, rec: "narrow",
      recText: "Spine is saturating. Traditions and symbolism is the last medium-value closeable gap.",
      sq: [
        { name: "Commemorated event", level: 4 },
        { name: "Why June 19 (the delay)", level: 4 },
        { name: "Evolution of celebrations", level: 4 },
        { name: "Path to recognition", level: 4 },
        { name: "Contested / myths", level: 4 }
      ],
      threads: [
        { name: "Traditions and symbolism", gain: "medium", type: "closeable" },
        { name: "Deliberate withholding debate", gain: "low", type: "structural" }
      ]
    },
    {
      pt: 2, sources: 40, overall: 4.4, rec: "stop",
      recText: "Spine sub-questions are saturated (L5). The core question is answered. Remaining gaps are low value or structural.",
      sq: [
        { name: "Commemorated event", level: 5 },
        { name: "Why June 19 (the delay)", level: 5 },
        { name: "Evolution of celebrations", level: 4 },
        { name: "Path to recognition", level: 4 },
        { name: "Contested / myths", level: 4 },
        { name: "Traditions and symbolism", level: 4 }
      ],
      threads: [
        { name: "Deliberate withholding debate", gain: "low", type: "structural" },
        { name: "Modern state-by-state status", gain: "low", type: "closeable" }
      ]
    }
  ];

  var REC_LABEL = { continue: "Continue", narrow: "Narrow", stop: "Stop suggested" };

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Diminishing-returns chart as an SVG string.
  function chartSVG(history, current) {
    var W = 320, H = 150, padL = 28, padB = 22, padT = 8, padR = 8;
    var ix = W - padL - padR, iy = H - padT - padB;
    function xAt(i) { return history.length === 1 ? padL : padL + ix * (i / (history.length - 1)); }
    function my(v) { return padT + iy * (1 - v / 5); }
    function cy(v) { return padT + iy * (1 - v / 16); }

    var parts = [];
    parts.push('<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" ' +
      'aria-label="Mastery rising and flattening while new claims per increment fall">');
    [1, 2, 3, 4, 5].forEach(function (l) {
      parts.push('<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + my(l) + '" y2="' + my(l) + '"/>');
    });
    [1, 2, 3, 4, 5].forEach(function (l) {
      parts.push('<text x="' + (padL - 5) + '" y="' + (my(l) + 3) + '" text-anchor="end">L' + l + '</text>');
    });
    parts.push('<line class="axis" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '"/>');
    history.forEach(function (p, i) {
      var y = cy(p.claims);
      parts.push('<rect class="claimBar" x="' + (xAt(i) - 9) + '" y="' + y + '" width="18" height="' + ((H - padB) - y) + '" rx="2"/>');
    });
    var line = history.map(function (p, i) { return xAt(i) + ',' + my(p.mastery); }).join(" ");
    parts.push('<polyline class="line" points="' + line + '" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>');
    history.forEach(function (p, i) {
      parts.push('<circle class="lineDot" cx="' + xAt(i) + '" cy="' + my(p.mastery) + '" r="3"/>');
    });
    parts.push('<circle class="lineRing" cx="' + xAt(history.length - 1) + '" cy="' + my(current.mastery) + '" r="5" stroke-width="2"/>');
    history.forEach(function (p, i) {
      parts.push('<text x="' + xAt(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + p.inc + '</text>');
    });
    parts.push('</svg>');
    return parts.join("");
  }

  function mount(target, opts) {
    opts = opts || {};
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) throw new Error("mountKnowledgeBaseBuilder: target element not found");

    var topic = opts.topic || "Juneteenth: history and recognition";
    var points = opts.points || DEMO_POINTS;
    var checkpoints = opts.checkpoints || DEMO_CHECKPOINTS;

    // state
    var cp = 0;
    var status = "checkpoint"; // checkpoint | researching | complete
    var narrowed = false;
    var sending = false;
    var msgs = [{ r: "bot", t: "Knowledge base under construction. I will stop at each checkpoint so you can decide whether to keep going." }];
    var timer = null;

    root.classList.add("kb");

    function current() { return checkpoints[Math.min(cp, checkpoints.length - 1)]; }
    function isLast() { return cp >= checkpoints.length - 1; }

    function advance(mode) {
      if (status === "researching" || isLast()) return;
      if (mode === "narrow") { narrowed = true; if (opts.onNarrow) opts.onNarrow(); }
      else { if (opts.onContinue) opts.onContinue(); }
      status = "researching";
      render();
      timer = setTimeout(function () {
        cp = Math.min(cp + 1, checkpoints.length - 1);
        status = "checkpoint";
        render();
      }, 1500);
    }

    function accept() {
      var C = current(), point = points[C.pt];
      status = "complete";
      if (opts.onAccept) opts.onAccept({ mastery: C.overall, sources: C.sources, increment: point.inc });
      msgs.push({ r: "bot", t: "Knowledge base accepted at L" + C.overall.toFixed(1) + " across " + C.sources + " sources. Synthesis is ready." });
      render();
    }

    function send() {
      var input = root.querySelector(".kb-input");
      if (!input) return;
      var t = input.value.trim();
      if (!t || sending) return;
      var C = current(), point = points[C.pt];
      msgs.push({ r: "me", t: t });
      sending = true;
      render();

      function finish(reply) {
        msgs.push({ r: "bot", t: reply });
        sending = false;
        render();
      }

      if (opts.onSendMessage) {
        Promise.resolve(
          opts.onSendMessage(t, { mastery: C.overall, sources: C.sources, increment: point.inc, threads: C.threads })
        ).then(finish).catch(function () {
          finish("I hit an error reaching the model. Try again in a moment.");
        });
      } else {
        var struct = C.threads.filter(function (x) { return x.type === "structural"; }).length;
        var reply = "We are at L" + C.overall.toFixed(1) + " after " + C.sources + " sources. " +
          C.threads.length + " thread" + (C.threads.length === 1 ? "" : "s") + " open" +
          (struct ? ", " + struct + " of them structural and not closeable by more search." : ".");
        setTimeout(function () { finish(reply); }, 400);
      }
    }

    function render() {
      var C = current();
      var point = points[C.pt];
      var history = points.slice(0, C.pt + 1);
      var last = isLast();
      var roundL = Math.round(C.overall);

      var pillClass = status === "researching" ? "pillResearch" : status === "complete" ? "pillComplete" : "pillCheckpoint";
      var pillText = status === "researching" ? "Researching" : status === "complete" ? "Complete" : "Checkpoint";

      var sqHtml = C.sq.map(function (s) {
        var done = s.level === 5;
        var right = done
          ? '<span class="sat">L5 &middot; saturated</span>'
          : '<span class="lvl ' + (s.level <= 2 ? "lvlLow" : "") + '">L' + s.level + '</span>';
        return '<div class="sq ' + (done ? "sqDone" : "") + '"><div class="sqName">' + esc(s.name) + '</div>' + right + '</div>';
      }).join("");

      var ladderHtml = LEVELS.map(function (lv) {
        var on = lv.n <= roundL;
        return '<div class="lad ' + (on ? "ladOn" : "") + ' ' + (lv.n === roundL ? "ladCur" : "") + '">' +
          '<div class="ln">L' + lv.n + '</div>' +
          '<div class="bar" style="height:' + (20 + lv.n * 18) + 'px"></div>' +
          '<div class="nm">' + lv.name + '</div></div>';
      }).join("");

      var threadsHtml = C.threads.map(function (t) {
        return '<div class="thread"><div class="tg">' +
          '<span class="dot ' + (t.type === "closeable" ? "dotTeal" : "dotAmber") + '"></span>' +
          '<span class="tgName">' + esc(t.name) + '</span></div>' +
          '<div class="badges">' +
          '<span class="gain ' + (t.gain === "high" ? "gainHigh" : "") + '">' + esc(t.gain) + ' gain</span>' +
          '<span class="type ' + (t.type === "closeable" ? "typeCloseable" : "typeStructural") + '">' + esc(t.type) + '</span>' +
          '</div></div>';
      }).join("");

      var decideHtml;
      if (status === "complete") {
        decideHtml = '<div class="complete">Knowledge base accepted at L' + C.overall.toFixed(1) + '. Synthesis is ready.</div>';
      } else if (status === "researching") {
        decideHtml = '<div class="working"><span class="dot pulse dotAmber"></span>Researching increment ' + (point.inc + 1) + '...</div>';
      } else {
        var recCls = C.rec === "continue" ? "recContinue" : C.rec === "narrow" ? "recNarrow" : "recStop";
        decideHtml =
          '<div class="decide"><div class="recline">' +
            '<span class="rec ' + recCls + '">' + REC_LABEL[C.rec] + (narrowed && C.rec !== "stop" ? " &middot; narrowed" : "") + '</span>' +
            '<span class="rectext">' + esc(C.recText) + '</span></div>' +
          '<div class="btns">' +
            '<button class="btn btnPrimary kb-continue"' + (last ? " disabled" : "") + '>Continue full</button>' +
            '<button class="btn kb-narrow"' + (last ? " disabled" : "") + '>Narrow to high-value</button>' +
            '<button class="btn btnAccept kb-accept">Accept knowledge base</button>' +
          '</div>' +
          (last ? '<p class="cap">No further increment would move the needle. Accept to synthesize.</p>' : '') +
          '</div>';
      }

      var msgsHtml = msgs.map(function (m) {
        return '<div class="msg ' + (m.r === "me" ? "msgMe" : "msgBot") + '">' + esc(m.t) + '</div>';
      }).join("") + (sending ? '<div class="cap">Bernard is thinking...</div>' : "");

      root.innerHTML =
        '<div class="panel"><div class="cols">' +
          '<div class="left">' +
            '<div class="row"><div>' +
              '<div class="kicker">Knowledge base builder <span class="proto">v2.0</span></div>' +
              '<h3 class="title">' + esc(topic) + '</h3></div>' +
              '<span class="pill ' + pillClass + '"><span class="dot ' + (status === "researching" ? "pulse" : "") + '"></span>' + pillText + '</span>' +
            '</div>' +
            '<div class="metrics">' +
              '<div class="metric"><div class="mLabel">Overall mastery</div><div class="mVal">L' + C.overall.toFixed(1) + '</div></div>' +
              '<div class="metric"><div class="mLabel">Increment</div><div class="mVal">' + point.inc + '</div></div>' +
              '<div class="metric"><div class="mLabel">Sources</div><div class="mVal">' + C.sources + '</div></div>' +
              '<div class="metric"><div class="mLabel">New claims</div><div class="mVal">' + point.claims + '</div></div>' +
            '</div>' +
            '<div class="sec">Mastery by sub-question</div>' + sqHtml +
            '<div class="sec">Mastery scale</div><div class="ladder">' + ladderHtml + '</div>' +
            '<div class="sec">Diminishing returns</div>' + chartSVG(history, point) +
            '<p class="cap">Teal line is mastery, bars are new claims per increment. The bars decaying is the saturation signal.</p>' +
            '<div class="sec">Open threads</div>' + threadsHtml +
            '<div class="legend">' +
              '<span><span class="dot dotTeal"></span>Closeable: research closes it</span>' +
              '<span><span class="dot dotAmber"></span>Structural: needs another method</span>' +
            '</div>' +
            decideHtml +
          '</div>' +
          '<div class="right">' +
            '<div class="chatH"><div class="ava">B</div><div>' +
              '<div class="chatName">Bernard</div><div class="chatSub">ask about the research</div></div></div>' +
            '<div class="msgs kb-msgs">' + msgsHtml + '</div>' +
            '<div class="chatIn">' +
              '<input class="kb-input" type="text" placeholder="Ask about mastery, gaps, sources..."' + (sending ? " disabled" : "") + '>' +
              '<button class="send kb-send" aria-label="Send"' + (sending ? " disabled" : "") + '>&#8593;</button>' +
            '</div>' +
          '</div>' +
        '</div></div>';

      // wire events
      var bC = root.querySelector(".kb-continue"); if (bC) bC.addEventListener("click", function () { advance("continue"); });
      var bN = root.querySelector(".kb-narrow"); if (bN) bN.addEventListener("click", function () { advance("narrow"); });
      var bA = root.querySelector(".kb-accept"); if (bA) bA.addEventListener("click", accept);
      var bS = root.querySelector(".kb-send"); if (bS) bS.addEventListener("click", send);
      var inp = root.querySelector(".kb-input");
      if (inp) inp.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

      // keep chat scrolled to newest
      var box = root.querySelector(".kb-msgs");
      if (box) box.scrollTop = box.scrollHeight;
    }

    render();

    return {
      destroy: function () {
        if (timer) clearTimeout(timer);
        root.innerHTML = "";
        root.classList.remove("kb");
      }
    };
  }

  global.mountKnowledgeBaseBuilder = mount;
})(typeof window !== "undefined" ? window : globalThis);
