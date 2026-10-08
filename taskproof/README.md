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

### Built-in demo accounts (every build, out of the box)

The first time the app boots against a fresh `data.db`, three accounts and
one job opening are seeded automatically — no setup step required — so
there's always something to click into right away:

| Role            | Email                   | Password          |
| --------------- | ------------------------ | ----------------- |
| Admin           | `admin@taskproof.com`    | `taskproof&2026`  |
| Hiring manager  | `tamer@taskproof.com`    | `taskproof&2026`  |
| Candidate       | `ahmed@hotmail.com`      | `taskproof&2026`  |

The hiring manager owns a company called **Acme Support Co.** with one
already-**Open** job, **Customer Support Specialist** (department, location,
employment type, and required skills all pre-filled, attached to the
"Handling an Unhappy Customer" simulation), which the candidate account can
apply to immediately.

None of this is special-cased or locked — every field on every one of these
is an ordinary row, editable exactly like any other account: rename the
company, edit or close the job, attach different simulations, change the
candidate's profile, or change any of these passwords from the normal
profile/settings screens. Seeding only ever *fills in what's missing* (by
email for the accounts, by company + title for the job) on every boot, so an
edit you make sticks across restarts — it's never overwritten or
duplicated. If you don't want the demo admin account specifically, set your
own `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars (see below) and that account is
seeded instead of the demo one; the hiring-manager and candidate accounts
seed unconditionally either way.

### Admin account (backend-only, for oversight)

A single admin `User` row always exists after first boot (see above): either
the built-in `admin@taskproof.com` demo account, or — if you set
`ADMIN_EMAIL` and `ADMIN_PASSWORD` as environment variables before (or any
time after) first boot — your own, seeded instead. There's no public admin
signup, by design, either way. Log in at the normal `/login` page with those
credentials and you're redirected to `/admin/dashboard`: a read-only view
across *every* company's and candidate's data — companies, jobs,
applications, full scenario transcripts, saved evaluations, and both Jev's
and Claude's AI suggestions, including Jev's confidence figure that's
deliberately left out of the company-facing review screen (see below). The
admin account never sees company or candidate area pages, and nobody else
can reach `/admin`. Seeding never overwrites an existing account at that
email, so changing the admin password means deleting that row from
`data.db` first, then restarting with the new `ADMIN_PASSWORD` set (or your
own env vars).

### Optional: AI-assisted conversation, scoring & voice transcription

Four env vars unlock AI features — the app works fine without any of them,
those parts just degrade gracefully (a neutral fallback line keeps a
multi-step conversation moving; each "Get … suggestion" button shows a clear
error instead of crashing):

- `GEMINI_API_KEY` — a Google Gemini API key. Used only to play the "other
  side" of a multi-step chat/voice simulation: after each candidate reply, it
  generates the next message from the scenario's persona (a real, sometimes
  surprising reaction — not a scripted line), so the candidate has to keep
  adapting instead of reciting a prepared answer. Each call gives Gemini the
  scenario's description and candidate-facing instructions in addition to the
  opening message, the conversation so far, and the candidate's latest
  reply — so its reaction stays grounded in what the simulation is actually
  testing, not just the raw scenario text.
- `OPENROUTER_API_KEY` — an OpenRouter API key. Powers the "Get Jev
  suggestion" button on the candidate review screen via **Jev** (by
  TypeSafe), a calibrated judgment model rather than a chat model — it
  returns a score + confidence per criterion instead of free-form text. It's
  always a *suggestion* the reviewer can edit or ignore before saving — it
  never writes the final evaluation itself. **Jev's confidence number is kept
  out of the company-facing screen on purpose** — companies see only the
  score and a short justification; the raw confidence percentage is stored in
  the database and surfaced only in the admin account's view of that
  application (see Admin account, above). (Optional `JEV_MODEL` env var to
  pin a specific version; defaults to `typesafe/jev-1.13`.)
- `ANTHROPIC_API_KEY` — a Claude API key. Powers a second, independent "Get
  Claude suggestion" button right next to Jev's, so a reviewer can compare
  the two side by side rather than seeing only one AI's opinion. Where Jev
  returns typed scores with no reasoning text, Claude is asked to actually
  read the full exchange and write a genuine 1-2 sentence justification per
  criterion, citing something specific the candidate said or didn't say, plus
  a short overall note — a real second opinion, not a duplicate of Jev's
  output. It doesn't self-report a confidence number (an uncalibrated
  self-rating from a generative model isn't the same thing as Jev's
  calibrated probability, and showing one could be misleading), so its card
  shows "confidence unavailable" the same way the UI already handles any
  missing confidence. Each source is stored as its own row (one application
  can have a Jev suggestion, a Claude suggestion, both, or neither,
  independently regenerated and independently erroring), so clicking one
  button never touches the other's result. (Optional `CLAUDE_MODEL` env var
  to pin a specific version; defaults to `claude-sonnet-4-5`.)
- `OPENAI_API_KEY` — an OpenAI API key (for Whisper). Enables automatic
  transcription of voice-simulation recordings right after a candidate
  submits one, so reviewers get readable text instead of only an audio file.

Get a Gemini key at https://aistudio.google.com/apikey (free tier available),
an OpenRouter key at https://openrouter.ai/keys, a Claude key at
https://console.anthropic.com/settings/keys, and an OpenAI key at
https://platform.openai.com/api-keys (Whisper is pay-per-use, a few cents per
hour of audio). Add all four as environment variables wherever you host this
(e.g. Render → your service → Environment). `GEMINI_MODEL`, `CLAUDE_MODEL`,
and `WHISPER_MODEL` env vars remain available too, in case a model name is
retired or overloaded again — see the git history for that story.

## What's implemented (MVP scope from the spec)

- Auth: register/login/logout, role selection (Company vs Candidate),
  role-based route protection via middleware, bcrypt password hashing.
- Company: profile, job CRUD with Draft/Open/Closed status, **jobs can now
  carry several simulations**, completed by the candidate in a fixed order
  (one unlocks only once the one before is submitted), simulation library (10
  templates across Email/Chat/Voice + write-your-own with custom criteria,
  format, time limit, and conversation steps) that a company can also **edit
  after creating** (see below), applicant list per job,
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
  an optional Arabic counterpart. All 10 built-in templates ship with Arabic
  translations already filled in; a company writing its own simulation can
  leave any or all of the Arabic fields blank and that simulation stays
  English-only — nothing is required. Wherever a field has both languages,
  the candidate sees them shown together (English, then Arabic in `dir="rtl"`
  text) rather than a language picker. Candidate-facing UI chrome around the
  simulation itself (Start/Submit/Save-draft buttons, step labels, timer
  notices, the locked/unlocked simulation cards) is bilingual too. Dynamic,
  AI-generated follow-up messages in a multi-step conversation now **match
  whichever single language the candidate's own first reply was written
  in** — if they open in Arabic, Gemini stays in Arabic turn after turn; if
  they open in English, it stays in English. The language is locked in from
  that first reply rather than re-detected every turn, so the conversation
  can't drift between languages mid-exchange, and if Gemini is unreachable
  the neutral fallback line that keeps the conversation moving is also
  chosen in that same language.
- **Simulation formats**: Email is a single read-and-reply. Chat and voice
  simulations always run **at least a 3-message back-and-forth** (up to 4) —
  a company can no longer create a single-shot chat or voice test, so a
  candidate can't pass on one lucky reply. After each candidate reply,
  Gemini generates the next message from the scenario's persona live — the
  prompt explicitly pushes for tough, realistic, escalating reactions (a new
  complication, a sharper deadline, a stakeholder who disagrees, information
  that makes things worse) rather than a scripted, easily-resolved exchange,
  and it's told how many exchanges remain so it doesn't wrap things up early.
  The result is a genuinely interactive simulation of a hard real-life
  situation, not a pattern-matchable script. Voice recordings are uploaded
  per step and, if `OPENAI_API_KEY` is set, transcribed automatically with
  Whisper so reviewers get text, not just audio; the AI persona's follow-up
  is always shown as text, even in a voice simulation, to avoid a
  speech-synthesis dependency.
- **10 built-in scenario templates** across Email/Chat/Voice, including
  tougher ones added for realism: a client threatening to cancel a six-figure
  contract over chat (4 steps), an urgent workplace-safety phone call (3
  steps), and a social-media crisis unfolding in real time (3 steps) — on top
  of the original customer-service, prioritization, deadline, and
  schedule-change scenarios. All ten now give candidates 120 seconds (2
  minutes) per reply — up from the original 45-60s — and an existing database
  from before this change gets its already-seeded template rows bumped to the
  new limit automatically on next boot (a company's own custom simulations
  keep whatever time limit it chose and are never touched by that).
- **Editing an existing simulation**: a company can go back into any custom
  simulation it wrote (from Simulations → Your simulations → Edit) and change
  anything it set at creation — title/description/instructions, sender name
  and role, subject and scenario body (English and Arabic), channel, time
  limit, conversation steps, and evaluation criteria. Renaming or removing a
  criterion only affects new reviews; a criterion that already has a saved
  score against it is kept rather than deleted, so past evaluations never get
  orphaned. The shared template library can't be edited by companies — only
  simulations a company wrote itself — and one company can never edit
  another's.
- **Timer / anti-fabrication measures**: each simulation has a time limit per
  reply (companies set it, **120 seconds (2 minutes) is the suggested
  default** — enough time to think and type a real answer while still being
  short enough that pasting in an AI-written one isn't realistic). Critically, **the
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
- **One reply per step, guaranteed**: every step in a multi-step conversation
  issues a one-time token the moment it starts, and a reply has to echo it
  back to be accepted. A submission that doesn't carry the step's current
  token — e.g. the auto-submit-on-timeout firing just as a manual "Send
  reply" was already mid-flight for the same step — is silently dropped
  rather than recorded, so the same stale text can never land twice as two
  different steps' replies. This closes a real bug where that exact race
  could duplicate a candidate's reply across two steps (with two different
  AI follow-ups reacting to the same text, which is a dead giveaway to a
  reviewer that something glitched). The fix is defense in depth: the token
  check catches it even under a true tie, and the client also holds off
  firing the auto-submit at all while a submission it already knows about is
  still in flight.
- AI-suggested evaluation scores from **two independent sources**, shown side
  by side on the review screen: "Get Jev suggestion" (optional, needs
  `OPENROUTER_API_KEY`) scores the response against your actual criteria via
  Jev and shows a score + confidence per criterion, plus a short overall
  note; "Get Claude suggestion" (optional, needs `ANTHROPIC_API_KEY`) scores
  the same response independently via Claude, with a genuine written
  justification per criterion instead of a generic one-liner. Either, both,
  or neither can be generated for a given application — they're stored and
  regenerated independently, so one failing or being unconfigured never
  blocks the other. Both are always a draft the human reviewer can accept,
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
