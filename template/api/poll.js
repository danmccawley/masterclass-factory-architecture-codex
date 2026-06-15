// /api/poll  — shared live poll tallies (Upstash Redis via KV_REST_API_* env vars)
// GET  ?qid=<id>&n=<numOptions>                -> { counts:[...] }
// POST ?qid=<id>&opt=<i>&n=<numOptions>         -> { counts:[...] }  (records a vote)
// POST ?qid=<id>&reset=1&key=<POLL_ADMIN_KEY>   -> { ok:true }       (clears a poll)
async function kv(commands){
  const base = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if(!base || !tok) return null;                       // no store -> caller falls back to local
  const r = await fetch(base.replace(/\/$/,"") + "/pipeline", {
    method:"POST",
    headers:{ Authorization:"Bearer "+tok, "Content-Type":"application/json" },
    body: JSON.stringify(commands)
  });
  if(!r.ok) throw new Error("kv "+r.status);
  return r.json();                                      // [{result:...}, ...]
}
function hgetallToObj(result){
  if(!result) return {};
  if(Array.isArray(result)){ const o={}; for(let i=0;i<result.length;i+=2) o[result[i]]=result[i+1]; return o; }
  return result;                                        // already an object
}
module.exports = async (req, res) => {
  try{
    const u = new URL(req.url, "http://x");
    const qid = u.searchParams.get("qid") || "";
    const n   = parseInt(u.searchParams.get("n") || "0", 10) || 0;
    if(!qid) return res.status(400).json({ error:"missing qid" });
    const key = "poll:" + qid;

    if(u.searchParams.get("reset")){
      if((u.searchParams.get("key")||"") !== (process.env.POLL_ADMIN_KEY||"\0"))
        return res.status(403).json({ error:"bad admin key" });
      await kv([["DEL", key]]);
      return res.status(200).json({ ok:true });
    }

    if(req.method === "POST"){
      const opt = parseInt(u.searchParams.get("opt") || "-1", 10);
      if(opt < 0) return res.status(400).json({ error:"missing opt" });
      const j = await kv([["HINCRBY", key, String(opt), "1"], ["HGETALL", key]]);
      if(!j) return res.status(503).json({ error:"no store" });
      const map = hgetallToObj(j[1].result);
      const counts = []; for(let i=0;i<n;i++) counts.push(parseInt(map[String(i)]||"0",10));
      return res.status(200).json({ counts });
    }

    // GET
    const j = await kv([["HGETALL", key]]);
    if(!j) return res.status(503).json({ error:"no store" });
    const map = hgetallToObj(j[0].result);
    const counts = []; for(let i=0;i<n;i++) counts.push(parseInt(map[String(i)]||"0",10));
    return res.status(200).json({ counts });
  }catch(e){ return res.status(500).json({ error:String(e && e.message || e) }); }
};
