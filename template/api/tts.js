// /api/tts — natural-voice text-to-speech (OpenAI). Reads OPENAI_API_KEY.
// POST { text, voice? } -> audio/mpeg (mp3 bytes)
// If OPENAI_API_KEY is not set, returns 503 and the client falls back to the
// browser's built-in (robotic) speech synthesis, so Listen mode still works.
const MODEL = "gpt-4o-mini-tts";   // natural + inexpensive. Fallback option: "tts-1".
const DEFAULT_VOICE = "alloy";     // alloy | echo | fable | onyx | nova | shimmer

function readBody(req){
  return new Promise((resolve)=>{
    if(req.body){ return resolve(typeof req.body==="string"?JSON.parse(req.body):req.body); }
    let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ try{ resolve(JSON.parse(d||"{}")); }catch{ resolve({}); } });
  });
}

module.exports = async (req, res) => {
  try{
    if(req.method !== "POST") return res.status(405).json({ error:"POST only" });
    const key = process.env.OPENAI_API_KEY;
    if(!key) return res.status(503).json({ error:"OPENAI_API_KEY not set on the server" });

    const b = await readBody(req);
    const text = (b.text||"").toString().slice(0,4000).trim();
    if(!text) return res.status(400).json({ error:"empty text" });
    const voice = (b.voice||DEFAULT_VOICE).toString().slice(0,20);

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method:"POST",
      headers:{ "content-type":"application/json", "authorization":"Bearer "+key },
      body: JSON.stringify({ model:MODEL, voice, input:text, response_format:"mp3" })
    });
    if(!r.ok){
      const t = await r.text();
      return res.status(502).json({ error:"openai "+r.status, detail:t.slice(0,300) });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("cache-control", "no-store");
    return res.status(200).send(buf);
  }catch(e){ return res.status(500).json({ error:String(e && e.message || e) }); }
};
