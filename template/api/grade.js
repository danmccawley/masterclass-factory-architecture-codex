// /api/grade — AI grader for short-answer quiz questions (Anthropic). Reads ANTHROPIC_API_KEY.
// POST { question, rubric, sample, answer, level (1-5), levelName }
//   -> { verdict: "correct"|"partial"|"incorrect", score: 0..1, feedback: "..." }
// Grading strictness scales with the chosen comprehension level.
const MODEL = "claude-sonnet-4-6";

function readBody(req){
  return new Promise((resolve)=>{
    if(req.body){ return resolve(typeof req.body==="string"?JSON.parse(req.body):req.body); }
    let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ try{ resolve(JSON.parse(d||"{}")); }catch{ resolve({}); } });
  });
}

// What the grader should expect at each comprehension level.
const BAR = {
  1: "NOVICE: accept any answer that shows the basic idea, even in simple or partial words. Be generous. Spelling/grammar do not matter.",
  2: "CONVERSATIONAL: expect a clear sentence that states the main idea correctly in plain language. Minor gaps are fine.",
  3: "PROFICIENT: expect the correct main idea AND at least one supporting reason or key term used correctly.",
  4: "MASTERY: expect accuracy plus nuance — more than one factor, or an acknowledgement that historians disagree / that it is complicated.",
  5: "SUBJECT-MATTER EXPERT / TEACH: expect a teach-quality answer — accurate, specific, well-organized, naming people/events where relevant, noting caveats or significance. Hold a high bar."
};

module.exports = async (req, res) => {
  try{
    if(req.method !== "POST") return res.status(405).json({ error:"POST only" });
    const key = process.env.ANTHROPIC_API_KEY;
    if(!key) return res.status(503).json({ error:"ANTHROPIC_API_KEY not set on the server" });

    const b = await readBody(req);
    const question = (b.question||"").toString().slice(0,600).trim();
    const answer   = (b.answer||"").toString().slice(0,2000).trim();
    const rubric   = (b.rubric||"").toString().slice(0,800).trim();
    const sample   = (b.sample||"").toString().slice(0,800).trim();
    let level = parseInt(b.level,10); if(!(level>=1 && level<=5)) level = 2;
    const levelName = (b.levelName||"").toString().slice(0,60) || ("Level "+level);
    if(!question || !answer) return res.status(400).json({ error:"question and answer required" });

    const sys =
      "You are a kind, fair teacher grading a {{AUDIENCE_LEVEL}} student's short written answer "
      + "in a class on {{TOPIC}}. "
      + "Grade ONLY against the question and rubric provided. Be accurate and intellectually honest "
      + "({{TOPIC_HONESTY}}). Calibrate your strictness to the student's chosen comprehension level.\n\n"
      + "TARGET LEVEL — " + levelName + ": " + (BAR[level]||BAR[2]) + "\n\n"
      + "Return STRICT JSON ONLY (no prose, no code fences) shaped exactly like:\n"
      + '{"verdict":"correct|partial|incorrect","score":0.0-1.0,"feedback":"1-2 warm, specific sentences a {{AUDIENCE_NOUN}} can act on"}\n'
      + "Rules: verdict 'correct' => score 0.85-1.0; 'partial' => 0.4-0.84; 'incorrect' => 0-0.39. "
      + "In feedback, say what was good and what to add — never reveal the answer scornfully. Keep it encouraging.";

    const user =
      "QUESTION:\n" + question + "\n\n"
      + (rubric ? ("WHAT A GOOD ANSWER SHOULD COVER (rubric):\n" + rubric + "\n\n") : "")
      + (sample ? ("REFERENCE / MODEL ANSWER:\n" + sample + "\n\n") : "")
      + "STUDENT'S ANSWER:\n" + answer + "\n\n"
      + "Grade it now. Return ONLY the JSON object.";

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "content-type":"application/json", "x-api-key":key, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:MODEL, max_tokens:300, temperature:0, system:sys, messages:[{ role:"user", content:user }] })
    });
    if(!r.ok){
      const t = await r.text();
      return res.status(502).json({ error:"anthropic "+r.status, detail:t.slice(0,300) });
    }
    const j = await r.json();
    let text = (j.content||[]).filter(p=>p.type==="text").map(p=>p.text).join("").trim();
    text = text.replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
    let out;
    try { out = JSON.parse(text); }
    catch(e){
      const m = text.match(/\{[\s\S]*\}/);
      if(m){ try { out = JSON.parse(m[0]); } catch(e2){ out = null; } }
    }
    if(!out || !out.verdict) return res.status(502).json({ error:"could not parse grade", raw:text.slice(0,200) });

    let verdict = String(out.verdict).toLowerCase();
    if(["correct","partial","incorrect"].indexOf(verdict)===-1) verdict = "partial";
    let score = Number(out.score);
    if(!(score>=0 && score<=1)) score = verdict==="correct"?0.9:verdict==="partial"?0.6:0.2;
    const feedback = (out.feedback||"").toString().slice(0,500) || "Thanks — answer graded.";

    return res.status(200).json({ verdict, score, feedback });
  }catch(e){ return res.status(500).json({ error:String(e && e.message || e) }); }
};
