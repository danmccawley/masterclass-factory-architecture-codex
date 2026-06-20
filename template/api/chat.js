// /api/chat - Bernard, the AI tutor. Uses the OpenAI API only.
// POST { message, slide, slideTitle, history:[{role,content}...] } -> { reply }
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

module.exports = async (req, res) => {
  try{
    if(req.method !== "POST") return res.status(405).json({ error:"POST only" });
    const key = openAIKey();
    const missing = keyError(key);
    if(missing) return res.status(503).json({ error:missing });

    const b = await readBody(req);
    const message = (b.message||"").toString().slice(0,2000).trim();
    if(!message) return res.status(400).json({ error:"empty message" });

    const sys =
      "You are Bernard, a friendly, patient AI tutor for a {{AUDIENCE_LEVEL}} class on {{TOPIC}}. "
      + "Use clear British English phrasing and a calm, professional teaching voice. "
      + "Keep answers short, clear, and appropriate for the audience. Define hard words simply. "
      + "Stay on the topic of {{TOPIC}}: {{TOPIC_SCOPE}}. "
      + "Be accurate and intellectually honest. {{TOPIC_HONESTY}} "
      + "If asked something off-topic, gently steer back to the class. Never invent facts; if unsure, say so."
      + (b.slideTitle ? (" The student is currently on the section: \"" + String(b.slideTitle).slice(0,120) + "\".") : "");

    const msgs = [{ role:"system", content:sys }];
    (Array.isArray(b.history)?b.history.slice(-8):[]).forEach(m=>{
      if(m && (m.role==="user"||m.role==="assistant") && m.content)
        msgs.push({ role:m.role, content:String(m.content).slice(0,2000) });
    });
    if(!msgs.length || msgs[msgs.length-1].content !== message)
      msgs.push({ role:"user", content:message });

    let lastError = "";
    for(const model of modelList()){
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{ "content-type":"application/json", authorization:"Bearer "+key },
        body: JSON.stringify({ model, max_tokens:400, temperature:0.2, messages:msgs })
      });
      const j = await r.json().catch(()=>({}));
      if(!r.ok){
        const detail = j && j.error && j.error.message ? j.error.message : "OpenAI "+r.status;
        lastError = safeMessage(detail);
        if(shouldTryNextModel(r.status, detail)) continue;
        return res.status(502).json({ error:lastError });
      }
      const reply = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content
        ? j.choices[0].message.content.trim()
        : "Sorry, I couldn't think of an answer to that.";
      return res.status(200).json({ reply, model });
    }
    return res.status(502).json({ error:lastError || "OpenAI model unavailable." });
  }catch(e){ return res.status(500).json({ error:safeMessage(e && e.message || e) }); }
};
