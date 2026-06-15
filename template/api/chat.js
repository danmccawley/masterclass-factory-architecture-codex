// /api/chat — the AI tutor (Anthropic). Reads ANTHROPIC_API_KEY.
// POST { message, slide, slideTitle, history:[{role,content}...] } -> { reply }
const MODEL = "claude-sonnet-4-6";   // fast + inexpensive for a classroom; change if you prefer

function readBody(req){
  return new Promise((resolve)=>{
    if(req.body){ return resolve(typeof req.body==="string"?JSON.parse(req.body):req.body); }
    let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ try{ resolve(JSON.parse(d||"{}")); }catch{ resolve({}); } });
  });
}

module.exports = async (req, res) => {
  try{
    if(req.method !== "POST") return res.status(405).json({ error:"POST only" });
    const key = process.env.ANTHROPIC_API_KEY;
    if(!key) return res.status(503).json({ error:"ANTHROPIC_API_KEY not set on the server" });

    const b = await readBody(req);
    const message = (b.message||"").toString().slice(0,2000).trim();
    if(!message) return res.status(400).json({ error:"empty message" });

    const sys =
      "You are a friendly, patient tutor for a {{AUDIENCE_LEVEL}} class on {{TOPIC}}. "
      + "Keep answers short, clear, and appropriate for the audience (a few sentences). Define hard words simply. "
      + "Stay on the topic of {{TOPIC}}: {{TOPIC_SCOPE}}. "
      + "Be accurate and intellectually honest. {{TOPIC_HONESTY}} "
      + "If asked something off-topic, gently steer back to the class. Never invent facts; if unsure, say so."
      + (b.slideTitle ? (" The student is currently on the section: \"" + String(b.slideTitle).slice(0,120) + "\".") : "");

    const msgs = [];
    (Array.isArray(b.history)?b.history.slice(-8):[]).forEach(m=>{
      if(m && (m.role==="user"||m.role==="assistant") && m.content)
        msgs.push({ role:m.role, content:String(m.content).slice(0,2000) });
    });
    if(!msgs.length || msgs[msgs.length-1].content !== message)
      msgs.push({ role:"user", content:message });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "content-type":"application/json", "x-api-key":key, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:MODEL, max_tokens:400, system:sys, messages:msgs })
    });
    if(!r.ok){
      const t = await r.text();
      return res.status(502).json({ error:"anthropic "+r.status, detail:t.slice(0,300) });
    }
    const j = await r.json();
    const reply = (j.content||[]).filter(p=>p.type==="text").map(p=>p.text).join("").trim()
                  || "Sorry, I couldn't think of an answer to that.";
    return res.status(200).json({ reply });
  }catch(e){ return res.status(500).json({ error:String(e && e.message || e) }); }
};
