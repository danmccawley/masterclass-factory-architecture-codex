// /api/feedback — stores audience feedback (Upstash Redis via KV_REST_API_* env vars)
// POST { slide, slideNum, context, text } -> { ok:true }
async function kv(commands){
  const base = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if(!base || !tok) return null;
  const r = await fetch(base.replace(/\/$/,"") + "/pipeline", {
    method:"POST",
    headers:{ Authorization:"Bearer "+tok, "Content-Type":"application/json" },
    body: JSON.stringify(commands)
  });
  if(!r.ok) throw new Error("kv "+r.status);
  return r.json();
}
function readBody(req){
  return new Promise((resolve)=>{
    if(req.body){ return resolve(typeof req.body==="string"?JSON.parse(req.body):req.body); }
    let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ try{ resolve(JSON.parse(d||"{}")); }catch{ resolve({}); } });
  });
}
module.exports = async (req, res) => {
  try{
    if(req.method !== "POST") return res.status(405).json({ ok:false });
    const b = await readBody(req);
    const text = (b.text||"").toString().slice(0,4000).trim();
    if(!text) return res.status(400).json({ ok:false, error:"empty" });
    const entry = JSON.stringify({
      slide: b.slide||"", slideNum: b.slideNum||"", context: b.context||"",
      text, ts: Date.now()
    });
    const j = await kv([["RPUSH", "feedback:all", entry]]);
    if(!j) return res.status(503).json({ ok:false, error:"no store" });
    return res.status(200).json({ ok:true });
  }catch(e){ return res.status(500).json({ ok:false, error:String(e && e.message || e) }); }
};
