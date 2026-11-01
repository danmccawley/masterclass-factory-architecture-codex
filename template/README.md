# template/ — the fixed engine bundle

These files are the **topic-agnostic engine**. The Factory copies this whole folder into a new deck,
drops the generated content layer (`content.js`, `glossary.js`, `source.js`) alongside them, fills
the placeholder tokens below, sets the env vars, and deploys. **Do not change engine logic** — only
substitute the tokens and add the content layer.

## Files
```
template/
├── index.html        # shell + design tokens + modal markup + <script> load order
├── engine.js         # the whole engine (render, nav, quizzes, polls, glossary, tutor, listen…)
├── navscrubber.js    # bottom progress scrubber (no tokens; reused as-is)
├── lib/
│   └── admin-auth.js # shared header-only owner authentication; required by poll.js
└── api/
    ├── chat.js       # Bernard tutor (OpenAI)           — has tokens
    ├── grade.js      # AI grader     (OpenAI)           — has tokens; BAR ladder is generic, keep it
    ├── tts.js        # natural voice (OpenAI)           — no tokens
    ├── poll.js       # live polls    (Upstash Redis)    — no tokens
    ├── words.js      # word clouds   (Upstash Redis)    — no tokens
    ├── feedback.js   # audience feedback (Upstash Redis)— no tokens
    └── quality.js    # quality + participation report   — no tokens
```
Load order (already wired in index.html): `content.js → glossary.js → source.js → engine.js → navscrubber.js`.

## Placeholder tokens (replace every occurrence per deck)
| Token | What it is | Where it appears | Example (Texas deck) |
|---|---|---|---|
| `{{CLASS_TITLE}}` | Full class title | index.html `<title>`, engine.js header | The Texas Revolution & the Alamo — Master Class |
| `{{TOPIC}}` | Short subject phrase | engine.js (greeting, select prompts, askAboutTerm), chat.js, grade.js | the Texas Revolution and the Alamo |
| `{{TOPIC_GREETING}}` | The tutor's one-line "ask me about…" detail | engine.js tutor greeting | the causes, the people (Austin, Santa Anna, Houston, Travis…), the Alamo, San Jacinto |
| `{{TOPIC_DESC}}` | One-sentence scope description | index.html `<meta>` + chat-modal desc | the causes, the people, the Alamo, San Jacinto, and the Republic of Texas |
| `{{TOPIC_SCOPE}}` | The "stay on these sub-areas" list for the tutor | api/chat.js system prompt | its causes (federalism, slavery, money, taxes…), the people, the Alamo, Goliad, San Jacinto, the Republic, Tejanos, Native nations |
| `{{TOPIC_HONESTY}}` | Topic-specific accuracy / sensitivity guidance | api/chat.js + api/grade.js | Treat slavery as the serious wrong it was, credit Tejano and Native peoples, and separate documented history from legend. |
| `{{AUDIENCE_LEVEL}}` | Reading-level descriptor (UPPERCASE in prompts) | api/chat.js + api/grade.js | MIDDLE-SCHOOL |
| `{{AUDIENCE_NOUN}}` | The learner, as a noun | api/grade.js feedback instruction | middle-schooler |

Generate `{{TOPIC*}}`, `{{AUDIENCE_*}}`, and `{{CLASS_TITLE}}` from the Course Brief
(`objectives`, `audience.floor`, `meta.title`). The `grade.js` BAR{} strictness ladder (Novice→SME)
is topic-agnostic — leave it exactly as-is.

## Verified engine contract (the content layer must match)
- `window.GLOSSARY = { term: { d, r } }` — objects, never bare strings.
- `window.SOURCE_PAPER = { title, cite, sections:[{id,num,title,body}] }` — one object; citations `data-src="sN"` resolve to a section id.
- Slide `paper` is a single object `{secnum,h,body}`.
- `window.POLLS` / `window.WORDS` deck-defined; quiz keys `type/level/q/options/answer/why` (+`rubric/sample/accept[]`).

## Env vars (set on the deck's Vercel project)
`OPENAI_API_KEY` (chat+grade+quality+tts) · optional `OPENAI_MODEL` (defaults to GPT-5.5) · `KV_REST_API_URL` · `KV_REST_API_TOKEN` · `POLL_ADMIN_KEY`

Poll reset: `POST /api/poll?qid=<id>&reset=1` over HTTPS with
`Authorization: Bearer <POLL_ADMIN_KEY>` or `x-admin-key: <POLL_ADMIN_KEY>`.
Raw `Authorization: <POLL_ADMIN_KEY>` remains supported for compatibility; `x-admin-key` takes
precedence if both are supplied. Query-string and body credentials are ignored. Reset fails
closed (403) if the configured key is missing/blank or authentication fails, and returns 405 for
non-POST resets. Ordinary reads and votes need no admin key. Include `lib/admin-auth.js` in each
standalone deployment, regenerate the affected entries in `api/template-embed.js` after changes,
and rebuild/redeploy existing standalone classes to apply this security update.

> Provenance: derived from the shipped Texas Revolution deck, with all topic/audience strings replaced
> by tokens and the stale "Micro Data Centers" header comment fixed. Engine logic is unchanged.
