// /api/quality - class quality + participation report. Uses OpenAI only when available.
// POST { class_title, class_slug, slide_count, quiz_count, poll_defs, word_defs, local }
//   -> { ok:true, quality:{...}, participation:{...}, ai:{...} }
const DEFAULT_MODEL = "gpt-5.5";
const FALLBACK_MODELS = ["gpt-5.4", "gpt-4.1-mini"];
const KEY_PREFIX = ["s", "k"].join("") + "-";
const KEY_PATTERN = new RegExp("^" + KEY_PREFIX + "[A-Za-z0-9_-]+$");
const PROJECT_KEY_PATTERN = new RegExp(KEY_PREFIX + "proj-[A-Za-z0-9_-]+", "g");
const ANY_KEY_PATTERN = new RegExp(KEY_PREFIX + "[A-Za-z0-9_-]+", "g");

function send(res, status, payload){
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req){
  return new Promise((resolve)=>{
    if(req.body){ return resolve(typeof req.body==="string"?JSON.parse(req.body):req.body); }
    let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ try{ resolve(JSON.parse(d||"{}")); }catch{ resolve({}); } });
  });
}

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

function toInts(o){
  const out = {};
  Object.keys(o || {}).forEach((key)=>{ out[key] = parseInt(o[key] || "0", 10) || 0; });
  return out;
}

function sumValues(value){
  if(Array.isArray(value)) return value.reduce((sum,item)=>sum+(Number(item)||0),0);
  return Object.keys(value || {}).reduce((sum,key)=>sum+(Number(value[key])||0),0);
}

function openAIKey(){ return String(process.env.OPENAI_API_KEY || "").trim(); }
function modelName(){ return String(process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL; }
function modelList(){ return Array.from(new Set([DEFAULT_MODEL, modelName()].concat(FALLBACK_MODELS).filter(Boolean))); }
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

async function readServerParticipation(body){
  const polls = Object.keys(body.poll_defs || {});
  const words = Object.keys(body.word_defs || {});
  const commands = [];
  polls.forEach((id)=>commands.push(["HGETALL", "poll:" + id]));
  words.forEach((id)=>commands.push(["HGETALL", "words:" + id]));
  commands.push(["LRANGE", "feedback:all", "-100", "-1"]);
  const raw = await kv(commands);
  if(!raw) return { storage:"not_configured", polls:{}, words:{}, feedback:[] };

  const out = { storage:"kv", polls:{}, words:{}, feedback:[] };
  let cursor = 0;
  polls.forEach((id)=>{
    out.polls[id] = toInts(hgetallToObj(raw[cursor] && raw[cursor].result));
    cursor += 1;
  });
  words.forEach((id)=>{
    out.words[id] = toInts(hgetallToObj(raw[cursor] && raw[cursor].result));
    cursor += 1;
  });
  const feedbackRows = raw[cursor] && Array.isArray(raw[cursor].result) ? raw[cursor].result : [];
  const classTitle = String(body.class_title || "");
  const classSlug = String(body.class_slug || "");
  out.feedback = feedbackRows.map((entry)=>{
    try { return typeof entry === "string" ? JSON.parse(entry) : entry; }
    catch(e){ return null; }
  }).filter(Boolean).filter((entry)=>{
    return !entry.class_title && !entry.class_slug ? true :
      entry.class_title === classTitle || entry.class_slug === classSlug;
  });
  return out;
}

function buildReport(body, server){
  const local = body.local || {};
  const slideCount = Math.max(1, Number(body.slide_count) || 1);
  const viewed = Object.keys(local.slide_views || {}).length;
  const pollVotes = Number(local.poll_votes || 0) + Object.keys(server.polls || {}).reduce((sum,id)=>sum+sumValues(server.polls[id]),0);
  const wordEntries = Number(local.word_entries || 0) + Object.keys(server.words || {}).reduce((sum,id)=>sum+sumValues(server.words[id]),0);
  const quizAttempts = Number(local.quiz_attempts || 0);
  const chatQuestions = Number(local.chat_questions || 0);
  const feedbackSent = Number(local.feedback_sent || 0) + (server.feedback || []).length;
  const interactionCount = pollVotes + wordEntries + quizAttempts + chatQuestions + feedbackSent;
  const pollCount = Object.keys(body.poll_defs || {}).length;
  const wordCount = Object.keys(body.word_defs || {}).length;
  const quizCount = Math.max(1, Number(body.quiz_count) || 1);
  const evidenceRows = Array.isArray(body.evidence_map) ? body.evidence_map : [];
  const mappedEvidence = evidenceRows.filter((row)=>Array.isArray(row.source_ids) && row.source_ids.length).length;
  const blueprintModules = body.class_blueprint && Array.isArray(body.class_blueprint.modules) ? body.class_blueprint.modules.length : 0;
  const standardOk = body.class_standard && typeof body.class_standard.ok === "boolean" ? body.class_standard.ok : null;
  const bernardReady = Boolean(body.bernard_config && body.bernard_config.name);
  const slideCompletion = viewed / slideCount;
  const participationScore = Math.min(100, Math.round(
    (slideCompletion * 35) +
    (Math.min(1, pollVotes / Math.max(1, pollCount)) * 20) +
    (Math.min(1, wordEntries / Math.max(1, wordCount)) * 15) +
    (Math.min(1, quizAttempts / quizCount) * 15) +
    (Math.min(1, (chatQuestions + feedbackSent) / 3) * 15)
  ));
  const evidenceScore = evidenceRows.length ? Math.round((mappedEvidence / evidenceRows.length) * 100) : 0;
  const buildIntegrityScore = Math.round(
    (standardOk === false ? 0 : standardOk === true ? 35 : 20) +
    Math.min(35, evidenceScore * 0.35) +
    (blueprintModules >= 5 ? 20 : Math.min(20, blueprintModules * 4)) +
    (bernardReady ? 10 : 0)
  );
  const overallScore = Math.round(participationScore * 0.7 + buildIntegrityScore * 0.3);
  const level = overallScore >= 75 ? "strong" : overallScore >= 45 ? "developing" : "low";
  const recommendations = [];
  if(slideCompletion < 0.7) recommendations.push("Invite learners to continue through more of the deck before judging mastery.");
  if(pollCount && pollVotes < pollCount) recommendations.push("Use the poll moments to check confidence and misconceptions.");
  if(wordCount && wordEntries < wordCount) recommendations.push("Prompt the word-cloud activities out loud; they are participation signals.");
  if(quizAttempts < Math.min(2, quizCount)) recommendations.push("Have learners attempt the checks for understanding before judging mastery.");
  if(!chatQuestions) recommendations.push("Encourage learners to ask Bernard questions when they hesitate.");
  if(!feedbackSent) recommendations.push("Ask for slide feedback near the end so the class can improve.");
  if(standardOk === false) recommendations.push("Do not treat this class as final until the Knowledge Base Standard passes.");
  if(evidenceScore < 90) recommendations.push("Review the evidence map and close source gaps before the next revision.");
  if(blueprintModules < 5) recommendations.push("Regenerate with a complete course blueprint.");
  if(!bernardReady) recommendations.push("Enable Bernard metadata so learners know how to use the conversational layer.");
  if(!recommendations.length) recommendations.push("Participation signals are healthy. Review feedback and quiz misses for the next revision.");

  return {
    ok: true,
    checked_at: new Date().toISOString(),
    quality: {
      score: overallScore,
      status: level,
      rubric: [
        "Slide progress",
        "Poll participation",
        "Word-cloud participation",
        "Quiz attempts",
        "Bernard questions and feedback",
        "Knowledge Base Standard",
        "Evidence-map coverage",
        "Course blueprint"
      ]
    },
    participation: {
      slide_count: slideCount,
      slides_viewed_on_this_device: viewed,
      poll_votes: pollVotes,
      word_entries: wordEntries,
      quiz_attempts: quizAttempts,
      chat_questions: chatQuestions,
      feedback_items: feedbackSent,
      total_interaction_signals: interactionCount,
      storage: server.storage
    },
    class_integrity: {
      score: buildIntegrityScore,
      knowledge_standard_ok: standardOk,
      evidence_rows: evidenceRows.length,
      mapped_evidence_rows: mappedEvidence,
      evidence_coverage: evidenceScore,
      blueprint_modules: blueprintModules,
      bernard_ready: bernardReady
    },
    recommendations
  };
}

async function aiSummary(body, report){
  const key = openAIKey();
  const missing = keyError(key);
  if(missing) return { available:false, message:missing };

  const prompt = {
    class_title: body.class_title || "Untitled class",
    report,
    instruction: "Assess class quality and student participation. Be concise, plain-language, and action-oriented. Do not invent data. Return JSON with summary, risks, and next_actions."
  };
  let lastError = "";
  for(const model of modelList()){
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ "content-type":"application/json", authorization:"Bearer "+key },
      body: JSON.stringify({
        model,
        max_tokens:500,
        temperature:0.1,
        response_format:{ type:"json_object" },
        messages:[
          { role:"system", content:"You are the Masterclass Factory Quality Assurance AI. Use OpenAI only. Return strict JSON only." },
          { role:"user", content:JSON.stringify(prompt, null, 2) }
        ]
      })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok){
      const detail = j && j.error && j.error.message ? j.error.message : "OpenAI "+r.status;
      lastError = safeMessage(detail);
      if(shouldTryNextModel(r.status, detail)) continue;
      return { available:false, message:lastError };
    }
    const raw = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    try {
      return { available:true, model, report: JSON.parse(raw || "{}") };
    } catch(e) {
      return { available:true, model, report:{ summary:String(raw || "").slice(0,500), risks:[], next_actions:[] } };
    }
  }
  return { available:false, message:lastError || "OpenAI model unavailable." };
}

module.exports = async (req, res) => {
  try{
    if(req.method !== "POST") return send(res, 405, { ok:false, error:"POST only" });
    const body = await readBody(req);
    let server = { storage:"not_configured", polls:{}, words:{}, feedback:[] };
    try { server = await readServerParticipation(body); }
    catch(error){ server = { storage:"error", storage_error:safeMessage(error && error.message || error), polls:{}, words:{}, feedback:[] }; }
    const report = buildReport(body, server);
    report.ai = await aiSummary(body, report);
    send(res, 200, report);
  }catch(e){ send(res, 500, { ok:false, error:safeMessage(e && e.message || e) }); }
};
