// /api/grade - AI grader for short-answer quiz questions. Uses the OpenAI API only.
// POST { question, rubric, sample, answer, level (1-5), levelName }
//   -> { verdict: "correct"|"partial"|"incorrect", score: 0..1, feedback: "..." }
const DEFAULT_MODEL = "gpt-5.5";
const FALLBACK_MODELS = ["gpt-5.4", "gpt-4.1-mini"];
const KEY_PREFIX = ["s", "k"].join("") + "-";
const KEY_PATTERN = new RegExp("^" + KEY_PREFIX + "[A-Za-z0-9_-]+$");
const PROJECT_KEY_PATTERN = new RegExp(KEY_PREFIX + "proj-[A-Za-z0-9_-]+", "g");
const ANY_KEY_PATTERN = new RegExp(KEY_PREFIX + "[A-Za-z0-9_-]+", "g");

function readBody(req){
  return new Promise((resolve)=>{
    if(req.body){ return resolve(typeof req.body==="string"?JSON.parse(req.body):req.body); }
    let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ try{ resolve(JSON.parse(d||"{}")); }catch{ resolve({}); } });
  });
}

const BAR = {
  1: "NOVICE: accept any answer that shows the basic idea, even in simple or partial words. Be generous. Spelling/grammar do not matter.",
  2: "CONVERSATIONAL: expect a clear sentence that states the main idea correctly in plain language. Minor gaps are fine.",
  3: "PROFICIENT: expect the correct main idea AND at least one supporting reason or key term used correctly.",
  4: "MASTERY: expect accuracy plus nuance, more than one factor, or an acknowledgement that the question is complicated.",
  5: "SUBJECT-MATTER EXPERT / TEACH: expect a teach-quality answer that is accurate, specific, organized, and notes caveats or significance."
};

function openAIKey(){
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function modelName(){
  return String(process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function modelList(){
  return Array.from(new Set([DEFAULT_MODEL, modelName()].concat(FALLBACK_MODELS).filter(Boolean)));
}

function keyError(key){
  if(!key) return "OPENAI_API_KEY is not set on the server.";
  if(!KEY_PATTERN.test(key)) return "OPENAI_API_KEY has extra text or invalid characters.";
  return "";
}

function safeMessage(value){
  return String(value || "OpenAI request failed.")
    .replace(PROJECT_KEY_PATTERN, "[redacted OpenAI key]")
    .replace(ANY_KEY_PATTERN, "[redacted API key]")
    .replace(/Bearer\s+[^\"'`]+/g, "Bearer [redacted]");
}

function shouldTryNextModel(status, message){
  if(status === 401) return false;
  return status === 400 || status === 403 || status === 404 ||
    (/model/i.test(String(message || "")) && /not found|does not exist|unsupported|invalid|access/i.test(String(message || "")));
}

function parseGrade(text){
  const cleaned = String(text || "").trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
  try { return JSON.parse(cleaned); }
  catch(e){
    const m = cleaned.match(/\{[\s\S]*\}/);
    if(m) return JSON.parse(m[0]);
    throw e;
  }
}

module.exports = async (req, res) => {
  try{
    if(req.method !== "POST") return res.status(405).json({ error:"POST only" });
    const key = openAIKey();
    const missing = keyError(key);
    if(missing) return res.status(503).json({ error:missing });

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
      + "in a class on {{TOPIC}}. Grade ONLY against the question and rubric provided. "
      + "Be accurate and intellectually honest (" + "{{TOPIC_HONESTY}}" + "). "
      + "Calibrate strictness to the student's chosen comprehension level.\n\n"
      + "TARGET LEVEL - " + levelName + ": " + (BAR[level]||BAR[2]) + "\n\n"
      + "Return STRICT JSON ONLY shaped exactly like:\n"
      + "{\"verdict\":\"correct|partial|incorrect\",\"score\":0.0,\"feedback\":\"1-2 warm, specific sentences a {{AUDIENCE_NOUN}} can act on\"}\n"
      + "Rules: correct => score 0.85-1.0; partial => 0.4-0.84; incorrect => 0-0.39. "
      + "In feedback, say what was good and what to add. Keep it encouraging.";

    const user =
      "QUESTION:\n" + question + "\n\n"
      + (rubric ? ("WHAT A GOOD ANSWER SHOULD COVER (rubric):\n" + rubric + "\n\n") : "")
      + (sample ? ("REFERENCE / MODEL ANSWER:\n" + sample + "\n\n") : "")
      + "STUDENT'S ANSWER:\n" + answer + "\n\n"
      + "Grade it now. Return ONLY the JSON object.";

    let raw = "";
    let usedModel = "";
    let lastError = "";
    for(const model of modelList()){
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{ "content-type":"application/json", authorization:"Bearer "+key },
        body: JSON.stringify({
          model,
          max_tokens:300,
          temperature:0,
          response_format:{ type:"json_object" },
          messages:[{ role:"system", content:sys }, { role:"user", content:user }]
        })
      });
      const j = await r.json().catch(()=>({}));
      if(!r.ok){
        const detail = j && j.error && j.error.message ? j.error.message : "OpenAI "+r.status;
        lastError = safeMessage(detail);
        if(shouldTryNextModel(r.status, detail)) continue;
        return res.status(502).json({ error:lastError });
      }
      raw = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      usedModel = model;
      break;
    }
    if(!raw) return res.status(502).json({ error:lastError || "OpenAI model unavailable." });
    const out = parseGrade(raw);
    let verdict = String(out.verdict || "").toLowerCase();
    if(["correct","partial","incorrect"].indexOf(verdict)===-1) verdict = "partial";
    let score = Number(out.score);
    if(!(score>=0 && score<=1)) score = verdict==="correct"?0.9:verdict==="partial"?0.6:0.2;
    const feedback = (out.feedback||"").toString().slice(0,500) || "Thanks - answer graded.";

    return res.status(200).json({ verdict, score, feedback, model: usedModel });
  }catch(e){ return res.status(500).json({ error:safeMessage(e && e.message || e) }); }
};
