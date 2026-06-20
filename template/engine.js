/* ============================================================================
   ENGINE — {{CLASS_TITLE}}  ·  Master Class
   ----------------------------------------------------------------------------
   Renders SLIDES from content.js, drives navigation (arrows/swipe/keys),
   builds the title QR client-side from the current URL, opens the parchment
   deep-dive layer, and wires the three interactive backends:
     /api/poll  · /api/words  · /api/chat
   All three DEGRADE GRACEFULLY: if the backend is unreachable the deck still
   runs and shows this device's own input, so a network hiccup never kills the
   class.
   ============================================================================ */
(function(){
  "use strict";

  var SLIDES = window.SLIDES || [];
  var deck = document.getElementById("deck");
  var bar = document.getElementById("bar");
  var counter = document.getElementById("counter");
  var idx = 0;

  function setDeviceClass(){
    var width = window.innerWidth || document.documentElement.clientWidth || 0;
    var touch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
    var device = width <= 600 ? "phone" : width <= 1180 ? "tablet" : "desktop";
    document.documentElement.setAttribute("data-device", device);
    document.documentElement.classList.toggle("touch-device", !!touch);
  }
  setDeviceClass();
  window.addEventListener("resize", setDeviceClass, { passive:true });

  /* ---------- POLL / WORD definitions (deck-defined in content.js) ---------- */
  var POLLS = window.POLLS || {};
  var WORDS = window.WORDS || {};
  var CLASS_SLUG = (window.DECK_META && window.DECK_META.slug) ||
    String(window.CLASS_TITLE || "{{CLASS_TITLE}}").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") ||
    "masterclass";

  /* ---------- COMPREHENSION LEVEL (1–5): scales quiz difficulty + AI grading ---------- */
  var COMP_LEVELS = [
    { n:1, key:"novice",        label:"Novice",                 blurb:"Just starting — basic recall and simple ideas." },
    { n:2, key:"conversational",label:"Conversational",         blurb:"Can hold a conversation about it in plain language." },
    { n:3, key:"proficient",    label:"Proficient",             blurb:"Uses key terms correctly and explains the causes." },
    { n:4, key:"mastery",       label:"Mastery",                blurb:"Handles nuance, multiple factors, and where historians disagree." },
    { n:5, key:"sme",           label:"Subject-Matter Expert · Teach", blurb:"Can teach it: clear, specific, with caveats and significance." }
  ];
  function compLevel(){
    var v = 2;
    try { v = parseInt(localStorage.getItem("tx_comp_level"),10) || 2; } catch(e){}
    return v<1 ? 1 : v>5 ? 5 : v;
  }
  function compMeta(n){ return COMP_LEVELS[(n||compLevel())-1] || COMP_LEVELS[1]; }
  window.compLevel = compLevel;
  function updateLevelBadge(){
    var m = compMeta();
    var lb = document.getElementById("levelBtn");
    if(lb){ lb.innerHTML = "\u25CE Level \u00B7 <b>Lv"+m.n+"</b>"; lb.setAttribute("title","Comprehension level: "+m.label+" — tap to change"); }
    Array.prototype.forEach.call(document.querySelectorAll("#levelModal .lvl-opt"), function(o){
      o.classList.toggle("sel", parseInt(o.getAttribute("data-lvl"),10)===m.n);
    });
  }
  window.updateLevelBadge = updateLevelBadge;
  window.openLevel = function(){
    var mod = document.getElementById("levelModal");
    if(mod){ mod.classList.add("open"); updateLevelBadge(); }
  };
  window.setCompLevel = function(n){
    n = Math.max(1, Math.min(5, parseInt(n,10)||2));
    try { localStorage.setItem("tx_comp_level", String(n)); } catch(e){}
    updateLevelBadge();
    refreshQuizzes();
  };
  function refreshQuizzes(){
    Array.prototype.forEach.call(document.querySelectorAll("[data-quiz]"), function(m){ m.removeAttribute("data-bound"); });
    bindQuiz();
  }
  window.refreshQuizzes = refreshQuizzes;

  /* ---------- COLLAPSIBLE TOOLS MENU (single ☰ button) ---------- */
  function setToolsToggleLabel(open){
    var tg=document.getElementById("toolsToggle");
    if(tg){
      tg.innerHTML = open ? "\u2715 Close" : "\u2630 Menu";
      tg.setAttribute("aria-label", open ? "Close class menu" : "Open class menu");
    }
  }
  window.toggleTools = function(){
    var t=document.getElementById("tools"); if(!t) return;
    var open = t.classList.toggle("open");
    setToolsToggleLabel(open);
  };
  function closeTools(){
    var t=document.getElementById("tools");
    if(t && t.classList.contains("open")){ t.classList.remove("open"); setToolsToggleLabel(false); }
  }
  document.addEventListener("click", function(e){
    var t=document.getElementById("tools");
    if(!t || !t.classList.contains("open")) return;
    var tg=document.getElementById("toolsToggle");
    if(tg && (e.target===tg || tg.contains(e.target))) return;     // the toggle handles itself
    if(e.target.closest && e.target.closest(".tools-items")){ closeTools(); return; } // picked a tool → collapse
    if(!t.contains(e.target)) closeTools();                        // clicked elsewhere → collapse
  });

  /* ---------- RENDER ---------- */
  function render(){
    deck.innerHTML = "";
    SLIDES.forEach(function(s, i){
      var el = document.createElement("section");
      el.className = "slide" + (i===0 ? " active" : "");
      el.setAttribute("data-id", s.id);
      el.innerHTML = s.deck;
      el.addEventListener("scroll", function(){ updateScrollCue(); }, {passive:true});
      deck.appendChild(el);
    });
    bindDeepButtons();
    bindDiagrams();
    bindQuiz();
    bindGlossary();
    bindHeatmap();
    bindCitations();
    bindTiles();
    update();
    buildQR();
  }

  /* ---------- HEAT MAP interactive cells ---------- */
  function bindHeatmap(){
    var tip = document.getElementById("glosstip");
    if(!tip){ tip = document.createElement("div"); tip.id="glosstip"; tip.className="glosstip"; document.body.appendChild(tip); }
    function place(el){
      var r = el.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(12, r.left), window.innerWidth - tip.offsetWidth - 12) + "px";
      var top = r.bottom + 8;
      if(top + tip.offsetHeight > window.innerHeight - 12) top = r.top - tip.offsetHeight - 8;
      tip.style.top = top + "px";
    }
    function show(el){
      var hint = el.getAttribute("data-dd") ? "<div class='gt-rel'><span>Click</span> for the full detail + deep dive</div>" : "";
      tip.innerHTML = "<div class='gt-term'>"+(el.getAttribute("data-head")||"")+"</div><div class='gt-def'>"+(el.getAttribute("data-detail")||"")+"</div>"+hint;
      tip.classList.add("show");
      tip.style.left="-9999px"; tip.style.top="0";
      requestAnimationFrame(function(){ place(el); });
    }
    function hide(){ tip.classList.remove("show"); }
    var _hmHideT = null;
    function hideSoon(){ if(_hmHideT) clearTimeout(_hmHideT); _hmHideT = setTimeout(hide, 260); }
    // keep the shared tooltip alive while the pointer is over it (so the user can move
    // from the region to the tooltip without it vanishing)
    if(tip.getAttribute("data-hmhoverbound")!=="1"){
      tip.setAttribute("data-hmhoverbound","1");
      tip.addEventListener("mouseenter", function(){ if(_hmHideT){ clearTimeout(_hmHideT); _hmHideT=null; } });
      tip.addEventListener("mouseleave", hideSoon);
    }
    Array.prototype.forEach.call(document.querySelectorAll(".hmcell, .hmzone"), function(el){
      if(el.getAttribute("data-hmbound")==="1") return;
      el.setAttribute("data-hmbound","1");
      // hover: lightweight tooltip; closes shortly after the pointer leaves (grace period
      // lets the user reach the tooltip itself)
      el.addEventListener("mouseenter", function(){ if(_hmHideT){ clearTimeout(_hmHideT); _hmHideT=null; } if(!document.getElementById("tileModal").classList.contains("open")) show(el); });
      el.addEventListener("mouseleave", hideSoon);
      // click: full detail modal (carries deep-dive + source links if present)
      el.addEventListener("click", function(e){
        e.stopPropagation();
        if(_hmHideT){ clearTimeout(_hmHideT); _hmHideT=null; }
        hide();
        if(window.openTile) window.openTile(el);
        else show(el);
      });
      // add an affordance hint to the hover tooltip via a flag the show() picks up
      el.setAttribute("data-clickable","1");
    });
  }

  function bindDeepButtons(){
    Array.prototype.forEach.call(document.querySelectorAll(".deepbtn"), function(b){
      b.addEventListener("click", function(){ openPaper(b.getAttribute("data-deep")); });
    });
  }

  /* ---------- INTERACTIVE DIAGRAMS ---------- */
  /* Desktop: diagrams enlarge on hover (pure CSS). Touch devices have no hover,
     so on touch we enable tap-to-open a full-screen, pinch-zoomable view. */
  var IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  function bindDiagrams(){
    if(!IS_TOUCH) return; // desktop uses CSS hover; nothing to bind
    Array.prototype.forEach.call(document.querySelectorAll(".diagram-wrap"), function(wrap){
      wrap.style.cursor = "zoom-in";
      wrap.addEventListener("click", function(){
        var svg = wrap.querySelector("svg");
        if(!svg) return;
        var box = document.getElementById("lbcontent");
        if(!box) return;
        box.innerHTML = "";
        var clone = svg.cloneNode(true);
        var vb = (clone.getAttribute("viewBox") || "0 0 900 560").split(/\s+/).map(Number);
        var ar = (vb[2] && vb[3]) ? (vb[2]/vb[3]) : 1.6;
        var maxW = window.innerWidth * 0.96, maxH = window.innerHeight * 0.86;
        var cw = maxW, ch = cw / ar;
        if(ch > maxH){ ch = maxH; cw = ch * ar; }
        clone.setAttribute("width", Math.round(cw));
        clone.setAttribute("height", Math.round(ch));
        clone.setAttribute("style", "display:block;max-width:none;");
        box.appendChild(clone);
        document.getElementById("lightbox").classList.add("open");
      });
    });
  }
  function closeLightbox(){ var l=document.getElementById("lightbox"); if(l){ l.classList.remove("open"); var c=document.getElementById("lbcontent"); if(c) c.innerHTML=""; } }

  /* ---------- COMPREHENSION-CHECK QUIZ (one question at a time) ---------- */
  function bindQuiz(){
    // Multiple quiz mounts exist (pop-quizzes + final quiz). getElementById would
    // only catch the first, so select every mount by its data-quiz attribute.
    var mounts = document.querySelectorAll("[data-quiz]");
    Array.prototype.forEach.call(mounts, function(m){ bindOneQuiz(m); });
  }
  function bindOneQuiz(mount){
    if(!mount) return;
    if(mount.getAttribute("data-bound")==="1") return; // don't re-bind
    mount.setAttribute("data-bound","1");
    var ALLQ;
    try { ALLQ = JSON.parse(mount.getAttribute("data-quiz")); } catch(e){ ALLQ = null; }
    if(!ALLQ || !ALLQ.length){ mount.innerHTML = "<p class='dim'>Quiz unavailable.</p>"; return; }

    var IS_POP = mount.getAttribute("data-pop") === "1";
    var LVL = compLevel();
    var LVLNAME = compMeta(LVL).label;
    // Difficulty tied to comprehension level: show every question whose minimum
    // level (q.level, default 1) is at or below the chosen level. Higher level = more,
    // harder questions surface. Always keep at least one question.
    var Q = ALLQ.filter(function(q){ return (q.level||1) <= LVL; });
    if(!Q.length) Q = ALLQ.slice(0,1);

    var i = 0, scoreMap = {}; // best fractional score (0..1) achieved per question
    var answered = false;

    function esc(t){ var d=document.createElement("div"); d.textContent=t; return d.innerHTML; }
    function norm(s){ return (s||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim(); }
    function totalScore(){ var s=0; for(var k in scoreMap){ s+=scoreMap[k]; } return s; }
    function setScore(idx, v){ scoreMap[idx] = Math.max(scoreMap[idx]||0, v); }

    function renderQ(){
      answered = false;
      var q = Q[i];
      var typeLabel = q.type==="mc" ? "Multiple choice" : q.type==="tf" ? "True / False" : "Short answer · AI-graded";
      var h = "";
      var lvlChip = "<span class='quiz-lvl' title='Comprehension level — change it with the ◎ Level button'>Lv"+LVL+" · "+esc(LVLNAME)+"</span>";
      if(IS_POP){
        h += "<div class='quiz-head'><span class='quiz-type'>"+typeLabel+"</span>"+lvlChip+"</div>";
      } else {
        h += "<div class='quiz-head'><span class='quiz-prog'>Question "+(i+1)+" of "+Q.length+"</span><span class='quiz-type'>"+typeLabel+"</span>"+lvlChip+"<span class='quiz-score'>Score: "+(Math.round(totalScore()*10)/10)+"</span></div>";
      }
      h += "<div class='quiz-q'>"+esc(q.q)+"</div>";

      if(q.type==="mc"){
        h += "<div class='quiz-opts'>";
        for(var k=0;k<q.options.length;k++){ h += "<button class='quiz-opt' data-k='"+k+"'>"+esc(q.options[k])+"</button>"; }
        h += "</div>";
      } else if(q.type==="tf"){
        h += "<div class='quiz-opts'><button class='quiz-opt' data-tf='true'>True</button><button class='quiz-opt' data-tf='false'>False</button></div>";
      } else {
        var ph = LVL>=4 ? "Explain in your own words…" : "Type your answer…";
        h += "<div class='quiz-sa'><textarea id='quizSA' rows='"+(LVL>=4?4:3)+"' placeholder='"+ph+"' autocomplete='off'></textarea><button class='quiz-submit' id='quizSubmit'>Submit for AI grading</button><div class='quiz-sahint'>Tip: press Ctrl/⌘ + Enter to submit. You'll be graded for a "+esc(LVLNAME)+" level.</div></div>";
      }
      h += "<div class='quiz-fb' id='quizFb'></div>";
      if(IS_POP){
        h += "<div class='quiz-nav'><span class='quiz-pophint' id='quizNext' style='display:none'>Swipe or tap → to continue</span></div>";
      } else {
        h += "<div class='quiz-nav'><button class='quiz-next' id='quizNext' style='display:none'>"+(i<Q.length-1?"Next question →":"See results →")+"</button></div>";
      }
      mount.innerHTML = h;

      Array.prototype.forEach.call(mount.querySelectorAll(".quiz-opt"), function(btn){
        btn.addEventListener("click", function(){
          if(answered) return;
          if(q.type==="mc") grade(parseInt(btn.getAttribute("data-k"),10), btn);
          else grade(btn.getAttribute("data-tf")==="true", btn);
        });
      });
      var sub = mount.querySelector("#quizSubmit");
      if(sub){
        sub.addEventListener("click", gradeSA);
        var inp=mount.querySelector("#quizSA");
        inp.addEventListener("keydown", function(e){ if(e.key==="Enter" && (e.ctrlKey||e.metaKey)){ e.preventDefault(); gradeSA(); } });
        inp.focus();
      }
      var nx = mount.querySelector("#quizNext");
      if(nx && !IS_POP) nx.addEventListener("click", function(){ i++; if(i<Q.length) renderQ(); else results(); });
    }

    function lockOpts(){ Array.prototype.forEach.call(mount.querySelectorAll(".quiz-opt"), function(b){ b.disabled=true; }); }
    function showNext(){ var n=mount.querySelector("#quizNext"); if(n) n.style.display=""; }
    function showRetry(label){
      var nav=mount.querySelector(".quiz-nav");
      if(!nav) return;
      nav.innerHTML="<button class='quiz-next quiz-retry' id='quizRetryQ'>"+(label||"Try this question again ↺")+"</button>"
                  + (IS_POP?"":" <button class='quiz-next quiz-skip' id='quizSkipQ'>Skip →</button>");
      mount.querySelector("#quizRetryQ").addEventListener("click", function(){ renderQ(); });
      var sk=mount.querySelector("#quizSkipQ");
      if(sk) sk.addEventListener("click", function(){ i++; if(i<Q.length) renderQ(); else results(); });
    }
    function feedback(kind, html){
      var fb=mount.querySelector("#quizFb");
      var head = kind==="ok" ? "✓ Correct" : kind==="partial" ? "◑ Partly right" : kind==="grading" ? "" : "✗ Not quite";
      fb.className="quiz-fb "+(kind==="ok"?"ok":kind==="partial"?"partial":kind==="grading"?"grading":"no");
      fb.innerHTML=(head?"<b>"+head+"</b> — ":"")+html;
    }

    function grade(choice, btn){
      answered=true; lockOpts();
      var q=Q[i]; var correct=q.answer; var ok=(choice===correct);
      Array.prototype.forEach.call(mount.querySelectorAll(".quiz-opt"), function(b){
        var isCorrect = q.type==="mc" ? (parseInt(b.getAttribute("data-k"),10)===correct) : (b.getAttribute("data-tf")===String(correct));
        if(isCorrect) b.classList.add("correct");
      });
      if(ok){
        setScore(i,1);
        trackParticipation("quiz_attempt", { score: 1, type: q.type });
        feedback("ok", esc(q.why||"")); showNext();
      } else {
        trackParticipation("quiz_attempt", { score: 0, type: q.type });
        btn.classList.add("wrong");
        feedback("no", esc(q.why||"")); showRetry();
      }
    }

    // ----- AI-graded short answer (difficulty scales with comprehension level) -----
    function gradeSA(){
      if(answered) return;
      var ta = mount.querySelector("#quizSA");
      var raw = (ta.value||"").trim();
      if(!raw) return;
      answered=true;
      ta.disabled=true;
      var sub=mount.querySelector("#quizSubmit"); if(sub){ sub.disabled=true; }
      feedback("grading", "<span class='quiz-spin'></span> Grading your answer for a <b>"+esc(LVLNAME)+"</b> level…");
      var q=Q[i];
      gradeWithAI(q, raw, function(res){
        var sc = Math.max(0, Math.min(1, (res && typeof res.score==="number") ? res.score : 0));
        setScore(i, sc);
        trackParticipation("quiz_attempt", { score: sc, type: q.type });
        var verdict = res && res.verdict;
        var fbText = esc((res && res.feedback) || "");
        var model = q.sample ? "<div class='quiz-model'><b>A strong answer:</b> "+esc(q.sample)+"</div>" : "";
        ta.classList.add(verdict==="correct"?"correct":verdict==="partial"?"partial":"wrong");
        if(verdict==="correct"){
          feedback("ok", fbText); showNext();
        } else if(verdict==="partial"){
          feedback("partial", fbText+model); showNext(); // partial credit counts; still let them move on
          // also allow a retry to improve
          var nav=mount.querySelector(".quiz-nav");
          if(nav){ var b=document.createElement("button"); b.className="quiz-next quiz-retry"; b.textContent="Improve your answer ↺"; b.onclick=function(){ renderQ(); }; nav.appendChild(b); }
        } else {
          feedback("no", fbText+model); showRetry();
        }
      });
    }

    function gradeWithAI(q, answer, done){
      var payload = {
        question: q.q,
        rubric: q.rubric || q.why || "",
        sample: q.sample || "",
        answer: answer,
        level: LVL,
        levelName: LVLNAME
      };
      var fell = false;
      var timer = setTimeout(function(){ if(!fell){ fell=true; done(localGrade(q, answer)); } }, 15000);
      fetch("/api/grade", {
        method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(payload)
      }).then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(j){
          if(fell) return; fell=true; clearTimeout(timer);
          if(j && j.verdict){ done(j); } else { done(localGrade(q, answer)); }
        })
        .catch(function(){ if(fell) return; fell=true; clearTimeout(timer); done(localGrade(q, answer)); });
    }

    // Offline / no-key fallback: keyword match if the question provides accept[].
    function localGrade(q, answer){
      var val = norm(answer);
      if(q.accept && q.accept.length){
        var hits=0; for(var a=0;a<q.accept.length;a++){ if(val.indexOf(norm(q.accept[a]))!==-1) hits++; }
        var frac = hits/q.accept.length;
        if(frac>=0.75) return { verdict:"correct", score:1, feedback:"Good — your answer covers the key ideas. (Graded offline; the AI grader wasn't reachable.)" };
        if(frac>0)     return { verdict:"partial", score:0.5, feedback:"You're on the right track but missed some key points. (Graded offline.)" };
        return { verdict:"incorrect", score:0, feedback:"That misses the main idea — check the strong answer below. (Graded offline.)" };
      }
      return { verdict:"partial", score:0.6, feedback:"Answer recorded. The AI grader wasn't reachable, so this wasn't fully scored — use ✦ Ask Bernard to check your thinking." };
    }

    function results(){
      var total=totalScore(); var pct=Math.round(total/Q.length*100);
      var verdict = pct>=90?"Outstanding — that's "+esc(LVLNAME)+"-level command of the material." : pct>=70?"Solid grasp at the "+esc(LVLNAME)+" level." : pct>=50?"A reasonable start — worth another pass." : "Worth revisiting the deck, then trying again.";
      mount.innerHTML = "<div class='quiz-result'><div class='quiz-result-score'>"+(Math.round(total*10)/10)+" / "+Q.length+"</div><div class='quiz-result-pct'>"+pct+"%</div><p class='quiz-result-verdict'>"+verdict+"</p><p class='quiz-result-lvl'>Graded at: <b>Lv"+LVL+" · "+esc(LVLNAME)+"</b>. Change it with the ◎ Level button, then retake to raise the bar.</p><button class='quiz-next' id='quizRetry'>Retake the quiz ↺</button></div>";
      mount.querySelector("#quizRetry").addEventListener("click", function(){ i=0; scoreMap={}; renderQ(); });
    }

    renderQ();
  }

  /* ---------- INTERACTIVE GLOSSARY (hover desktop / tap mobile) ---------- */
  function bindGlossary(){
    var G = window.GLOSSARY;
    if(!G) return;
    // longest terms first so multi-word terms win over their sub-words
    var terms = Object.keys(G).sort(function(a,b){ return b.length - a.length; });

    // one shared tooltip element
    var tip = document.getElementById("glosstip");
    if(!tip){
      tip = document.createElement("div");
      tip.id = "glosstip"; tip.className = "glosstip";
      document.body.appendChild(tip);
    }

    Array.prototype.forEach.call(document.querySelectorAll(".slide"), function(slide){
      if(slide.getAttribute("data-gloss")==="1") return;
      slide.setAttribute("data-gloss","1");
      var used = {}; // first occurrence per slide only
      // only wrap inside readable prose: p (not kicker/ref/src), h3 card titles excluded; skip quiz, buttons, code
      var candidates = slide.querySelectorAll("p.lede, p.sub, .card p, .awhat, .col p, .callout p, .mini");
      Array.prototype.forEach.call(candidates, function(node){
        if(node.closest("[data-quiz]")) return;
        wrapInNode(node, terms, G, used);
      });
    });

    // ALSO scan the open deep-dive paper so glossary tooltips work there too.
    // openPaper replaces #paperInner's innerHTML on each open, so a freshly
    // opened paper has no .gloss yet; the guard avoids double-wrapping.
    var pin = document.getElementById("paperInner");
    if(pin && !pin.querySelector(".gloss")){
      var usedP = {}; // first occurrence per deep dive
      Array.prototype.forEach.call(pin.querySelectorAll("p, .mini"), function(node){
        if(node.closest("[data-quiz]")) return;
        wrapInNode(node, terms, G, usedP);
      });
    }

    // tooltip show/hide
    var _hideT = null;
    function place(el){
      var r = el.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(12, r.left), window.innerWidth - tip.offsetWidth - 12) + "px";
      var top = r.bottom + 8;
      if(top + tip.offsetHeight > window.innerHeight - 12) top = r.top - tip.offsetHeight - 8;
      tip.style.top = top + "px";
    }
    function show(el){
      var k = el.getAttribute("data-term");
      var g = G[k]; if(!g) return;
      if(_hideT){ clearTimeout(_hideT); _hideT=null; }
      var term = el.textContent;
      tip.innerHTML = "<div class='gt-term'>"+term+"</div><div class='gt-def'>"+g.d+"</div><div class='gt-rel'><span>Why it matters:</span> "+g.r+"</div>"
        + "<button class='gt-askai' onclick='askAboutTerm(\""+term.replace(/"/g,"&quot;").replace(/'/g,"\\'")+"\")'>\u2728 Ask Bernard about this</button>";
      tip.classList.add("show");
      tip.style.left="-9999px"; tip.style.top="0"; // measure first
      requestAnimationFrame(function(){ place(el); });
    }
    function hide(){ tip.classList.remove("show"); }
    function hideSoon(){ if(_hideT) clearTimeout(_hideT); _hideT = setTimeout(hide, 220); }
    // keep tooltip open while pointer is over it (so the Ask Bernard button is reachable)
    if(tip.getAttribute("data-hoverbound")!=="1"){
      tip.setAttribute("data-hoverbound","1");
      tip.addEventListener("mouseenter", function(){ if(_hideT){ clearTimeout(_hideT); _hideT=null; } });
      tip.addEventListener("mouseleave", hideSoon);
    }

    Array.prototype.forEach.call(document.querySelectorAll(".gloss"), function(el){
      if(el.getAttribute("data-glossbound")==="1") return;
      el.setAttribute("data-glossbound","1");
      el.addEventListener("mouseenter", function(){ show(el); });
      el.addEventListener("mouseleave", hideSoon);
      el.addEventListener("click", function(e){
        e.stopPropagation();
        if(tip.classList.contains("show") && tip.getAttribute("data-for")===el.getAttribute("data-uid")){ hide(); }
        else { tip.setAttribute("data-for", el.getAttribute("data-uid")||""); show(el); }
      });
    });
    document.addEventListener("click", function(e){ if(!e.target.closest(".gloss") && !e.target.closest("#glosstip")) hide(); }, {passive:true});
    window.addEventListener("scroll", hide, {passive:true});
  }

  var _glossUid = 0;
  function wrapInNode(node, terms, G, used){
    // walk text nodes only; build a regex of remaining (unused-in-slide) terms
    var avail = terms.filter(function(t){ return !used[t]; });
    if(!avail.length) return;
    var pattern = new RegExp("\\b(" + avail.map(escapeRe).join("|") + ")\\b", "i");
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    var textNodes = [];
    var tn; while((tn = walker.nextNode())){ textNodes.push(tn); }
    textNodes.forEach(function(t){
      if(t.parentNode && t.parentNode.classList && t.parentNode.classList.contains("gloss")) return;
      var m = pattern.exec(t.nodeValue);
      if(!m) return;
      var termKey = matchKey(G, m[1]);
      if(!termKey || used[termKey]) return;
      used[termKey] = true;
      var idx = m.index, len = m[1].length;
      var before = t.nodeValue.slice(0, idx);
      var hit = t.nodeValue.slice(idx, idx+len);
      var after = t.nodeValue.slice(idx+len);
      var span = document.createElement("span");
      span.className = "gloss";
      span.setAttribute("data-term", termKey);
      span.setAttribute("data-uid", "g"+(++_glossUid));
      span.textContent = hit;
      var frag = document.createDocumentFragment();
      if(before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(span);
      if(after) frag.appendChild(document.createTextNode(after));
      t.parentNode.replaceChild(frag, t);
    });
  }
  function matchKey(G, hit){
    var lc = hit.toLowerCase();
    for(var k in G){ if(k.toLowerCase()===lc) return k; }
    return null;
  }
  function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* ---------- NAVIGATION ---------- */
  function update(){
    var slides = document.querySelectorAll(".slide");
    slides.forEach(function(s, i){
      s.classList.remove("active","prev");
      if(i===idx) s.classList.add("active");
      else if(i<idx) s.classList.add("prev");
    });
    counter.textContent = (idx+1) + " / " + SLIDES.length;
    bar.style.width = ((idx)/(SLIDES.length-1)*100) + "%";
    trackParticipation("slide_view", { slide: idx });
    var s = SLIDES[idx];
    // toggle poll / words tool buttons by slide
    toggle("pollBtn", !!s.poll);
    toggle("wordsBtn", !!s.words);
    // Auto-present interactive content front-and-center to grab attention.
    if(s.poll){ var pi=idx; setTimeout(function(){ if(idx===pi && !anyModalOpen()) openPoll(); }, 320); }
    else if(s.words){ var wi=idx; setTimeout(function(){ if(idx===wi && !anyModalOpen()) openWords(); }, 320); }
    else {
      var qb = document.querySelector(".slide.active .quizbox");
      if(qb){ qb.classList.remove("pop"); void qb.offsetWidth; qb.classList.add("pop");
        setTimeout(function(){ try{ qb.scrollIntoView({behavior:"smooth", block:"center"}); }catch(e){} }, 120); }
    }
    updateScrollCue();
  }
  function updateScrollCue(){
    var cue = document.getElementById("scrollcue");
    if(!cue){ return; }
    var active = document.querySelector(".slide.active");
    if(!active){ cue.classList.remove("show"); return; }
    // show the cue if the active slide can scroll and isn't near the bottom
    var canScroll = active.scrollHeight - active.clientHeight > 12;
    var nearBottom = active.scrollTop + active.clientHeight >= active.scrollHeight - 24;
    if(canScroll && !nearBottom) cue.classList.add("show");
    else cue.classList.remove("show");
  }
  function toggle(id, on){ var e=document.getElementById(id); if(e) e.style.display = on ? "" : "none"; }
  function go(n){ if(window._hideTileHover) window._hideTileHover(); if(window._hideSelAsk) window._hideSelAsk(); idx = Math.max(0, Math.min(SLIDES.length-1, n)); update(); }
  function next(){ go(idx+1); } function prev(){ go(idx-1); }
  /* ---- nav scrubber hooks (added) ---- */
  window.go = go;
  window.slideCount = function(){ return SLIDES.length; };
  window.currentSlide = function(){ return idx; };
  window.slideMeta = function(i){ var s=SLIDES[i]||{}; return { num:s.num, eyebrow:s.eyebrow||"", id:s.id||"" }; };

  document.getElementById("next").addEventListener("click", next);
  document.getElementById("prev").addEventListener("click", prev);
  (function(){ var lb=document.getElementById("lightbox"); if(lb) lb.addEventListener("click", closeLightbox); })();
  document.addEventListener("keydown", function(e){
    if(document.getElementById("lightbox").classList.contains("open")){ if(e.key==="Escape") closeLightbox(); return; }
    if(document.getElementById("paper").classList.contains("open")){ if(e.key==="Escape") closePaper(); return; }
    if(anyModalOpen()){ if(e.key==="Escape") closeAllModals(); return; }
    if(e.key==="ArrowRight"||e.key===" "||e.key==="PageDown"){ next(); e.preventDefault(); }
    if(e.key==="ArrowLeft"||e.key==="PageUp"){ prev(); e.preventDefault(); }
  });
  // swipe
  var tx=0, ty=0;
  deck.addEventListener("touchstart", function(e){ tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
  deck.addEventListener("touchend", function(e){
    var dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
    if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)){ if(dx<0) next(); else prev(); }
  }, {passive:true});

  /* ---------- QR (client-side, from current URL) ---------- */
  function buildQR(){
    var c = document.getElementById("qr");
    if(!c || typeof QRious==="undefined") return;
    try{
      new QRious({ element:c, value: location.href, size:150, background:"#ffffff", foreground:"#111111", level:"M" });
    }catch(e){ /* QR optional */ }
  }

  /* ---------- DEEP DIVE (parchment) ---------- */
  var paper = document.getElementById("paper");
  var paperInner = document.getElementById("paperInner");
  function openPaper(id){
    var s = SLIDES.filter(function(x){ return x.id===id; })[0];
    if(!s || !s.paper) return;
    var slideNum = SLIDES.indexOf(s) + 1;
    paperInner.innerHTML =
      '<div class="paper-secnum">'+s.paper.secnum+'</div>'+
      '<h1>'+s.paper.h+'</h1>'+ s.paper.body +
      '<div class="paper-fb"><button class="deepbtn" onclick="openChat()">✦ Ask Bernard</button> <button class="deepbtn" onclick="openFeedback(true)">✎ Feedback on this deep dive</button></div>';
    paper.classList.add("open");
    paper.scrollTop = 0;
    bindGlossary();
    bindCitations();
  }
  window.openPaper = openPaper;
  window.closePaper = function(){ paper.classList.remove("open"); };

  /* ---------- SOURCE CITATIONS (bundled Student Reader) ---------- */
  var srcPaper = document.getElementById("srcpaper");
  var srcInner = document.getElementById("srcInner");
  function renderSource(){
    var P = window.SOURCE_PAPER; if(!P || srcInner.getAttribute("data-rendered")==="1") return;
    var h = '<div class="paper-secnum">Cited Source</div><h1>'+P.title+'</h1>';
    h += '<p class="src-meta">'+P.cite+'</p>';
    P.sections.forEach(function(s){
      h += '<section id="src-'+s.id+'" class="src-sec"><h3>'+(s.num?(s.num+". "):"")+s.title+'</h3>'+s.body+'</section>';
    });
    srcInner.innerHTML = h;
    srcInner.setAttribute("data-rendered","1");
  }
  window.openSource = function(sectionId){
    renderSource();
    srcPaper.classList.add("open");
    srcPaper.scrollTop = 0;
    if(sectionId){
      var target = document.getElementById("src-"+sectionId);
      if(target){ setTimeout(function(){ target.scrollIntoView({behavior:"smooth", block:"start"}); target.classList.add("src-hl"); setTimeout(function(){ target.classList.remove("src-hl"); }, 1600); }, 120); }
    }
  };
  window.closeSource = function(){ srcPaper.classList.remove("open"); };

  function bindCitations(){
    Array.prototype.forEach.call(document.querySelectorAll(".cite"), function(el){
      if(el.getAttribute("data-cbound")==="1") return;
      el.setAttribute("data-cbound","1");
      el.addEventListener("click", function(e){ e.stopPropagation(); openSource(el.getAttribute("data-src")); });
    });
  }

  window.openSourceSuggestion = function(){
    openFeedback(false);
    _fbContext = "source suggestion";
    var label = document.getElementById("fbSlideLabel");
    var ta = document.getElementById("fbText");
    if(label) label.textContent = "Suggest another source for the knowledge base";
    if(ta){
      ta.placeholder = "Paste a URL, citation, author, title, transcript link, or note about why this source should be added...";
      ta.focus();
    }
  };

  /* ---------- INTERACTIVE TILE DETAIL ---------- */
  window.openTile = function(el){
    var title = el.getAttribute("data-title") || el.getAttribute("data-head") || "";
    var law = el.getAttribute("data-law") || "";
    var more = el.getAttribute("data-more") || el.getAttribute("data-detail") || "";
    var dd = el.getAttribute("data-dd") || "";
    var src = el.getAttribute("data-src") || "";
    document.getElementById("tileLaw").textContent = law;
    document.getElementById("tileLaw").style.display = law ? "" : "none";
    document.getElementById("tileTitle").innerHTML = title;
    document.getElementById("tileBody").innerHTML = more;
    var links = "";
    if(dd) links += '<button class="tilelink" onclick="closeModal(\'tile\');openPaper(\''+dd+'\')">Read more in the deep dive →</button>';
    if(src) links += '<button class="tilelink alt" onclick="openSource(\''+src+'\')">View cited source [src]</button>';
    document.getElementById("tileLinks").innerHTML = links;
    closeAllModals();
    document.getElementById("tileModal").classList.add("open");
  };
  function bindTiles(){
    var isTouch = window.matchMedia && window.matchMedia("(hover:none)").matches;
    // transient hover panel (separate from the click-modal so it can vanish on mouse-out)
    var hp = document.getElementById("tileHover");
    if(!hp){
      hp = document.createElement("div");
      hp.id = "tileHover";
      hp.className = "tile-hover";
      document.body.appendChild(hp);
      // keep it open while the pointer is over the panel itself, close when it leaves
      hp.addEventListener("mouseenter", function(){ if(hp._t){ clearTimeout(hp._t); hp._t=null; } });
      hp.addEventListener("mouseleave", hideHover);
    }
    function hideHover(){ if(hp._t){ clearTimeout(hp._t); hp._t=null; } hp.classList.remove("show"); }
    function placeHover(el){
      var r = el.getBoundingClientRect();
      hp.style.left = "-9999px"; hp.style.top = "0px"; hp.classList.add("show");
      requestAnimationFrame(function(){
        var w = hp.offsetWidth, h = hp.offsetHeight;
        var left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
        var top = r.bottom + 8;
        if(top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
        hp.style.left = left + "px"; hp.style.top = top + "px";
      });
    }
    function showHover(el){
      var title = el.getAttribute("data-title") || el.getAttribute("data-head") || "";
      var law = el.getAttribute("data-law") || "";
      var more = el.getAttribute("data-more") || el.getAttribute("data-detail") || "";
      var dd = el.getAttribute("data-dd") || "";
      var src = el.getAttribute("data-src") || "";
      var h = "";
      if(law) h += "<div class='th-law'>"+law+"</div>";
      h += "<div class='th-title'>"+title+"</div><div class='th-body'>"+more+"</div>";
      if(dd || src) h += "<div class='th-hint'>Click for the full detail"+(dd?" + deep dive":"")+"</div>";
      hp.innerHTML = h;
      placeHover(el);
    }
    window._hideTileHover = hideHover;

    Array.prototype.forEach.call(document.querySelectorAll("[data-more], .svghot"), function(el){
      if(el.getAttribute("data-tbound")==="1") return;
      el.setAttribute("data-tbound","1");
      if(!el.classList.contains("svghot")) el.classList.add("tile-interactive");
      // CLICK = open the full modal (deliberate, stays until closed)
      el.addEventListener("click", function(e){
        if(e.target.closest(".cite")) return;
        hideHover();
        openTile(el);
      });
      // HOVER = transient floating panel that disappears when the pointer leaves
      if(!isTouch){
        el.addEventListener("mouseenter", function(){
          if(document.getElementById("tileModal").classList.contains("open")) return; // modal wins
          if(hp._t){ clearTimeout(hp._t); }
          hp._t = setTimeout(function(){ showHover(el); }, 350);
        });
        el.addEventListener("mouseleave", function(){
          if(hp._t){ clearTimeout(hp._t); hp._t=null; }
          // small grace period so moving onto the panel doesn't dismiss it
          hp._t = setTimeout(hideHover, 180);
        });
      }
    });
  }

  /* ---------- MODAL PLUMBING ---------- */
  function anyModalOpen(){ return !!document.querySelector(".modal.open"); }
  function closeAllModals(){ Array.prototype.forEach.call(document.querySelectorAll(".modal.open"), function(m){ m.classList.remove("open"); }); }
  window.closeModal = function(which){ stopDictation(); document.getElementById(which+"Modal").classList.remove("open"); };

  /* ---------- FEEDBACK (voice-to-text with type fallback) ---------- */
  var _recog = null, _recognizing = false, _baseText = "";
  var _fbContext = "slide";
  window.openFeedback = function(isDeepDive){
    _fbContext = isDeepDive === true ? "deep dive" : "slide";
    var s = SLIDES[idx] || {};
    var label = document.getElementById("fbSlideLabel");
    var ctxLabel = _fbContext === "deep dive" ? ", deep dive" : "";
    if(label) label.textContent = "Slide " + (idx+1) + " of " + SLIDES.length + ctxLabel + (s.eyebrow ? " — " + s.eyebrow : "");
    var muted = document.getElementById("fbMuted"); if(muted) muted.textContent = "";
    var ta = document.getElementById("fbText");
    if(ta){ ta.value = ""; ta.placeholder = "Speak or type your feedback here…"; }
    // mic availability
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = document.getElementById("fbMic");
    var st = document.getElementById("fbMicState");
    if(!SR){
      if(mic) mic.style.display = "none";
      if(st) st.textContent = "Voice input isn't supported in this browser — please type your feedback.";
    } else {
      if(mic){ mic.style.display = ""; mic.textContent = "🎤 Start voice"; }
      if(st) st.textContent = "Speak clearly in a quiet spot for best results — you can edit the text before sending.";
    }
    document.getElementById("feedbackModal").classList.add("open");
  };
  window.closeFeedback = function(){
    stopDictation();
    document.getElementById("feedbackModal").classList.remove("open");
  };

  function stopDictation(){
    if(_recog && _recognizing){ try{ _recog.stop(); }catch(e){} }
    _recognizing = false;
    if(_micEl) _micEl.textContent = _micLabel;
  }
  var _micEl=null, _stEl=null, _taEl=null, _micLabel="🎤 Start voice";
  // Generic dictation: pass the ids of the target field, mic button, and (optional) status element.
  function startDictation(taId, micId, stId, micLabel){
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return;
    _micEl = document.getElementById(micId);
    _stEl  = stId ? document.getElementById(stId) : null;
    _taEl  = document.getElementById(taId);
    _micLabel = micLabel || "🎤 Start voice";
    if(_recognizing){ stopDictation(); if(_stEl) _stEl.textContent="Stopped — you can edit the text or send."; return; }
    var mic=_micEl, st=_stEl, ta=_taEl;

    _recog = new SR();
    _recog.lang = "en-US";
    _recog.interimResults = true;
    _recog.continuous = true;
    _baseText = ta && ta.value ? ta.value.trim() + " " : "";
    _recog.onstart = function(){ _recognizing = true; if(mic) mic.textContent = "■ Stop voice"; if(st) st.textContent = "Listening… speak now."; };
    _recog.onerror = function(e){
      _recognizing = false; if(mic) mic.textContent = _micLabel;
      if(st) st.textContent = (e && e.error === "not-allowed") ? "Microphone blocked — allow mic access, or just type." : "Voice error — please type instead.";
    };
    _recog.onend = function(){ _recognizing = false; if(mic) mic.textContent = _micLabel; };
    _recog.onresult = function(ev){
      var finalT = "", interimT = "";
      for(var k=ev.resultIndex; k<ev.results.length; k++){
        var tr = ev.results[k];
        if(tr.isFinal) finalT += tr[0].transcript;
        else interimT += tr[0].transcript;
      }
      if(finalT) _baseText += finalT + " ";
      if(ta) ta.value = (_baseText + interimT).replace(/\s+/g, " ").trimStart();
    };
    try { _recog.start(); } catch(e){ if(st) st.textContent = "Couldn't start voice — please type."; }
  }
  // Feedback modal mic
  window.toggleDictation = function(){ startDictation("fbText","fbMic","fbMicState","🎤 Start voice"); };
  // Ask Bernard chat mic
  window.toggleChatDictation = function(){ startDictation("chatIn","chatMic","chatMicState","🎤"); };

  window.submitFeedback = function(){
    var ta = document.getElementById("fbText");
    var muted = document.getElementById("fbMuted");
    var send = document.getElementById("fbSend");
    var text = (ta.value || "").trim();
    if(!text){ if(muted) muted.textContent = "Please say or type something first."; return; }
    stopDictation();
    var s = SLIDES[idx] || {};
    if(send){ send.disabled = true; send.textContent = "Sending…"; }
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_title: window.CLASS_TITLE || "{{CLASS_TITLE}}", class_slug: CLASS_SLUG, slide: s.id || "", slideNum: String(idx+1), context: _fbContext, text: text })
    }).then(function(r){ return r.json(); }).then(function(j){
      if(j && j.ok){
        trackParticipation("feedback");
        if(muted) muted.textContent = "Thank you — your feedback was recorded.";
        ta.value = "";
        setTimeout(window.closeFeedback, 900);
      } else {
        if(muted) muted.textContent = "Couldn't save (the feedback service may be offline). Try again.";
      }
    }).catch(function(){
      if(muted) muted.textContent = "Network error — feedback not sent. Try again.";
    }).finally(function(){
      if(send){ send.disabled = false; send.textContent = "Send feedback"; }
    });
  };

  Array.prototype.forEach.call(document.querySelectorAll("[data-modal]"), function(btn){
    btn.addEventListener("click", function(){
      var which = btn.getAttribute("data-modal");
      if(which==="poll") openPoll();
      else if(which==="words") openWords();
      else if(which==="chat") openChat();
      else if(which==="quality") openQuality();
    });
  });

  /* ---------- POLL ---------- */
  var votedKey = function(qid){ return "voted:"+qid; };
  function openPoll(){
    var s = SLIDES[idx]; if(!s.poll) return;
    var def = POLLS[s.poll]; if(!def) return;
    document.getElementById("pollQ").innerHTML = def.q;
    document.getElementById("pollDesc").innerHTML = def.desc;
    var wrap = document.getElementById("pollOpts"); wrap.innerHTML="";
    var already = !!getLS(votedKey(s.poll));
    def.opts.forEach(function(label, i){
      var b = document.createElement("button");
      b.className = "opt";
      b.innerHTML = '<span class="fill"></span><span class="lbl">'+label+'</span><span class="pct"></span>';
      b.addEventListener("click", function(){ if(!getLS(votedKey(s.poll))) castVote(s.poll, i, def.opts.length); });
      wrap.appendChild(b);
    });
    document.getElementById("pollMuted").textContent = already ? "You've voted — showing live results." : "Tap an option to vote.";
    document.getElementById("pollModal").classList.add("open");
    fetchPoll(s.poll, def.opts.length);
  }
  function castVote(qid, opt, n){
    setLS(votedKey(qid), String(opt));
    trackParticipation("poll_vote", { qid: qid });
    // optimistic local bump
    var local = getLocalCounts(qid, n); local[opt]++; setLocalCounts(qid, local); paintPoll(local);
    api("/api/poll?qid="+encodeURIComponent(qid)+"&opt="+opt+"&n="+n, "POST")
      .then(function(j){ if(j && j.counts) paintPoll(j.counts); })
      .catch(function(){ document.getElementById("pollMuted").textContent="Offline — showing this device's tally."; });
  }
  function fetchPoll(qid, n){
    api("/api/poll?qid="+encodeURIComponent(qid)+"&n="+n, "GET")
      .then(function(j){ if(j && j.counts) paintPoll(j.counts); else paintPoll(getLocalCounts(qid,n)); })
      .catch(function(){ paintPoll(getLocalCounts(qid,n)); document.getElementById("pollMuted").textContent="Offline — showing this device's tally."; });
  }
  function paintPoll(counts){
    var total = counts.reduce(function(a,b){return a+b;},0) || 1;
    var opts = document.querySelectorAll("#pollOpts .opt");
    opts.forEach(function(o,i){
      var pct = Math.round((counts[i]||0)/total*100);
      o.querySelector(".pct").textContent = pct+"%";
      o.querySelector(".fill").style.width = pct+"%";
    });
  }

  /* ---------- WORD CLOUD ---------- */
  function openWords(){
    var s = SLIDES[idx]; if(!s.words) return;
    var def = WORDS[s.words]; if(!def) return;
    document.getElementById("wordsQ").textContent = def.q;
    document.getElementById("wordsDesc").textContent = def.desc;
    document.getElementById("wordIn").value="";
    document.getElementById("wordsMuted").textContent="";
    document.getElementById("wordsModal").classList.add("open");
    fetchWords(s.words);
  }
  window.submitWord = function(){
    var s = SLIDES[idx]; if(!s.words) return;
    var v = (document.getElementById("wordIn").value||"").trim().toLowerCase().replace(/[^a-z0-9\- ]/g,"").slice(0,24);
    if(!v) return;
    document.getElementById("wordIn").value="";
    trackParticipation("word_entry", { qid: s.words });
    var local = getLocalWords(s.words); local[v]=(local[v]||0)+1; setLocalWords(s.words, local); paintCloud(local);
    api("/api/words?qid="+encodeURIComponent(s.words)+"&w="+encodeURIComponent(v), "POST")
      .then(function(j){ if(j && j.words) paintCloud(j.words); })
      .catch(function(){ document.getElementById("wordsMuted").textContent="Offline — showing this device's words."; });
  };
  function fetchWords(qid){
    api("/api/words?qid="+encodeURIComponent(qid), "GET")
      .then(function(j){ if(j && j.words) paintCloud(j.words); else paintCloud(getLocalWords(qid)); })
      .catch(function(){ paintCloud(getLocalWords(qid)); document.getElementById("wordsMuted").textContent="Offline — showing this device's words."; });
  }
  function paintCloud(words){
    var cloud = document.getElementById("cloud"); cloud.innerHTML="";
    var entries = Object.keys(words).map(function(k){ return [k, words[k]]; }).sort(function(a,b){ return b[1]-a[1]; }).slice(0,40);
    if(!entries.length){ cloud.innerHTML='<span style="font-size:14px;color:var(--faint);font-family:var(--mono)">No words yet — be the first.</span>'; return; }
    var max = entries[0][1];
    entries.forEach(function(e){
      var size = 14 + Math.round((e[1]/max)*30);
      var sp = document.createElement("span");
      sp.style.fontSize = size+"px";
      sp.style.opacity = (0.55 + 0.45*(e[1]/max)).toFixed(2);
      sp.textContent = e[0];
      cloud.appendChild(sp);
    });
  }

  /* ---------- BERNARD AI TUTOR ---------- */
  var history = [];
  function openChat(prefill){
    document.getElementById("chatModal").classList.add("open");
    document.getElementById("chatMuted").textContent="";
    if(!history.length){
      addMsg("a", "Hello, I'm Bernard. Ask me anything about {{TOPIC}} — {{TOPIC_GREETING}}.");
    }
    var inp = document.getElementById("chatIn");
    if(prefill){ inp.value = prefill; }
    setTimeout(function(){ inp.focus(); }, 100);
  }
  window.openChat = openChat;

  /* ---------- SELECT-ANY-TEXT -> ASK BERNARD ---------- */
  (function(){
    var menu = document.getElementById("selAsk");
    if(!menu) return;
    var selText = document.getElementById("selAskText");
    var current = "";
    var longTimer = null;

    function within(node){
      // only offer for readable prose inside slides or the deep-dive/source papers
      if(!node) return false;
      var el = node.nodeType===3 ? node.parentElement : node;
      if(!el) return false;
      if(el.closest("#selAsk")) return false;
      if(el.closest("input, textarea, button, .quizbox, [data-quiz], #chatModal, #tools, #nav")) return false;
      return !!el.closest(".slide, #paper, #srcpaper");
    }
    function showMenu(text, x, y){
      current = text.trim();
      if(current.length < 2 || current.length > 200) return;
      selText.textContent = current.length > 48 ? current.slice(0,48)+"…" : current;
      menu.style.left = "-9999px"; menu.style.top = "0px"; menu.classList.add("show");
      requestAnimationFrame(function(){
        var w = menu.offsetWidth, h = menu.offsetHeight;
        var left = Math.min(Math.max(10, x - w/2), window.innerWidth - w - 10);
        var top = y + 12;
        if(top + h > window.innerHeight - 10) top = y - h - 12;
        menu.style.left = left + "px"; menu.style.top = Math.max(10, top) + "px";
      });
    }
    function hideMenu(){ menu.classList.remove("show"); }
    window._hideSelAsk = hideMenu;

    function handleSelection(){
      var sel = window.getSelection && window.getSelection();
      if(!sel || sel.isCollapsed || !sel.rangeCount){ hideMenu(); return; }
      var text = sel.toString();
      if(!text || !text.trim()){ hideMenu(); return; }
      var anchor = sel.anchorNode;
      if(!within(anchor)){ hideMenu(); return; }
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      showMenu(text, rect.left + rect.width/2, rect.bottom);
    }

    // desktop: after a mouse-up selection
    document.addEventListener("mouseup", function(){ setTimeout(handleSelection, 10); });
    // touch: long-press creates a native selection; also offer on selectionchange settling
    document.addEventListener("touchend", function(){ setTimeout(handleSelection, 250); }, {passive:true});

    // dismiss when clicking elsewhere or scrolling or navigating
    document.addEventListener("mousedown", function(e){ if(!e.target.closest("#selAsk")) hideMenu(); });
    window.addEventListener("scroll", hideMenu, {passive:true});

    Array.prototype.forEach.call(menu.querySelectorAll(".sel-opt"), function(btn){
      btn.addEventListener("click", function(e){
        e.stopPropagation();
        var kind = btn.getAttribute("data-kind");
        var phrase = current;
        hideMenu();
        var sel = window.getSelection && window.getSelection(); if(sel) sel.removeAllRanges();
        var prompts = {
          definition: "I'm in a class on {{TOPIC}}. Define \u201c"+phrase+"\u201d in plain language.",
          context:    "In the context of this class on {{TOPIC}}, what does \u201c"+phrase+"\u201d mean here and how is it being used?",
          relevance:  "Why does \u201c"+phrase+"\u201d matter in {{TOPIC}}? Explain its relevance to this class.",
          general:    "I have a question about \u201c"+phrase+"\u201d from this class on {{TOPIC}}: "
        };
        openChat(prompts[kind] || prompts.general);
      });
    });
  })();
  window.askAboutTerm = function(term){
    if(window._hideTileHover) window._hideTileHover();
    var tip = document.getElementById("glosstip"); if(tip) tip.classList.remove("show");
    openChat("In the context of this class on {{TOPIC}}, explain \u201c" + term + "\u201d and why it matters.");
  };
  document.getElementById("chatIn").addEventListener("keydown", function(e){ if(e.key==="Enter") sendChat(); });
  window.sendChat = function(){
    var inp = document.getElementById("chatIn");
    var q = (inp.value||"").trim(); if(!q) return;
    stopDictation();
    inp.value="";
    addMsg("u", q);
    trackParticipation("chat_question");
    history.push({role:"user", content:q});
    var thinking = addMsg("a", "…");
    api("/api/chat", "POST", { message:q, slide: SLIDES[idx].id, slideTitle: (SLIDES[idx].eyebrow||""), history: history.slice(-8) })
      .then(function(j){
        if(j && j.reply){ thinking.textContent = j.reply; history.push({role:"assistant", content:j.reply}); }
        else { thinking.textContent = "Bernard's backend returned an error. It needs OPENAI_API_KEY set on the server."; }
      })
      .catch(function(){ thinking.textContent = "Can't reach Bernard — he only works once the site is deployed with an API key. The rest of the class runs offline."; });
  };
  function addMsg(role, text){
    var log = document.getElementById("chatlog");
    var d = document.createElement("div"); d.className="msg "+role; d.textContent=text;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }

  /* ---------- API + LOCAL STORAGE HELPERS ---------- */
  function api(path, method, body){
    var opt = { method:method, headers:{} };
    if(body){ opt.headers["Content-Type"]="application/json"; opt.body=JSON.stringify(body); }
    return fetch(path, opt).then(function(r){
      if(!r.ok) throw new Error("http "+r.status);
      return r.json();
    });
  }
  // localStorage is unavailable in some embedded contexts; wrap defensively.
  function getLS(k){ try{ return window.localStorage.getItem(k); }catch(e){ return MEM[k]||null; } }
  function setLS(k,v){ try{ window.localStorage.setItem(k,v); }catch(e){ MEM[k]=v; } }
  var MEM = {};
  function getLocalCounts(qid,n){ var raw=getLS("pc:"+qid); var a; try{a=JSON.parse(raw);}catch(e){} if(!a||a.length!==n){ a=[]; for(var i=0;i<n;i++)a.push(0);} return a; }
  function setLocalCounts(qid,a){ setLS("pc:"+qid, JSON.stringify(a)); }
  function getLocalWords(qid){ var raw=getLS("wc:"+qid); var o; try{o=JSON.parse(raw);}catch(e){} return o||{}; }
  function setLocalWords(qid,o){ setLS("wc:"+qid, JSON.stringify(o)); }

  /* ---------- QUALITY + PARTICIPATION REPORT ---------- */
  var QUALITY_KEY = "quality:" + CLASS_SLUG;
  function defaultParticipation(){
    return {
      slide_views: {},
      poll_votes: 0,
      word_entries: 0,
      quiz_attempts: 0,
      quiz_score_total: 0,
      chat_questions: 0,
      feedback_sent: 0,
      started_at: Date.now(),
      updated_at: Date.now()
    };
  }
  function loadParticipation(){
    var raw = getLS(QUALITY_KEY);
    try { return Object.assign(defaultParticipation(), JSON.parse(raw || "{}")); }
    catch(e){ return defaultParticipation(); }
  }
  var PARTICIPATION = loadParticipation();
  function saveParticipation(){
    PARTICIPATION.updated_at = Date.now();
    setLS(QUALITY_KEY, JSON.stringify(PARTICIPATION));
  }
  function trackParticipation(kind, data){
    data = data || {};
    if(kind === "slide_view") PARTICIPATION.slide_views[String(data.slide)] = (PARTICIPATION.slide_views[String(data.slide)] || 0) + 1;
    if(kind === "poll_vote") PARTICIPATION.poll_votes += 1;
    if(kind === "word_entry") PARTICIPATION.word_entries += 1;
    if(kind === "quiz_attempt"){ PARTICIPATION.quiz_attempts += 1; PARTICIPATION.quiz_score_total += Number(data.score) || 0; }
    if(kind === "chat_question") PARTICIPATION.chat_questions += 1;
    if(kind === "feedback") PARTICIPATION.feedback_sent += 1;
    saveParticipation();
  }
  function qualityPayload(){
    return {
      class_title: window.CLASS_TITLE || "{{CLASS_TITLE}}",
      class_slug: CLASS_SLUG,
      slide_count: SLIDES.length,
      quiz_count: document.querySelectorAll("[data-quiz]").length,
      poll_defs: POLLS,
      word_defs: WORDS,
      class_standard: window.CLASS_STANDARD || null,
      class_blueprint: window.CLASS_BLUEPRINT || null,
      evidence_map: window.EVIDENCE_MAP || [],
      bernard_config: window.BERNARD_CONFIG || null,
      local: PARTICIPATION
    };
  }
  function localQualityReport(){
    var viewed = Object.keys(PARTICIPATION.slide_views || {}).length;
    var interactions = PARTICIPATION.poll_votes + PARTICIPATION.word_entries + PARTICIPATION.quiz_attempts + PARTICIPATION.chat_questions + PARTICIPATION.feedback_sent;
    var score = Math.min(100, Math.round((viewed / Math.max(1, SLIDES.length)) * 45 + Math.min(1, interactions / 8) * 55));
    return {
      ok: true,
      quality: { score: score, status: score >= 75 ? "strong" : score >= 45 ? "developing" : "low" },
      participation: {
        slide_count: SLIDES.length,
        slides_viewed_on_this_device: viewed,
        poll_votes: PARTICIPATION.poll_votes,
        word_entries: PARTICIPATION.word_entries,
        quiz_attempts: PARTICIPATION.quiz_attempts,
        chat_questions: PARTICIPATION.chat_questions,
        feedback_items: PARTICIPATION.feedback_sent,
        total_interaction_signals: interactions,
        storage: "local"
      },
      recommendations: ["This is a local report. Deploy with KV storage for cross-device class participation totals."],
      ai: { available: false, message: "Quality AI runs after /api/quality is reachable on Vercel." }
    };
  }
  function renderQualityReport(report){
    var box = document.getElementById("qualityReport");
    if(!box) return;
    var p = report.participation || {};
    var integrity = report.class_integrity || {};
    var q = report.quality || {};
    var recs = (report.recommendations || []).map(function(item){ return "<li>"+escText(item)+"</li>"; }).join("");
    var ai = report.ai && report.ai.available && report.ai.report
      ? "<div class='quality-note'><b>Quality AI:</b> " + escText(report.ai.report.summary || "Reviewed.") + "</div>"
      : "<div class='quality-note muted'>" + escText((report.ai && report.ai.message) || "Quality AI summary unavailable; deterministic report shown.") + "</div>";
    box.innerHTML =
      "<div class='quality-score'><strong>" + escText(q.score || 0) + "</strong><span>/100<br>" + escText(q.status || "checked") + "</span></div>" +
      "<div class='quality-grid'>" +
        qualityMetric("Slides viewed", (p.slides_viewed_on_this_device || 0) + " / " + (p.slide_count || SLIDES.length)) +
        qualityMetric("Poll votes", p.poll_votes || 0) +
        qualityMetric("Word entries", p.word_entries || 0) +
        qualityMetric("Quiz attempts", p.quiz_attempts || 0) +
        qualityMetric("Bernard questions", p.chat_questions || 0) +
        qualityMetric("Feedback items", p.feedback_items || 0) +
        qualityMetric("Class tier", ((window.CLASS_STANDARD && window.CLASS_STANDARD.tier && window.CLASS_STANDARD.tier.label) || (window.DECK_META && window.DECK_META.class_tier) || "Not set")) +
        qualityMetric("Evidence rows", (window.EVIDENCE_MAP || []).length) +
        qualityMetric("Build integrity", (integrity.score || 0) + " / 100") +
      "</div>" +
      ai +
      (recs ? "<h4>Recommended next moves</h4><ul class='quality-list'>" + recs + "</ul>" : "");
  }
  function qualityMetric(label, value){
    return "<div class='quality-metric'><span>"+escText(label)+"</span><strong>"+escText(value)+"</strong></div>";
  }
  function escText(value){
    return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
  }
  function openQuality(){
    document.getElementById("qualityModal").classList.add("open");
    var box = document.getElementById("qualityReport");
    if(box) box.innerHTML = "<div class='muted'>Building the quality and participation report...</div>";
    api("/api/quality", "POST", qualityPayload())
      .then(renderQualityReport)
      .catch(function(){ renderQualityReport(localQualityReport()); });
  }
  window.openQuality = openQuality;

  /* ---------- LISTEN MODE: spoken narration + Bernard Q&A ----------
     Narrates each slide aloud and auto-advances like a podcast. A "raise hand"
     button pauses, listens for a spoken question, asks Bernard, and speaks
     the answer back. Natural voice via /api/tts (OpenAI); if that key isn't set
     the browser's built-in speech synthesis is used as a fallback. NOTE: mobile
     browsers suspend audio + mic when the screen locks or the tab backgrounds —
     keep the tab in front. True screen-off hands-free needs a native app. */
  (function(){
    var _audio=null, _apiState="unknown" /* unknown|ok|off */, _listening=false, _paused=false, _busy=false, _primed=false, _pausedOnInteractive=false;
    var _wakeRec=null, _wakeOn=false;
    var bar, statusEl, playBtn;

    function ensureBar(){
      bar = document.getElementById("listenBar");
      statusEl = document.getElementById("listenStatus");
      playBtn  = document.getElementById("lbPlay");
    }
    function setStatus(t){ if(statusEl) statusEl.textContent = t; }
    function showBar(){ ensureBar(); if(bar) bar.classList.add("on"); }
    function hideBar(){ if(bar) bar.classList.remove("on"); }
    function syncPlay(){ if(playBtn) playBtn.textContent = _paused ? "\u25B6" : "\u23F8"; }
    function stopWakeWord(){
      if(_wakeRec && _wakeOn){ try{ _wakeRec.stop(); }catch(e){} }
      _wakeOn=false;
      _wakeRec=null;
    }
    function startWakeWord(){
      if(_wakeOn || !_listening || !_paused || _busy) return;
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if(!SR) return;
      try{
        _wakeRec = new SR();
        _wakeRec.lang = "en-GB";
        _wakeRec.interimResults = false;
        _wakeRec.continuous = true;
        _wakeRec.onstart = function(){ _wakeOn=true; };
        _wakeRec.onerror = function(){ _wakeOn=false; };
        _wakeRec.onend = function(){ _wakeOn=false; if(_listening && _paused && !_busy) setTimeout(startWakeWord, 700); };
        _wakeRec.onresult = function(ev){
          for(var k=ev.resultIndex; k<ev.results.length; k++){
            var spoken = (ev.results[k][0] && ev.results[k][0].transcript || "").trim();
            if(!/\bbernard\b/i.test(spoken)) continue;
            var q = spoken.replace(/^.*?\bbernard\b[,\s]*/i, "").trim();
            stopWakeWord();
            if(q) answerQuestion(q);
            else window.listenAsk();
            break;
          }
        };
        _wakeRec.start();
      }catch(e){}
    }

    // Must run INSIDE a user gesture (called from the onclick handlers) so Chrome
    // lets audio + speech start later from async callbacks.
    function primeVoice(){
      try{
        if(window.speechSynthesis){
          window.speechSynthesis.resume();
          if(!_primed){
            var w=new SpeechSynthesisUtterance(" "); w.volume=0;
            window.speechSynthesis.speak(w);
            _primed=true;
          }
        }
      }catch(e){}
    }

    // ---- speech output ----
    function stopSpeaking(){
      stopWakeWord();
      if(_audio){ try{ _audio.pause(); }catch(e){} _audio=null; }
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
    }
    function britishVoice(){
      var ss = window.speechSynthesis;
      if(!ss || !ss.getVoices) return null;
      var voices = ss.getVoices() || [];
      return voices.filter(function(v){ return /^en[-_]GB/i.test(v.lang || ""); })[0] ||
        voices.filter(function(v){ return /(Daniel|Oliver|Arthur|Serena|Kate|Martha|Fiona|Moira|Tessa)/i.test(v.name || ""); })[0] ||
        null;
    }
    // Chrome cuts off long utterances (~15s) and dislikes async starts, so we
    // split into sentences and speak them one at a time, resuming as we go.
    function speakBrowser(text, onend){
      var ss = window.speechSynthesis;
      if(!ss){ setStatus("This browser can't do speech. Try Chrome on a computer."); if(onend) onend(); return; }
      var chunks = (text.match(/[^.!?\n]+[.!?]*/g) || [text]).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!chunks.length){ if(onend) onend(); return; }
      var ci=0, done=false;
      function finish(){ if(done) return; done=true; if(onend) onend(); }
      function speakChunk(){
        if(done) return;
        if(ci>=chunks.length){ finish(); return; }
        var u=new SpeechSynthesisUtterance(chunks[ci]); u.rate=1; u.pitch=1; u.volume=1; u.lang="en-GB";
        var voice = britishVoice(); if(voice) u.voice = voice;
        u.onend=function(){ ci++; speakChunk(); };
        u.onerror=function(){ ci++; speakChunk(); };
        try{ ss.resume(); ss.speak(u); }
        catch(e){ finish(); }
      }
      try{ ss.cancel(); }catch(e){}
      speakChunk();
    }
    function speak(text, onend){
      stopSpeaking();
      if(!text){ if(onend) onend(); return; }
      if(_apiState==="off"){ speakBrowser(text, onend); return; }   // already know natural voice is unavailable
      fetch("/api/tts", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ text: text.slice(0,3800), voice:"fable" }) })
        .then(function(r){ if(!r.ok) return Promise.reject("http "+r.status); return r.blob(); })
        .then(function(blob){
          if(!blob || blob.size < 200) return Promise.reject("empty audio");
          _apiState="ok";
          var url=URL.createObjectURL(blob);
          _audio=new Audio(url);
          _audio.onended=function(){ URL.revokeObjectURL(url); if(onend) onend(); };
          _audio.onerror=function(){ URL.revokeObjectURL(url); _apiState="off"; speakBrowser(text,onend); };
          _audio.play().catch(function(){ _apiState="off"; speakBrowser(text,onend); }); // gesture issue → browser voice
        })
        .catch(function(why){
          if(_apiState!=="ok"){ _apiState="off"; setStatus("Natural voice unavailable (" + why + ") — using your browser's voice."); }
          speakBrowser(text, onend);
        });
    }

    // ---- build narration text from the active slide ----
    function slideText(){
      var sec = document.querySelector(".slide.active");
      if(!sec) return "";
      var clone = sec.cloneNode(true);
      var strip = clone.querySelectorAll(".quizbox,[data-quiz],button,.deepbtn,.cite,sup,.num,.bar,.qrwrap,.qrbox,.scan,.scrubber,#tools");
      Array.prototype.forEach.call(strip, function(n){ n.remove(); });
      var parts=[];
      var nodes = clone.querySelectorAll(".eyebrow,.head,.lede,.sub,.kicker,p,.k,.throughline,li");
      Array.prototype.forEach.call(nodes, function(n){
        var t=(n.textContent||"").replace(/\u2192|\u2190|\u21D2/g," ").replace(/\s+/g," ").trim();
        if(!t) return;
        if(/\b(tap|click|swipe|type a single word|vote|results update live)\b/i.test(t) && t.length<70) return;
        parts.push(t);
      });
      var out=[], last="";
      parts.forEach(function(p){ if(p!==last) out.push(p); last=p; });
      return out.join(". ").replace(/\.\.+/g,".").slice(0,3800);
    }

    // ---- narration loop ----
    // ---- detect & describe interactive content on the current slide ----
    function htmlToText(h){ var d=document.createElement("div"); d.innerHTML=h||""; return (d.textContent||"").replace(/\s+/g," ").trim(); }
    function headLede(){
      var sec=document.querySelector(".slide.active"); if(!sec) return "";
      var parts=[];
      var h=sec.querySelector(".head"); if(h) parts.push((h.textContent||"").replace(/\s+/g," ").trim());
      var l=sec.querySelector(".lede"); if(l) parts.push((l.textContent||"").replace(/\s+/g," ").trim());
      return parts.join(". ");
    }
    function currentInteractive(){
      var s = SLIDES[window.currentSlide()] || {};
      if(s.poll && POLLS[s.poll]) return { type:"poll", def:POLLS[s.poll] };
      if(s.words && WORDS[s.words]) return { type:"words", def:WORDS[s.words] };
      var mount = document.querySelector(".slide.active [data-quiz]");
      if(mount){
        var Q=null; try{ Q=JSON.parse(mount.getAttribute("data-quiz")); }catch(e){}
        if(Q && Q.length){
          var L = (typeof compLevel==="function") ? compLevel() : 2;
          var gated = Q.filter(function(q){ return (q.level||1) <= L; });
          if(!gated.length) gated=[Q[0]];
          return { type:"quiz", first:gated[0], isTest: mount.getAttribute("data-pop")!=="1", count:gated.length };
        }
      }
      return null;
    }
    function interactiveScript(inter){
      var head = headLede();
      if(inter.type==="poll"){
        return head + ". Time to vote. " + htmlToText(inter.def.q) + " Your choices are: "
             + inter.def.opts.map(htmlToText).join("; ") + ". Tap your choice on the screen, then tap play to continue.";
      }
      if(inter.type==="words"){
        return head + ". Quick word cloud. " + htmlToText(inter.def.q) + " Type one word on the screen, then tap play to continue.";
      }
      // quiz / test
      var q=inter.first, qline=htmlToText(q.q);
      if(q.type==="mc" && q.options){ qline += " Your options are: " + q.options.map(htmlToText).join("; ") + "."; }
      else if(q.type==="tf"){ qline += " True or false?"; }
      return head + ". " + (inter.isTest ? "This is the final test, with " + inter.count + " questions at your level. "
                                          : "Knowledge check. ")
           + "Here is your first question. " + qline + " Answer on the screen. Tap the microphone if you'd like help, then tap play to continue.";
    }

    function narrateCurrent(){
      if(!_listening || _paused || _busy) return;
      var i = window.currentSlide();
      var inter = currentInteractive();
      if(inter){
        setStatus((_apiState==="ok"?"\uD83D\uDD0A ":"") + (inter.type==="quiz"?(inter.isTest?"Reading the final test…":"Reading the quiz…"):inter.type==="poll"?"Reading the poll…":"Reading the word cloud…"));
        speak(interactiveScript(inter), function(){
          if(!_listening) return;
          _paused=true; _pausedOnInteractive=true; syncPlay();
          setStatus("Your turn — respond on the screen, tap \u25B6 to continue, or say \u201CBernard\u201D for help.");
          startWakeWord();
        });
        return;
      }
      var txt = slideText();
      setStatus((_apiState==="ok"?"\uD83D\uDD0A ":"") + "Narrating slide " + (i+1) + " of " + SLIDES.length + "…");
      if(!txt){
        if(i < SLIDES.length-1){ window.go(i+1); setTimeout(narrateCurrent, 500); } else { _paused=true; syncPlay(); }
        return;
      }
      speak(txt, function(){
        if(!_listening || _paused) return;
        var cur = window.currentSlide();
        if(cur < SLIDES.length-1){ window.go(cur+1); setTimeout(narrateCurrent, 350); }
        else { setStatus("End of the class. Tap \u25B6 to replay, say \u201CBernard\u201D for help, or \u23F9 to close."); _paused=true; syncPlay(); startWakeWord(); }
      });
    }
    // Resume: if we paused on an interactive slide (waiting for the student), advance past it.
    function resumeNarration(){
      _paused=false; syncPlay();
      if(_pausedOnInteractive){
        _pausedOnInteractive=false;
        var cur=window.currentSlide();
        if(cur < SLIDES.length-1){ window.go(cur+1); }
      }
      stopWakeWord();
      narrateCurrent();
    }

    window.openListen = function(){
      ensureBar(); primeVoice(); showBar();
      if(!_listening){ _listening=true; _paused=false; _pausedOnInteractive=false; syncPlay(); setStatus("Starting narration…"); narrateCurrent(); }
    };
    window.listenPlayPause = function(){
      primeVoice();
      if(!_listening){ window.openListen(); return; }
      if(_paused){ resumeNarration(); }
      else { _paused=true; stopSpeaking(); syncPlay(); setStatus("Paused. Tap \u25B6 to resume, tap \uD83C\uDF99, or say \u201CBernard\u201D to ask a question."); startWakeWord(); }
    };
    window.listenStop = function(){ _listening=false; _paused=false; _busy=false; stopWakeWord(); stopSpeaking(); hideBar(); };

    // ---- tap-to-talk question ----
    function captureOnce(cb){
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if(!SR){ setStatus("Voice input isn't supported here — try Chrome."); cb(""); return; }
      var r=new SR(); r.lang="en-US"; r.interimResults=false; r.maxAlternatives=1;
      var got="";
      r.onresult=function(e){ try{ got=e.results[0][0].transcript; }catch(x){} };
      r.onerror=function(){};
      r.onend=function(){ cb((got||"").trim()); };
      try{ r.start(); }catch(e){ cb(""); }
    }
    function askChat(q, cb){
      var s = SLIDES[window.currentSlide()] || {};
      fetch("/api/chat", { method:"POST", headers:{"content-type":"application/json"},
        body: JSON.stringify({ message:q, slideTitle: s.eyebrow || "" }) })
        .then(function(r){ return r.text().then(function(t){ var j={}; try{ j=JSON.parse(t); }catch(e){} return { ok:r.ok, status:r.status, j:j }; }); })
        .then(function(res){
          if(res.ok && res.j && res.j.reply){ cb(res.j.reply); return; }
          var detail = (res.j && res.j.error) || ("HTTP " + res.status);
          setStatus("Bernard error: " + String(detail).slice(0,90));
          cb("Bernard isn't reachable right now. The error was: " + detail + ".");
        })
        .catch(function(){ setStatus("Network error reaching Bernard."); cb("I couldn't reach Bernard — check the connection."); });
    }
    function answerQuestion(q){
      if(_busy) return;
      stopWakeWord();
      _paused=true; stopSpeaking(); syncPlay();
      _busy=true;
      setStatus("You asked Bernard: \u201C" + q + "\u201D — thinking…");
      askChat(q, function(reply){
        setStatus("Bernard is answering…");
        speak(reply, function(){
          _busy=false;
          setStatus("Tap \u25B6 to continue, tap \uD83C\uDF99, or say \u201CBernard\u201D to ask again.");
          startWakeWord();
        });
      });
    }
    window.listenAsk = function(){
      primeVoice();
      if(_busy) return;
      stopWakeWord();
      _paused=true; stopSpeaking(); syncPlay();
      _busy=true;
      setStatus("\uD83C\uDF99 Listening — ask Bernard your question…");
      captureOnce(function(q){
        _busy=false;
        q = (q || "").replace(/^bernard[,\s]*/i, "").trim();
        if(!q){ setStatus("Didn't catch that. Tap \uD83C\uDF99 to try again, say \u201CBernard\u201D, or \u25B6 to continue."); startWakeWord(); return; }
        answerQuestion(q);
      });
    };
  })();

  /* ---------- BOOT ---------- */
  render();
  updateLevelBadge();
  // On the very first visit (no level chosen yet), prompt the student to set their
  // comprehension level at the start. Afterwards it's remembered; change via ◎ Level.
  try { if(localStorage.getItem("tx_comp_level") === null) setTimeout(function(){ if(window.openLevel) window.openLevel(); }, 450); } catch(e){}
  window.addEventListener("resize", function(){ /* layout is CSS-driven; QR fixed size */ });

})();
