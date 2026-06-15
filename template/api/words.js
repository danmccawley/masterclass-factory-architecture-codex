// /api/words — shared word-cloud frequencies (Upstash Redis via KV_REST_API_* env vars)
// GET  ?qid=<id>            -> { words:{ word:count, ... } }
// POST ?qid=<id>&w=<word>   -> { words:{ ... } }   (adds one word)
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
function hgetallToObj(result){
  if(!result) return {};
  if(Array.isArray(result)){ const o={}; for(let i=0;i<result.length;i+=2) o[result[i]]=result[i+1]; return o; }
  return result;
}
function toInts(o){ const out={}; for(const k in o) out[k]=parseInt(o[k]||"0",10); return out; }
module.exports = async (req, res) => {
  try{
    const u = new URL(req.url, "http://x");
    const qid = u.searchParams.get("qid") || "";
    if(!qid) return res.status(400).json({ error:"missing qid" });
    const key = "words:" + qid;

    if(req.method === "POST"){
      let w = (u.searchParams.get("w") || "").toLowerCase().replace(/[^a-z0-9\- ]/g,"").trim().slice(0,24);
      if(!w) return res.status(400).json({ error:"missing w" });
      const j = await kv([["HINCRBY", key, w, "1"], ["HGETALL", key]]);
      if(!j) return res.status(503).json({ error:"no store" });
      return res.status(200).json({ words: toInts(hgetallToObj(j[1].result)) });
    }

    const j = await kv([["HGETALL", key]]);
    if(!j) return res.status(503).json({ error:"no store" });
    return res.status(200).json({ words: toInts(hgetallToObj(j[0].result)) });
  }catch(e){ return res.status(500).json({ error:String(e && e.message || e) }); }
};
