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

## What's implemented (MVP scope from the spec)

- Auth: register/login/logout, role selection (Company vs Candidate),
  role-based route protection via middleware, bcrypt password hashing.
- Company: profile, job CRUD with Draft/Open/Closed status, simulation
  library (5 templates + write-your-own with custom criteria), applicant
  list per job, candidate review with per-criterion scoring, automatic total
  calculation, reviewer notes, recruitment status pipeline (Applied →
  Simulation Pending → Simulation Submitted → Reviewed → Shortlisted /
  Rejected), HR dashboard with counts.
- Candidate: profile with optional CV upload (access-controlled download,
  not publicly reachable), browse/apply to open jobs, duplicate-application
  prevention, simulation workspace (save draft / submit final, locked after
  submission), candidate dashboard.
- Security basics from your spec: hashed passwords, httpOnly signed session
  cookies, role-based access control enforced in middleware *and* again in
  every server action (defense in depth), CVs served only to the owning
  company through an authenticated route.

Not implemented yet (explicitly out-of-scope in your spec too): AI scoring,
payments/billing, ATS integrations, multi-reviewer workflows, candidate
behavior analysis. These are all listed as "Future Phase" in the SRS.

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
