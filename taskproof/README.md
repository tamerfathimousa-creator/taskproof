# TaskProof

Workplace-simulation hiring platform: companies post jobs with a realistic
simulated task, candidates apply and submit a written response, and HR scores
that response against structured criteria.

This is a working full-stack app: real signup/login (bcrypt-hashed passwords,
signed session cookies), a real database, and the complete MVP workflow from
your spec (company + candidate roles, job/simulation management, application
flow, evaluation and scoring, both dashboards).

## Stack

- **Next.js 14** (App Router, JavaScript, Server Actions) — one full-stack app,
  no separate API layer needed.
- **Node's built-in `node:sqlite`** for storage — zero external services to
  set up, a single `data.db` file. Good for the 50–100 company / ~1,000
  candidate scale in your MVP spec. Swappable for Postgres later (see below).
- **bcryptjs** for password hashing, **jose** for signed session cookies.
- **Tailwind CSS** for styling.

## Running it locally

```bash
npm install
npm run build
npm start        # production server on http://localhost:3000
```

or for development with hot reload: `npm run dev`.

On first run the database (`data.db`) is created automatically and seeded
with the 5 predefined simulation templates from your spec (Handling an
Unhappy Customer, Prioritizing Conflicting Tasks, Responding to a Manager
Request, Solving an Operational Problem, Handling an Urgent Deadline), each
with the 5 default evaluation criteria (Problem Understanding, Decision
Quality, Communication, Prioritization, Professionalism — 25 points total).

Set `SESSION_SECRET` in `.env` to a long random string before going live —
the committed one is a placeholder.

### Optional: AI-assisted conversation, scoring & voice transcription

Three env vars unlock AI features — the app works fine without any of them,
those parts just degrade gracefully (a neutral fallback line keeps a
multi-step conversation moving; "Get AI suggestion" shows a clear error
instead of crashing):

- `GEMINI_API_KEY` — a Google Gemini API key. Used only to play the "other
  side" of a multi-step chat/voice simulation: after each candidate reply, it
  generates the next message from the scenario's persona (a real, sometimes
  surprising reaction — not a scripted line), so the candidate has to keep
  adapting instead of reciting a prepared answer. Each call gives Gemini the
  scenario's description and candidate-facing instructions in addition to the
  opening message, the conversation so far, and the candidate's latest
  reply — so its reaction stays grounded in what the simulation is actually
  testing, not just the raw scenario text.
- `OPENROUTER_API_KEY` — an OpenRouter API key. Powers the "Get AI
  suggestion" button on the candidate review screen via **Jev** (by
  TypeSafe), a calibrated judgment model rather than a chat model — it
  returns a score + confidence per criterion instead of free-form text. It's
  always a *suggestion* the reviewer can edit or ignore before saving — it
  never writes the final evaluation itself. (Optional `JEV_MODEL` env var to
  pin a specific version; defaults to `typesafe/jev-1.13`.)
- `OPENAI_API_KEY` — an OpenAI API key (for Whisper). Enables automatic
  transcription of voice-simulation recordings right after a candidate
  submits one, so reviewers get readable text instead of only an audio file.

Get a Gemini key at https://aistudio.google.com/apikey (free tier available),
an OpenRouter key at https://openrouter.ai/keys, and an OpenAI key at
https://platform.openai.com/api-keys (Whisper is pay-per-use, a few cents per
hour of audio). Add all three as environment variables wherever you host this
(e.g. Render → your service → Environment). `GEMINI_MODEL` and
`WHISPER_MODEL` env vars remain available too, in case a model name is
retired or overloaded again — see the git history for that story.

## What's implemented (MVP scope from the spec)

- Auth: register/login/logout, role selection (Company vs Candidate),
  role-based route protection via middleware, bcrypt password hashing.
- Company: profile, job CRUD with Draft/Open/Closed status, **jobs can now
  carry several simulations**, completed by the candidate in a fixed order
  (one unlocks only once the one before is submitted), simulation library (8
  templates across Email/Chat/Voice + write-your-own with custom criteria,
  format, time limit, and conversation steps), applicant list per job,
  candidate review with per-criterion scoring across every attached
  simulation combined, AI-suggested scores (optional, see below), automatic
  total calculation, reviewer notes, recruitment status pipeline (Applied →
  Simulation Pending → Simulation Submitted → Reviewed → Shortlisted /
  Rejected), HR dashboard with counts.
- Candidate: profile with optional CV upload (access-controlled download,
  not publicly reachable), browse/apply to open jobs, duplicate-application
  prevention, timed simulation workspace across three formats, candidate
  dashboard.
- **Dual-language scenarios (English + Arabic)**: every simulation field
  (title, description, instructions, sender name/role, subject, message) has
  an optional Arabic counterpart. All 8 built-in templates ship with Arabic
  translations already filled in; a company writing its own simulation can
  leave any or all of the Arabic fields blank and that simulation stays
  English-only — nothing is required. Wherever a field has both languages,
  the candidate sees them shown together (English, then Arabic in `dir="rtl"`
  text) rather than a language picker. Candidate-facing UI chrome around the
  simulation itself (Start/Submit/Save-draft buttons, step labels, timer
  notices, the locked/unlocked simulation cards) is bilingual too. Dynamic,
  AI-generated follow-up messages in a multi-step conversation stay
  English-only, since there's no authored Arabic text to show for content
  Gemini generates live.
- **Simulation formats**: Email is a single read-and-reply. Chat and Voice
  can be single-shot the same way, or set to **2-3 conversation steps** — after
  each candidate reply, Gemini generates the next message from the
  scenario's persona live (a real, sometimes-surprising reaction: pushback,
  a new constraint, an unexpected objection), so the candidate can't
  pattern-match a rehearsed script and has to keep actually solving the
  problem. Voice recordings are uploaded per step and, if `OPENAI_API_KEY`
  is set, transcribed automatically with Whisper so reviewers get text, not
  just audio; the AI persona's follow-up is always shown as text, even in a
  voice simulation, to avoid a speech-synthesis dependency.
- **Timer / anti-fabrication measures**: each simulation has a time limit per
  reply (companies set it, 60s is the suggested default). Critically, **the
  scenario content itself is only sent to the candidate's browser once they
  click Start** — not hidden with CSS, actually withheld server-side until
  then — so there's no way to read it, go ask an AI elsewhere, and come back
  with an answer ready before the clock starts. For a multi-step
  conversation, the same principle applies to every later step too: the next
  prompt and its timer both start the instant the AI's follow-up is
  generated, with no pause in between. Pasting into the text response is
  blocked, and the response auto-submits (whatever exists at that moment)
  the instant the timer hits zero, with no way to pause or extend it. This
  is a *deterrent*, not a guarantee — nothing running in a browser can stop
  someone from asking an AI on a second device and typing fast — but
  combined with a tight timer and no-read-ahead, it rules out the easy
  version of that.
- AI-suggested evaluation scores (optional, needs `OPENROUTER_API_KEY`): on
  the review screen, "Get AI suggestion" scores the response against your
  actual criteria via Jev and shows a score + confidence per criterion, plus
  a short overall note. It's always a draft the human reviewer can accept,
  edit, or ignore — the saved evaluation is still whatever the reviewer
  submits.
- Security basics from your spec: hashed passwords, httpOnly signed session
  cookies, role-based access control enforced in middleware *and* again in
  every server action (defense in depth) — including server-side
  enforcement of simulation order, so a candidate can't skip ahead by
  calling an action directly — CVs and voice recordings served only to the
  owning company through authenticated routes.

Not implemented yet: live two-way (real-time) voice calls — today's
multi-step voice is still turn-based (record, wait for the reply, record
again), not a continuous call; payments/billing; ATS integrations;
multi-reviewer workflows; candidate behavior analysis beyond the
timer/paste/no-read-ahead signals above.

## Going live for real customers

This app runs great as-is, but it needs to live somewhere permanent with a
real domain — this build environment is temporary. Two practical paths:

**Fastest — Vercel:**
1. Push this folder to a GitHub repo.
2. Import it on vercel.com (free tier is plenty to start).
3. One catch: Vercel's serverless functions use an ephemeral filesystem, so
   the SQLite file won't persist between deploys/requests reliably there.
   Swap the DB layer (`lib/db.js`) for a hosted Postgres — Vercel Postgres,
   Supabase, or Neon all have generous free tiers — and update the queries
   (they're plain SQL already, so this is a driver swap, not a rewrite).

**Simplest — a persistent VM (Railway, Render, a small DigitalOcean droplet, etc.):**
Since these keep a persistent filesystem, `data.db` works exactly as-is —
`npm install && npm run build && npm start` behind their standard deploy
flow, no database migration needed to launch. This is the quicker route to
a real, live URL if you want to start taking real signups this week.

Either way, once you have hosting picked, I can do the deployment directly if
you share the relevant account access (a Vercel token, or SSH/API access to
a VM) — happy to walk through whichever you'd rather do.
