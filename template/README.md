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
└── api/
    ├── chat.js       # AI tutor      (Anthropic)        — has tokens
    ├── grade.js      # AI grader     (Anthropic)        — has tokens; BAR ladder is generic, keep it
    ├── tts.js        # natural voice (OpenAI)           — no tokens
    ├── poll.js       # live polls    (Upstash Redis)    — no tokens
    ├── words.js      # word clouds   (Upstash Redis)    — no tokens
    └── feedback.js   # audience feedback (Upstash Redis)— no tokens
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
`ANTHROPIC_API_KEY` (chat+grade) · `OPENAI_API_KEY` (tts) · `KV_REST_API_URL` · `KV_REST_API_TOKEN` · `POLL_ADMIN_KEY`

> Provenance: derived from the shipped Texas Revolution deck, with all topic/audience strings replaced
> by tokens and the stale "Micro Data Centers" header comment fixed. Engine logic is unchanged.
