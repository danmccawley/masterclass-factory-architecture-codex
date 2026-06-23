/* ============================================================================
   NAV SCRUBBER  —  draggable slide scrubber + "jump to #" box
   Self-contained. Requires the engine hooks: window.go, window.slideCount,
   window.currentSlide, window.slideMeta (added to engine.js).
   Load AFTER engine.js:  <script src="navscrubber.js"></script>
   ============================================================================ */
(function(){
  "use strict";

  function ready(fn){
    if(document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function(){
    // Bail gracefully if the engine hooks aren't present (e.g. older engine.js).
    if(typeof window.go !== "function" || typeof window.slideCount !== "function"){
      console.warn("[navscrubber] engine hooks missing; scrubber disabled.");
      return;
    }

    var COUNT = window.slideCount();
    if(!COUNT || COUNT < 2) return;

    /* ---------- styles ---------- */
    var css = document.createElement("style");
    css.textContent = [
      "#scrubWrap{position:fixed;left:0;right:0;bottom:54px;z-index:21;display:flex;justify-content:center;pointer-events:none;}",
      "#scrubInner{pointer-events:auto;width:min(940px,94vw);background:rgba(14,17,22,.86);backdrop-filter:blur(8px);",
        "border:1px solid var(--line,#222831);border-radius:12px;padding:9px 14px 11px;display:flex;align-items:center;gap:12px;",
        "box-shadow:0 6px 24px rgba(0,0,0,.35);transform:translateY(8px);opacity:0;transition:opacity .25s,transform .25s;}",
      "#scrubWrap.show #scrubInner{opacity:1;transform:translateY(0);}",
      "#scrubTrackWrap{flex:1;position:relative;height:26px;display:flex;align-items:center;cursor:pointer;}",
      "#scrubTrack{position:relative;width:100%;height:5px;border-radius:5px;background:var(--line,#222831);overflow:visible;}",
      "#scrubFill{position:absolute;left:0;top:0;height:100%;border-radius:5px;background:linear-gradient(90deg,var(--oxblood,#8f2f28),var(--amber,#e6a042));box-shadow:0 0 10px rgba(230,160,66,.55);width:0;}",
      "#scrubHandle{position:absolute;top:50%;width:15px;height:15px;border-radius:50%;background:var(--amber,#e6a042);",
        "border:2px solid #0e1116;transform:translate(-50%,-50%);box-shadow:0 0 8px rgba(230,160,66,.7);cursor:grab;}",
      "#scrubHandle:active{cursor:grabbing;transform:translate(-50%,-50%) scale(1.15);}",
      ".scrubMark{position:absolute;top:50%;width:2px;height:11px;background:rgba(120,130,145,.55);transform:translate(-50%,-50%);pointer-events:none;}",
      ".scrubMark.major{height:15px;background:rgba(70,200,192,.7);}",
      "#scrubTip{position:absolute;bottom:30px;left:0;transform:translateX(-50%);white-space:nowrap;",
        "background:#0e1116;border:1px solid var(--line,#222831);color:var(--ink,#e8ebf0);font-family:var(--mono,monospace);",
        "font-size:11.5px;padding:5px 9px;border-radius:7px;pointer-events:none;opacity:0;transition:opacity .12s;box-shadow:0 4px 14px rgba(0,0,0,.4);}",
      "#scrubTip.show{opacity:1;}",
      "#scrubTip b{color:var(--amber,#e6a042);}",
      "#scrubJump{flex:0 0 auto;display:flex;align-items:center;gap:6px;font-family:var(--mono,monospace);font-size:12px;color:var(--dim,#8a93a0);}",
      "#scrubJumpIn{width:52px;background:var(--card,#161a20);border:1px solid var(--line,#222831);color:var(--ink,#e8ebf0);",
        "border-radius:7px;padding:5px 7px;font-family:var(--mono,monospace);font-size:12.5px;text-align:center;}",
      "#scrubJumpIn:focus{outline:none;border-color:var(--amber,#e6a042);}",
      "#scrubJumpGo{background:var(--card,#161a20);border:1px solid var(--line,#222831);color:var(--ink,#e8ebf0);",
        "border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer;font-family:var(--mono,monospace);}",
      "#scrubJumpGo:hover{border-color:var(--amber,#e6a042);}",
      "#scrubToggle{position:fixed;right:14px;bottom:60px;z-index:22;background:var(--card,#161a20);border:1px solid var(--line,#222831);",
        "color:var(--ink,#e8ebf0);border-radius:9px;padding:7px 11px;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);}",
      "#scrubToggle:hover{border-color:var(--amber,#e6a042);}",
      "@media(max-width:760px){#scrubInner{width:96vw;gap:8px;padding:8px 10px 10px;}#scrubJump{display:none;}#scrubWrap{bottom:60px;}}"
    ].join("");
    document.head.appendChild(css);

    /* ---------- markup ---------- */
    var toggle = document.createElement("button");
    toggle.id = "scrubToggle";
    toggle.type = "button";
    toggle.title = "Show / hide the slide scrubber";
    toggle.textContent = "⇿ Slides";
    document.body.appendChild(toggle);

    var wrap = document.createElement("div");
    wrap.id = "scrubWrap";
    wrap.innerHTML =
      '<div id="scrubInner">' +
        '<div id="scrubTrackWrap">' +
          '<div id="scrubTip"></div>' +
          '<div id="scrubTrack">' +
            '<div id="scrubFill"></div>' +
            '<div id="scrubHandle"></div>' +
          '</div>' +
        '</div>' +
        '<div id="scrubJump">' +
          '<span>Go to</span>' +
          '<input id="scrubJumpIn" type="number" min="1" max="' + COUNT + '" placeholder="#" />' +
          '<button id="scrubJumpGo" type="button">Jump</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var trackWrap = document.getElementById("scrubTrackWrap");
    var track     = document.getElementById("scrubTrack");
    var fill      = document.getElementById("scrubFill");
    var handle    = document.getElementById("scrubHandle");
    var tip       = document.getElementById("scrubTip");
    var jumpIn    = document.getElementById("scrubJumpIn");
    var jumpGo    = document.getElementById("scrubJumpGo");

    /* ---------- section markers (major = Part dividers / big sections) ---------- */
    // A slide is a "major" marker if its eyebrow begins with "Part " or "Section ".
    for(var i=0;i<COUNT;i++){
      var m = window.slideMeta(i);
      var eb = (m.eyebrow||"");
      var isMajor = /^(Part |Section )/.test(eb);
      var isMinor = /·/.test(eb) && !isMajor;
      if(isMajor || (isMinor && i%6===0)){
        var mk = document.createElement("div");
        mk.className = "scrubMark" + (isMajor ? " major" : "");
        mk.style.left = (i/(COUNT-1)*100) + "%";
        track.appendChild(mk);
      }
    }

    /* ---------- helpers ---------- */
    function pct(i){ return (i/(COUNT-1))*100; }
    function setVisual(i){
      var p = pct(i);
      fill.style.width = p + "%";
      handle.style.left = p + "%";
    }
    function labelFor(i){
      var m = window.slideMeta(i);
      var eb = m.eyebrow || "";
      return "<b>" + (m.num||(i+1)) + "</b> · " + (eb || "Slide " + (i+1));
    }
    function showTip(i, clientX){
      tip.innerHTML = labelFor(i);
      var rect = track.getBoundingClientRect();
      var x = (typeof clientX === "number")
        ? Math.min(Math.max(clientX - rect.left, 0), rect.width)
        : (pct(i)/100)*rect.width;
      tip.style.left = x + "px";
      tip.classList.add("show");
    }
    function hideTip(){ tip.classList.remove("show"); }

    function indexFromClientX(clientX){
      var rect = track.getBoundingClientRect();
      var ratio = (clientX - rect.left) / rect.width;
      ratio = Math.min(Math.max(ratio, 0), 1);
      return Math.round(ratio * (COUNT-1));
    }

    /* ---------- drag / click on the track ---------- */
    var dragging = false;
    // Live preview: as the user drags, actually flash the target slide onscreen.
    // go() only toggles CSS classes (no re-render/re-bind), so this is cheap — but we
    // still throttle to one update per animation frame and skip redundant indices.
    var rafPending = false;
    var liveTargetIdx = null;
    var lastLiveIdx = -1;
    function flushLive(){
      rafPending = false;
      if(liveTargetIdx !== null && liveTargetIdx !== lastLiveIdx){
        lastLiveIdx = liveTargetIdx;
        window.go(liveTargetIdx);   // flash the slide on screen
      }
    }
    function previewSlide(i){
      liveTargetIdx = i;
      if(!rafPending){
        rafPending = true;
        (window.requestAnimationFrame || function(cb){ setTimeout(cb, 16); })(flushLive);
      }
    }

    function onDown(e){
      dragging = true;
      var clientX = (e.touches ? e.touches[0].clientX : e.clientX);
      var i = indexFromClientX(clientX);
      setVisual(i); showTip(i, clientX);
      previewSlide(i);            // flash immediately on press
      e.preventDefault();
    }
    function onMove(e){
      if(!dragging) return;
      var clientX = (e.touches ? e.touches[0].clientX : e.clientX);
      var i = indexFromClientX(clientX);
      setVisual(i); showTip(i, clientX);
      previewSlide(i);            // flash as you drag (throttled)
      e.preventDefault();
    }
    function onUp(e){
      if(!dragging) return;
      dragging = false;
      var clientX = (e.changedTouches ? e.changedTouches[0].clientX : e.clientX);
      var i = indexFromClientX(clientX);
      hideTip();
      lastLiveIdx = -1;           // reset so the final landing always commits
      window.go(i);               // land on the released slide
    }

    trackWrap.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    trackWrap.addEventListener("touchstart", onDown, {passive:false});
    document.addEventListener("touchmove", onMove, {passive:false});
    document.addEventListener("touchend", onUp);

    // hover preview (desktop) without dragging
    trackWrap.addEventListener("mousemove", function(e){
      if(dragging) return;
      var i = indexFromClientX(e.clientX);
      showTip(i, e.clientX);
    });
    trackWrap.addEventListener("mouseleave", function(){ if(!dragging) hideTip(); });

    /* ---------- jump box ---------- */
    function doJump(){
      var v = parseInt(jumpIn.value, 10);
      if(isNaN(v)) return;
      // The visible "num" labels run from the deck's own numbering; the engine indexes 0..COUNT-1.
      // Map the typed slide number to the matching slide index by its displayed num, fall back to ordinal.
      var target = -1;
      for(var i=0;i<COUNT;i++){ if(String(window.slideMeta(i).num) === String(v)){ target = i; break; } }
      if(target < 0) target = Math.min(Math.max(v-1, 0), COUNT-1); // ordinal fallback
      window.go(target);
      jumpIn.value = "";
      jumpIn.blur();
    }
    jumpGo.addEventListener("click", doJump);
    jumpIn.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ doJump(); e.preventDefault(); }
      // don't let arrow keys in the box trigger slide nav
      if(e.key === "ArrowLeft" || e.key === "ArrowRight"){ e.stopPropagation(); }
    });

    /* ---------- keep scrubber in sync with normal navigation ---------- */
    function syncToCurrent(){
      if(dragging) return;
      var i = window.currentSlide();
      setVisual(i);
    }
    // poll lightly (cheap) so arrow-key / button nav keeps the handle in sync
    setInterval(syncToCurrent, 220);
    syncToCurrent();

    /* ---------- show/hide toggle ---------- */
    var visible = false;
    function setVisible(v){
      visible = v;
      wrap.classList.toggle("show", v);
      toggle.textContent = v ? "⇿ Hide" : "⇿ Slides";
      if(v) syncToCurrent();
    }
    toggle.addEventListener("click", function(){ setVisible(!visible); });
    // Keyboard shortcut: press "g" to toggle the scrubber (ignored while typing in a field)
    document.addEventListener("keydown", function(e){
      if(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if(e.key === "g" || e.key === "G"){ setVisible(!visible); }
    });

    // Start visible so it's discoverable; comment the next line to start hidden.
    setVisible(true);
  });
})();
