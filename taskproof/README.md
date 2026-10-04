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

### Optional: AI-assisted scoring & voice transcription

Two more env vars unlock AI features — the app works fine without them, those
parts just won't be available:

- `GEMINI_API_KEY` — a Google Gemini API key. Enables the "Get AI suggestion"
  button on the candidate review screen, which scores the response against
  your criteria and shows a justification per criterion. It's always a
  *suggestion* the reviewer can edit or ignore before saving — it never
  writes the final evaluation itself.
- `OPENAI_API_KEY` — an OpenAI API key (for Whisper). Enables automatic
  transcription of voice-simulation recordings right after a candidate
  submits one, so reviewers get readable text instead of only an audio file.

Get a Gemini key at https://aistudio.google.com/apikey (free tier available)
and an OpenAI key at https://platform.openai.com/api-keys (Whisper is
pay-per-use, a few cents per hour of audio). Add both as environment
variables wherever you host this (e.g. Render → your service → Environment).

## What's implemented (MVP scope from the spec)

- Auth: register/login/logout, role selection (Company vs Candidate),
  role-based route protection via middleware, bcrypt password hashing.
- Company: profile, job CRUD with Draft/Open/Closed status, simulation
  library (7 templates across Email/Chat/Voice + write-your-own with custom
  criteria, format, and time limit), applicant list per job, candidate review
  with per-criterion scoring, AI-suggested scores (optional, see below),
  automatic total calculation, reviewer notes, recruitment status pipeline
  (Applied → Simulation Pending → Simulation Submitted → Reviewed →
  Shortlisted / Rejected), HR dashboard with counts.
- Candidate: profile with optional CV upload (access-controlled download,
  not publicly reachable), browse/apply to open jobs, duplicate-application
  prevention, timed simulation workspace across three formats, candidate
  dashboard.
- **Simulation formats**: Email and Chat work the same way under the hood —
  read a scenario, type a reply — styled differently. Voice has the
  candidate record a spoken reply with their microphone; it's uploaded and,
  if `OPENAI_API_KEY` is set, transcribed automatically with Whisper so
  reviewers get text, not just audio.
- **Timer / anti-fabrication measures**: each simulation has a time limit
  (companies set it, 60s is the suggested default). The candidate reads the
  scenario at their own pace, then clicks "Start" — only then does the clock
  start and the input/recording appear. Pasting into the text response is
  blocked, and the response auto-submits (whatever exists at that moment)
  the instant the timer hits zero, with no way to pause or extend it. This
  is a *deterrent*, not a guarantee — nothing running in a browser can stop
  someone from asking an AI on a second device and typing fast — but
  combined with a tight 60-second limit it rules out the easy version of
  that (copy an AI answer into the same tab).
- AI-suggested evaluation scores (optional, needs `GEMINI_API_KEY`): on the
  review screen, "Get AI suggestion" scores the response against your actual
  criteria and shows a one-line justification per criterion plus overall
  notes. It's always a draft the human reviewer can accept, edit, or
  ignore — the saved evaluation is still whatever the reviewer submits.
- Security basics from your spec: hashed passwords, httpOnly signed session
  cookies, role-based access control enforced in middleware *and* again in
  every server action (defense in depth), CVs and voice recordings served
  only to the owning company through authenticated routes.

Not implemented yet: live two-way voice calls (today's "voice test" is one
recorded reply, not a real-time back-and-forth), live multi-turn chat with
an AI playing the other side (today's "chat" is one reply, like email but
styled as chat), payments/billing, ATS integrations, multi-reviewer
workflows, candidate behavior analysis beyond the timer/paste signals above.

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
