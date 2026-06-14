# -*- coding: utf-8 -*-
"""
build_content.py — topic-agnostic Masterclass content generator (Factory Agent 8).

Emits the ENTIRE content layer for one deck:
    content.js   -> window.CLASS_TITLE, window.SLIDES[], window.POLLS{}, window.WORDS{}
    glossary.js  -> window.GLOSSARY{ term: {d, r} }
    source.js    -> window.SOURCE_PAPER { title, cite, sections:[{id,num,title,body}] }

These three files are the ONLY things the Factory generates. engine.js, navscrubber.js,
index.html (shell), and api/*.js are copied unchanged (de-topic a few strings — see the
contract doc, section 6e).

Verified against the shipped engine contract:
  - slide  = {id, eyebrow, num, deck, paper?, poll?, words?}
  - paper  = a SINGLE object {secnum, h, body}   (authored as [P(...)]; emitter unwraps)
  - GLOSSARY term -> {d: definition, r: "why it matters"}   (NOT a bare string)
  - SOURCE_PAPER is ONE object with a sections[] array       (NOT a flat SOURCES[])
  - quiz item = {type:'mc', level, q, options, answer, why} | {type:'tf', level, q, answer, why}
              | {type:'sa', level, q, rubric, sample, accept:[...]}
  - citations: <sup class="cite" data-src="sN">[label]</sup>  (resolves to a section id)

Run:  python build_content.py        # writes the 3 files, then self-verifies and prints counts
The demo content below is a minimal 4-slide deck so the file runs out of the box. Replace the
"GENERATED PER DECK" region with the real deck (this is what the Author/Assessment/Glossary/
Source-Verify agents produce). DO NOT edit the helpers or the emit/verify machinery.
"""
import json, html as _html, sys

# ====================================================================== CONFIG (per deck)
CLASS_TITLE = "DEMO — Replace Me"          # window.CLASS_TITLE
# A de-topicable label: MDC used "Where the field disagrees"; the middle-school Texas deck
# reframed it as "Historians still argue about this". Set it to fit the audience/topic.
DISAGREE_LABEL = "Where the field disagrees"

S = []   # the slide list (built by slide() calls below)

# ====================================================================== HELPERS (do not edit)
def slide(id, eyebrow, num, deck, paper=None, poll=None, words=None):
    o = {"id": id, "eyebrow": eyebrow, "num": str(num), "deck": deck}
    if paper: o["paper"] = paper
    if poll:  o["poll"]  = poll
    if words: o["words"] = words
    S.append(o)

def P(secnum, h, body):
    """A deep-dive paper. Author as paper=[P(...)] OR paper=P(...); the emitter normalizes."""
    return {"secnum": secnum, "h": h, "body": body}

def arg(text, label=None):
    """The 'where the field disagrees' named-opposition block."""
    return ('<div class="pcallout"><div class="l">' + (label or DISAGREE_LABEL) + '</div>'
            '<p>' + text + '</p></div>')

def c(n, label):
    """Inline citation -> resolves to SOURCE_PAPER.sections[] id 'sN'."""
    return '<sup class="cite" data-src="s%d">[%s]</sup>' % (n, label)

def esc(s):
    return s.replace('&', '&amp;').replace('"', '&quot;')

def card(title, more, dd=None, stat=None, kicker=None, h3=None, body=None, src=None):
    attrs = ' class="card" data-title="%s" data-more="%s"' % (esc(title), esc(more))
    if dd:  attrs += ' data-dd="%s"' % dd
    if src: attrs += ' data-src="s%d"' % src
    inner = ""
    if stat:   inner += '<div class="stat">%s</div>' % stat
    if h3:     inner += '<h3>%s</h3>' % h3
    if kicker: inner += '<div class="k">%s</div>' % kicker
    if body:   inner += '<p>%s</p>' % body
    return '<div%s>%s</div>' % (attrs, inner)

def quiz_slide(sid, title, intro, questions, eyebrow="Knowledge Check", pop=True):
    """Emit a quiz slide. questions = list of dicts (see header). level (1-5) = min comprehension
       level at which the question appears (difficulty gating)."""
    attr = _html.escape(json.dumps(questions, ensure_ascii=False), quote=True)
    cls = "quizbox popquiz anim" if pop else "quizbox anim"
    popattr = ' data-pop="1"' if pop else ''
    deck = ('\n    <div class="wrap">'
            '\n      <div class="eyebrow anim"><span class="num">&#10003;</span><span class="bar"></span>' + eyebrow + '</div>'
            '\n      <h2 class="head anim">' + title + '</h2>'
            '\n      <p class="lede anim">' + intro + '</p>'
            '\n      <div id="quiz-' + sid + '" class="' + cls + '" data-quiz="' + attr + '"' + popattr + '></div>'
            '\n    </div>')
    slide(sid, eyebrow, "&#10003;", deck)

# ====================================================================== GENERATED PER DECK
# ↓↓↓ Everything between these markers is what the content agents author. Replace it. ↓↓↓

slide("title", "Demo Topic", "01", """
    <div class="wrap">
      <div class="eyebrow anim"><span class="num">01</span><span class="bar"></span>Demo Topic · A Master Class</div>
      <h1 class="anim">Replace This Title</h1>
      <p class="sub anim">A one-line subtitle for the demo deck.</p>
      <div class="qrbox anim" id="qrbox"><canvas id="qr"></canvas><span>Scan to follow along</span></div>
    </div>""")

slide("bluf", "The Big Picture", "02", """
    <div class="wrap">
      <div class="eyebrow anim"><span class="num">&#9733;</span><span class="bar"></span>The Whole Story in One Idea</div>
      <h2 class="head anim">One sentence that frames the entire class</h2>
      <p class="lede anim">A plain-language summary of the core argument, grounded in the corpus""" + c(1, "src") + """.</p>
      <button class="deepbtn anim" data-deep="bluf">Open the deep dive &rarr;</button>
    </div>""",
    paper=[P("The Big Picture", "Why this matters",
        "<p>Deep-dive prose. " + arg("State the genuine scholarly disagreement here, naming the opposing camps.") + "</p>")])

slide("poll1", "Warm-up", "03", """
    <div class="wrap">
      <div class="eyebrow anim"><span class="num">03</span><span class="bar"></span>Make a Prediction</div>
      <h2 class="head anim">A live poll opens here</h2>
      <p class="lede anim">The engine auto-opens the poll modal on this slide.</p>
    </div>""", poll="poll-demo")

quiz_slide("check1", "Quick check", "Answer these to test the core ideas.", [
    {"type": "mc", "level": 1, "q": "What is 2 + 2?", "options": ["3", "4", "5"], "answer": 1,
     "why": "Basic arithmetic."},
    {"type": "tf", "level": 3, "q": "This deck is topic-agnostic at the engine layer.", "answer": True,
     "why": "Only the content layer changes per topic."},
    {"type": "sa", "level": 4, "q": "In one sentence, why does the Factory only generate the content layer?",
     "rubric": "Mentions that engine/shell/backends are fixed reusable templates and content is data.",
     "sample": "Because the engine, shell, and backends are fixed and reusable, so only the data (slides, glossary, sources) changes per topic.",
     "accept": ["engine", "reusable", "content is data", "fixed", "template"]},
])

POLLS_DEF = {
    "poll-demo": {
        "q": "Replace this poll question?",
        "desc": "A short sub-line shown under the question.",
        "opts": ["Option A", "Option B", "Option C", "Option D"],
    },
}
WORDS_DEF = {
    # "words-id": {"q": "One-word prompt?", "desc": "sub-line"},
}

GLOSSARY = {
    "topic-agnostic": {
        "d": "Built so the same engine works for any subject without being changed.",
        "r": "It is why one engine can power unlimited masterclasses — only the content differs.",
    },
}

SOURCE_PAPER = {
    "title": "Student Reader — Demo",
    "cite": "A study aid compiled for this class. Not original scholarship; see the Works-Cited slide for verified sources.",
    "sections": [
        {"id": "s1", "num": "1", "title": "Demo source",
         "body": "<p>Replace with a verified source summary. Citations like " + c(1, "src") + " resolve to this section by its id.</p>"},
    ],
}

# ↑↑↑ End GENERATED PER DECK ↑↑↑
# ====================================================================== EMIT (do not edit)
def js_str(s):
    return json.dumps(s, ensure_ascii=False)   # real chars, valid JS string literal

def _paper_obj(p):
    """Normalize paper authored as [P(...)] or P(...) into the single object the engine needs."""
    if isinstance(p, list):
        if len(p) != 1:
            raise ValueError("paper must be exactly one section object, got list of %d" % len(p))
        return p[0]
    return p

def emit_content():
    out = ["/* " + CLASS_TITLE + " — content layer. GENERATED — edit build_content.py and regenerate. */",
           "window.CLASS_TITLE = " + js_str(CLASS_TITLE) + ";",
           "window.SLIDES = ["]
    for s in S:
        out.append("  {")
        out.append("    id: " + js_str(s["id"]) + ",")
        out.append("    eyebrow: " + js_str(s["eyebrow"]) + ",")
        out.append("    num: " + js_str(s["num"]) + ",")
        out.append("    deck: " + js_str(s["deck"]) + ",")
        if "paper" in s:
            sec = _paper_obj(s["paper"])
            out.append("    paper: { secnum: " + js_str(sec["secnum"]) + ", h: " + js_str(sec["h"]) +
                       ", body: " + js_str(sec["body"]) + " },")
        if "poll" in s:  out.append("    poll: " + js_str(s["poll"]) + ",")
        if "words" in s: out.append("    words: " + js_str(s["words"]) + ",")
        out.append("  },")
    out.append("];")
    out.append("window.POLLS = " + json.dumps(POLLS_DEF, ensure_ascii=False) + ";")
    out.append("window.WORDS = " + json.dumps(WORDS_DEF, ensure_ascii=False) + ";")
    open("content.js", "w", encoding="utf-8").write("\n".join(out) + "\n")

def emit_glossary():
    open("glossary.js", "w", encoding="utf-8").write(
        "/* " + CLASS_TITLE + " — glossary. term -> {d: definition, r: why it matters}. */\n"
        "window.GLOSSARY = " + json.dumps(GLOSSARY, ensure_ascii=False, indent=2) + ";\n")

def emit_source():
    open("source.js", "w", encoding="utf-8").write(
        "/* " + CLASS_TITLE + " — Student Reader. window.SOURCE_PAPER {title,cite,sections:[{id,num,title,body}]}. */\n"
        "window.SOURCE_PAPER = " + json.dumps(SOURCE_PAPER, ensure_ascii=False, indent=2) + ";\n")

# ====================================================================== SELF-VERIFY (do not edit)
def verify():
    fail = []
    A = lambda cond, msg: (None if cond else fail.append(msg))
    ids = set(); deepdives = 0; quizzes = 0
    A(len(S) > 0, "no slides"); A(bool(CLASS_TITLE), "missing CLASS_TITLE")
    for i, s in enumerate(S):
        A(s.get("id"), "slide %d missing id" % i)
        A(s["id"] not in ids, "duplicate id: %s" % s.get("id")); ids.add(s.get("id"))
        A("<" in s.get("deck", ""), "slide %s deck not innerHTML" % s["id"])
        if "paper" in s:
            deepdives += 1
            try:
                sec = _paper_obj(s["paper"]); A(sec.get("h") and sec.get("body"), "slide %s paper missing h/body" % s["id"])
            except ValueError as e:
                fail.append("slide %s: %s" % (s["id"], e))
        if "poll" in s:  A(s["poll"] in POLLS_DEF and isinstance(POLLS_DEF[s["poll"]].get("opts"), list),
                           'poll "%s" (slide %s) undefined or missing opts' % (s["poll"], s["id"]))
        if "words" in s: A(s["words"] in WORDS_DEF and WORDS_DEF[s["words"]].get("q"),
                           'words "%s" (slide %s) undefined' % (s["words"], s["id"]))
    # quiz JSON parses + key/type checks
    import re
    for s in S:
        for m in re.findall(r'data-quiz="([^"]+)"', s["deck"]):
            quizzes += 1
            try:
                qs = json.loads(_html.unescape(m))
            except Exception as e:
                fail.append("bad quiz JSON in %s: %s" % (s["id"], e)); continue
            for j, q in enumerate(qs):
                A(q.get("type") in ("mc", "tf", "sa"), "%s q%d bad type %r" % (s["id"], j, q.get("type")))
                if q.get("type") == "mc": A(isinstance(q.get("options"), list) and isinstance(q.get("answer"), int),
                                            "%s q%d mc needs options[]+answer idx" % (s["id"], j))
                if q.get("type") == "tf": A(isinstance(q.get("answer"), bool), "%s q%d tf needs bool answer" % (s["id"], j))
                if q.get("type") == "sa": A(q.get("rubric") and isinstance(q.get("accept"), list),
                                            "%s q%d sa needs rubric+accept[]" % (s["id"], j))
                if "level" in q: A(1 <= q["level"] <= 5, "%s q%d level out of 1-5" % (s["id"], j))
    # citations resolve to a SOURCE_PAPER.sections[] id
    sec_ids = set(str(x["id"]) for x in SOURCE_PAPER.get("sections", []))
    for s in S:
        body = s["deck"] + (_paper_obj(s["paper"])["body"] if "paper" in s else "")
        for cid in re.findall(r'data-src="(s?\w+)"', body):
            A(cid in sec_ids, "unresolved citation %s in %s" % (cid, s["id"]))
    A(len(sec_ids) > 0, "SOURCE_PAPER.sections empty")
    A(SOURCE_PAPER.get("title") and SOURCE_PAPER.get("cite"), "SOURCE_PAPER missing title/cite")
    A(len(GLOSSARY) > 0, "glossary empty")
    for k, v in GLOSSARY.items():
        A(isinstance(v, dict) and v.get("d") and v.get("r"), 'glossary "%s" must be {d,r}' % k)
    print("slides=%d deepdives=%d quizzes=%d sections=%d glossary=%d polls=%d words=%d" %
          (len(S), deepdives, quizzes, len(sec_ids), len(GLOSSARY), len(POLLS_DEF), len(WORDS_DEF)))
    if fail:
        print("FAIL:\n - " + "\n - ".join(fail)); sys.exit(1)
    print("QA PASS")

if __name__ == "__main__":
    emit_content(); emit_glossary(); emit_source()
    print("WROTE content.js, glossary.js, source.js")
    verify()
