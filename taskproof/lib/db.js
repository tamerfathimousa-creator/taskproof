import { DatabaseSync } from "node:sqlite";
import path from "path";
import { randomUUID } from "crypto";

const DB_PATH = path.join(process.cwd(), "data.db");

function id() {
  return randomUUID();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('COMPANY','CANDIDATE')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Company (
  id TEXT PRIMARY KEY,
  userId TEXT UNIQUE NOT NULL REFERENCES User(id),
  name TEXT NOT NULL,
  description TEXT,
  industry TEXT,
  logoUrl TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS CandidateProfile (
  id TEXT PRIMARY KEY,
  userId TEXT UNIQUE NOT NULL REFERENCES User(id),
  fullName TEXT NOT NULL,
  phone TEXT,
  location TEXT,
  currentTitle TEXT,
  summary TEXT,
  cvUrl TEXT,
  cvName TEXT
);

CREATE TABLE IF NOT EXISTS Simulation (
  id TEXT PRIMARY KEY,
  companyId TEXT REFERENCES Company(id),
  isTemplate INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  senderName TEXT NOT NULL,
  senderRole TEXT NOT NULL,
  emailSubject TEXT NOT NULL,
  emailBody TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL','CHAT','VOICE')),
  timeLimitSeconds INTEGER NOT NULL DEFAULT 60,
  totalSteps INTEGER NOT NULL DEFAULT 1 CHECK (totalSteps IN (1,2,3)),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS EvaluationCriterion (
  id TEXT PRIMARY KEY,
  simulationId TEXT NOT NULL REFERENCES Simulation(id),
  name TEXT NOT NULL,
  description TEXT,
  maxScore INTEGER NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Job (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL REFERENCES Company(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  department TEXT,
  location TEXT,
  employmentType TEXT,
  requiredSkills TEXT,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED')),
  simulationId TEXT REFERENCES Simulation(id),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A job can now carry several simulations, run in a fixed order. simulationId
-- above is kept (unused going forward) only so old rows/queries don't break;
-- migrate() backfills this table from it once.
CREATE TABLE IF NOT EXISTS JobSimulation (
  id TEXT PRIMARY KEY,
  jobId TEXT NOT NULL REFERENCES Job(id),
  simulationId TEXT NOT NULL REFERENCES Simulation(id),
  sortOrder INTEGER NOT NULL DEFAULT 0,
  UNIQUE(jobId, simulationId)
);

CREATE TABLE IF NOT EXISTS Application (
  id TEXT PRIMARY KEY,
  jobId TEXT NOT NULL REFERENCES Job(id),
  candidateId TEXT NOT NULL REFERENCES CandidateProfile(id),
  status TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','SIMULATION_PENDING','SIMULATION_SUBMITTED','REVIEWED','SHORTLISTED','REJECTED')),
  appliedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(jobId, candidateId)
);

-- An application can now have one attempt per simulation attached to its job
-- (a job may carry several), so the old UNIQUE(applicationId) is gone in
-- favor of UNIQUE(applicationId, simulationId). currentStep/currentStepStartedAt
-- support multi-turn chat/voice: each step gets its own revealed-at timestamp
-- so the per-step timer is enforced server-side.
CREATE TABLE IF NOT EXISTS SimulationAttempt (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES Application(id),
  simulationId TEXT NOT NULL REFERENCES Simulation(id),
  responseText TEXT,
  audioUrl TEXT,
  audioName TEXT,
  transcript TEXT,
  transcriptError TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','SUBMITTED')),
  currentStep INTEGER NOT NULL DEFAULT 1,
  currentStepStartedAt TEXT,
  startedAt TEXT,
  submittedAt TEXT,
  UNIQUE(applicationId, simulationId)
);

-- One row per reply in a multi-step chat/voice conversation: the candidate's
-- reply for a step, and (for all but the last step) the AI persona's
-- generated follow-up for that same step, which becomes the prompt for the
-- next one.
CREATE TABLE IF NOT EXISTS SimulationTurn (
  id TEXT PRIMARY KEY,
  attemptId TEXT NOT NULL REFERENCES SimulationAttempt(id),
  stepIndex INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('CANDIDATE','AI')),
  text TEXT,
  audioUrl TEXT,
  audioName TEXT,
  transcript TEXT,
  transcriptError TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(attemptId, stepIndex, speaker)
);

CREATE TABLE IF NOT EXISTS Evaluation (
  id TEXT PRIMARY KEY,
  applicationId TEXT UNIQUE NOT NULL REFERENCES Application(id),
  reviewerId TEXT NOT NULL REFERENCES User(id),
  totalScore INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS EvaluationScore (
  id TEXT PRIMARY KEY,
  evaluationId TEXT NOT NULL REFERENCES Evaluation(id),
  criterionId TEXT NOT NULL REFERENCES EvaluationCriterion(id),
  score INTEGER NOT NULL,
  UNIQUE(evaluationId, criterionId)
);

CREATE TABLE IF NOT EXISTS AiSuggestion (
  id TEXT PRIMARY KEY,
  applicationId TEXT UNIQUE NOT NULL REFERENCES Application(id),
  scoresJson TEXT NOT NULL,
  notes TEXT,
  model TEXT,
  error TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const CHANNELS = ["EMAIL", "CHAT", "VOICE"];

// Columns added after the first release. CREATE TABLE IF NOT EXISTS above
// covers brand-new databases; existing ones (already deployed, already have
// rows) need these added in place without losing data.
function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function migrate(db) {
  if (!columnExists(db, "Simulation", "channel")) {
    db.exec("ALTER TABLE Simulation ADD COLUMN channel TEXT NOT NULL DEFAULT 'EMAIL'");
  }
  if (!columnExists(db, "Simulation", "timeLimitSeconds")) {
    db.exec("ALTER TABLE Simulation ADD COLUMN timeLimitSeconds INTEGER NOT NULL DEFAULT 60");
  }
  if (!columnExists(db, "SimulationAttempt", "audioUrl")) {
    db.exec("ALTER TABLE SimulationAttempt ADD COLUMN audioUrl TEXT");
  }
  if (!columnExists(db, "SimulationAttempt", "audioName")) {
    db.exec("ALTER TABLE SimulationAttempt ADD COLUMN audioName TEXT");
  }
  if (!columnExists(db, "SimulationAttempt", "transcript")) {
    db.exec("ALTER TABLE SimulationAttempt ADD COLUMN transcript TEXT");
  }
  if (!columnExists(db, "SimulationAttempt", "transcriptError")) {
    db.exec("ALTER TABLE SimulationAttempt ADD COLUMN transcriptError TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS AiSuggestion (
      id TEXT PRIMARY KEY,
      applicationId TEXT UNIQUE NOT NULL REFERENCES Application(id),
      scoresJson TEXT NOT NULL,
      notes TEXT,
      model TEXT,
      error TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  if (!columnExists(db, "Simulation", "totalSteps")) {
    db.exec("ALTER TABLE Simulation ADD COLUMN totalSteps INTEGER NOT NULL DEFAULT 1");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS JobSimulation (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL REFERENCES Job(id),
      simulationId TEXT NOT NULL REFERENCES Simulation(id),
      sortOrder INTEGER NOT NULL DEFAULT 0,
      UNIQUE(jobId, simulationId)
    );
  `);
  // Backfill: every job that had the old single simulationId gets one
  // JobSimulation row for it, if it doesn't already have one. Safe to run on
  // every boot — it only inserts what's missing.
  {
    const jobsWithSim = db.prepare("SELECT id, simulationId FROM Job WHERE simulationId IS NOT NULL").all();
    const already = db.prepare("SELECT 1 FROM JobSimulation WHERE jobId = ? AND simulationId = ?");
    const insertJS = db.prepare(
      "INSERT INTO JobSimulation (id, jobId, simulationId, sortOrder) VALUES (?, ?, ?, 0)"
    );
    for (const j of jobsWithSim) {
      if (!already.get(j.id, j.simulationId)) insertJS.run(id(), j.id, j.simulationId);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS SimulationTurn (
      id TEXT PRIMARY KEY,
      attemptId TEXT NOT NULL REFERENCES SimulationAttempt(id),
      stepIndex INTEGER NOT NULL,
      speaker TEXT NOT NULL CHECK (speaker IN ('CANDIDATE','AI')),
      text TEXT,
      audioUrl TEXT,
      audioName TEXT,
      transcript TEXT,
      transcriptError TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(attemptId, stepIndex, speaker)
    );
  `);

  // SimulationAttempt used to have UNIQUE(applicationId) — one attempt per
  // application. A job can now carry several simulations, so an application
  // needs one attempt per attached simulation instead. SQLite can't drop an
  // inline UNIQUE constraint with ALTER TABLE, so rebuild the table: copy
  // every existing row across unchanged, then swap it in. Gated on
  // `currentStep` not existing yet, so this runs exactly once per database.
  if (!columnExists(db, "SimulationAttempt", "currentStep")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      db.exec(`
        CREATE TABLE SimulationAttempt_new (
          id TEXT PRIMARY KEY,
          applicationId TEXT NOT NULL REFERENCES Application(id),
          simulationId TEXT NOT NULL REFERENCES Simulation(id),
          responseText TEXT,
          audioUrl TEXT,
          audioName TEXT,
          transcript TEXT,
          transcriptError TEXT,
          status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','SUBMITTED')),
          currentStep INTEGER NOT NULL DEFAULT 1,
          currentStepStartedAt TEXT,
          startedAt TEXT,
          submittedAt TEXT,
          UNIQUE(applicationId, simulationId)
        );
      `);
      db.exec(`
        INSERT INTO SimulationAttempt_new
          (id, applicationId, simulationId, responseText, audioUrl, audioName, transcript, transcriptError, status, currentStep, currentStepStartedAt, startedAt, submittedAt)
        SELECT id, applicationId, simulationId, responseText, audioUrl, audioName, transcript, transcriptError, status,
               1, NULL, startedAt, submittedAt
        FROM SimulationAttempt;
      `);
      db.exec("DROP TABLE SimulationAttempt;");
      db.exec("ALTER TABLE SimulationAttempt_new RENAME TO SimulationAttempt;");
      db.exec("COMMIT;");
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

const TEMPLATES = [
  {
    title: "Handling an Unhappy Customer",
    description: "A client's order is late and they are demanding a refund today.",
    instructions: "Read the email below and reply as you would if this landed in your inbox at work.",
    senderName: "Mona Ibrahim",
    senderRole: "Operations Manager",
    emailSubject: "Urgent: client escalation — order #4821 is 5 days late",
    emailBody:
      "Hi,\n\nOrder #4821 is now five days late and the client is furious, demanding a refund today. Can you tell me how you'd handle it, step by step, and what exactly you'd say to the client?\n\nThanks,\nMona",
  },
  {
    title: "Prioritizing Conflicting Tasks",
    description: "Two urgent requests land at the same time and only one can go first.",
    instructions: "Read the email below and reply explaining how you would prioritize and why.",
    senderName: "Karim Adel",
    senderRole: "Team Lead",
    emailSubject: "Two urgent asks, need your call",
    emailBody:
      "Hey,\n\nFinance needs the expense report in the next hour or payroll is delayed, but the client call in 20 minutes needs a demo you haven't finished. I can't do both. What's your plan?\n\n— Karim",
  },
  {
    title: "Responding to a Manager Request",
    description: "A manager asks for something with an unrealistic deadline.",
    instructions: "Read the email below and write your reply.",
    senderName: "Laila Hassan",
    senderRole: "Department Head",
    emailSubject: "Can you turn this around by tomorrow morning?",
    emailBody:
      "Hi,\n\nI need the full Q3 summary deck ready for the board by tomorrow 9am. I know it's short notice. Can you make it happen, and if not, what do you suggest?\n\nLaila",
  },
  {
    title: "Solving an Operational Problem",
    description: "A recurring process failure is causing repeated delays.",
    instructions: "Read the email below and propose how you'd fix it.",
    senderName: "Youssef Nabil",
    senderRole: "Operations Director",
    emailSubject: "Same shipping error, third time this month",
    emailBody:
      "Hi,\n\nWe've had the same mislabeled-shipment error three times this month, each time costing us a client's trust. What would you do to actually fix this, not just patch it?\n\nYoussef",
  },
  {
    title: "Handling an Urgent Deadline",
    description: "A deliverable is due today and there isn't enough time left.",
    instructions: "Read the email below and reply with your plan.",
    senderName: "Nadia Farouk",
    senderRole: "Project Manager",
    emailSubject: "Launch is today — status?",
    emailBody:
      "Hi,\n\nWe launch at 5pm today and I just found out two tasks are still incomplete. What's your plan to get us there, and what should I tell the client if we can't?\n\nNadia",
  },
  {
    title: "Last-Minute Schedule Change",
    description: "A coworker messages you in chat needing an immediate answer about covering a shift.",
    instructions: "Reply in the chat below like you would to a real coworker message — quick, natural, and to the point. You have 60 seconds.",
    senderName: "Sara Mahmoud",
    senderRole: "Shift Lead",
    emailSubject: "need you to cover 2pm-6pm today, can you?",
    emailBody:
      "hey! so sorry for the short notice but Hossam just called in sick and we're uncovered 2-6pm today. any chance you can take it? if not I need to know right now so I can call someone else",
    channel: "CHAT",
    timeLimitSeconds: 60,
    totalSteps: 2,
  },
  {
    title: "Calming an Angry Caller",
    description: "A manager gives you a heads-up that an angry customer is about to call, and you need to talk them down.",
    instructions:
      "Read the situation below, then press record and speak your reply out loud as you would on an actual phone call. You'll have 60 seconds — speak naturally, like you're really on the call.",
    senderName: "Tarek Fouad",
    senderRole: "Customer Support Lead",
    emailSubject: "Heads up — angry customer calling you next",
    emailBody:
      "The customer on line 2 has been waiting three weeks for a replacement part and just found out it's delayed again. I'm transferring them to you now. Talk them down and tell them what happens next.",
    channel: "VOICE",
    timeLimitSeconds: 60,
    totalSteps: 2,
  },
];

const DEFAULT_CRITERIA = [
  { name: "Problem Understanding", description: "Grasps the core issue and its impact.", maxScore: 5 },
  { name: "Decision Quality", description: "Chooses a sound, workable course of action.", maxScore: 5 },
  { name: "Communication", description: "Clear, professional, appropriately toned.", maxScore: 5 },
  { name: "Prioritization", description: "Sequences actions sensibly under pressure.", maxScore: 5 },
  { name: "Professionalism", description: "Ownership, tone, and composure.", maxScore: 5 },
];

function seed(db) {
  // Additive: run every boot, but only insert templates that aren't there yet
  // (by title) so new templates (e.g. the chat/voice ones added later) reach
  // databases that were already seeded with the original 5 email templates.
  const existingTitles = new Set(
    db.prepare("SELECT title FROM Simulation WHERE isTemplate = 1").all().map((r) => r.title)
  );
  const insertSim = db.prepare(
    `INSERT INTO Simulation (id, companyId, isTemplate, title, description, instructions, senderName, senderRole, emailSubject, emailBody, channel, timeLimitSeconds, totalSteps)
     VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCrit = db.prepare(
    `INSERT INTO EvaluationCriterion (id, simulationId, name, description, maxScore, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const t of TEMPLATES) {
    if (existingTitles.has(t.title)) continue;
    const simId = id();
    insertSim.run(
      simId,
      t.title,
      t.description,
      t.instructions,
      t.senderName,
      t.senderRole,
      t.emailSubject,
      t.emailBody,
      t.channel || "EMAIL",
      t.timeLimitSeconds || 60,
      t.totalSteps || 1
    );
    DEFAULT_CRITERIA.forEach((c, i) => {
      insertCrit.run(id(), simId, c.name, c.description, c.maxScore, i);
    });
  }
}

let _db;

export function getDb() {
  if (globalThis.__taskproofDb) {
    _db = globalThis.__taskproofDb;
    return _db;
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  globalThis.__taskproofDb = db;
  _db = db;
  return db;
}

export function newId() {
  return id();
}

// node:sqlite returns rows with a null prototype, which React's Server->Client
// serialization rejects ("Only plain objects... can be passed to Client
// Components"). Use these when a DB row/array is passed as a prop into a
// "use client" component.
export function plain(row) {
  return row == null ? row : { ...row };
}

export function plainAll(rows) {
  return rows.map((r) => ({ ...r }));
}

// Simulations attached to a job, in the fixed order the candidate must
// complete them in.
export function getJobSimulations(db, jobId) {
  return db
    .prepare(
      `SELECT Simulation.*, JobSimulation.sortOrder
       FROM JobSimulation JOIN Simulation ON Simulation.id = JobSimulation.simulationId
       WHERE JobSimulation.jobId = ?
       ORDER BY JobSimulation.sortOrder ASC`
    )
    .all(jobId);
}

// Replaces a job's attached-simulation list with simulationIds, in that
// order. Non-destructive to anything else: existing SimulationAttempt /
// Evaluation rows reference simulationId directly, not this join table, so
// re-ordering or removing a simulation here never deletes a candidate's
// past work on it.
export function setJobSimulations(db, jobId, simulationIds) {
  db.prepare("DELETE FROM JobSimulation WHERE jobId = ?").run(jobId);
  const insert = db.prepare(
    "INSERT INTO JobSimulation (id, jobId, simulationId, sortOrder) VALUES (?, ?, ?, ?)"
  );
  simulationIds.forEach((simId, i) => {
    if (simId) insert.run(id(), jobId, simId, i);
  });
}

// Every reply-and-response turn of a simulation attempt, in conversation
// order (the candidate's reply for a step, then the AI persona's follow-up
// for that same step).
export function getSimulationTurns(db, attemptId) {
  return db
    .prepare(
      `SELECT * FROM SimulationTurn WHERE attemptId = ?
       ORDER BY stepIndex ASC, CASE speaker WHEN 'CANDIDATE' THEN 0 ELSE 1 END ASC`
    )
    .all(attemptId);
}

// Every evaluation criterion across every simulation attached to an
// application (a job can carry several), in attempt order, so review/scoring
// covers all of them in one combined form.
export function getApplicationCriteria(db, applicationId) {
  const attempts = db
    .prepare("SELECT DISTINCT simulationId FROM SimulationAttempt WHERE applicationId = ?")
    .all(applicationId);
  const rows = [];
  for (const a of attempts) {
    rows.push(
      ...db.prepare("SELECT * FROM EvaluationCriterion WHERE simulationId = ? ORDER BY sortOrder").all(a.simulationId)
    );
  }
  return rows;
}

// Flattens a simulation's opening message plus every turn so far into one
// transcript string, for feeding to an evaluator model. Falls back to the
// old single-shot responseText/transcript columns for attempts submitted
// before multi-step conversations existed (no SimulationTurn rows).
export function buildConversationText(db, attempt, simulation) {
  const turns = getSimulationTurns(db, attempt.id);
  if (turns.length === 0) {
    return attempt.transcript || attempt.responseText || "";
  }
  const lines = [`${simulation.senderName}: ${simulation.emailBody}`];
  for (const t of turns) {
    if (t.speaker === "CANDIDATE") {
      lines.push(`Candidate: ${t.text || t.transcript || "(no reply)"}`);
    } else {
      lines.push(`${simulation.senderName}: ${t.text || ""}`);
    }
  }
  return lines.join("\n\n");
}
