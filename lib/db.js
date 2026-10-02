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

CREATE TABLE IF NOT EXISTS Application (
  id TEXT PRIMARY KEY,
  jobId TEXT NOT NULL REFERENCES Job(id),
  candidateId TEXT NOT NULL REFERENCES CandidateProfile(id),
  status TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','SIMULATION_PENDING','SIMULATION_SUBMITTED','REVIEWED','SHORTLISTED','REJECTED')),
  appliedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(jobId, candidateId)
);

CREATE TABLE IF NOT EXISTS SimulationAttempt (
  id TEXT PRIMARY KEY,
  applicationId TEXT UNIQUE NOT NULL REFERENCES Application(id),
  simulationId TEXT NOT NULL REFERENCES Simulation(id),
  responseText TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','SUBMITTED')),
  startedAt TEXT,
  submittedAt TEXT
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
`;

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
];

const DEFAULT_CRITERIA = [
  { name: "Problem Understanding", description: "Grasps the core issue and its impact.", maxScore: 5 },
  { name: "Decision Quality", description: "Chooses a sound, workable course of action.", maxScore: 5 },
  { name: "Communication", description: "Clear, professional, appropriately toned.", maxScore: 5 },
  { name: "Prioritization", description: "Sequences actions sensibly under pressure.", maxScore: 5 },
  { name: "Professionalism", description: "Ownership, tone, and composure.", maxScore: 5 },
];

function seed(db) {
  const count = db.prepare("SELECT COUNT(*) as c FROM Simulation WHERE isTemplate = 1").get().c;
  if (count > 0) return;
  const insertSim = db.prepare(
    `INSERT INTO Simulation (id, companyId, isTemplate, title, description, instructions, senderName, senderRole, emailSubject, emailBody)
     VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCrit = db.prepare(
    `INSERT INTO EvaluationCriterion (id, simulationId, name, description, maxScore, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const t of TEMPLATES) {
    const simId = id();
    insertSim.run(simId, t.title, t.description, t.instructions, t.senderName, t.senderRole, t.emailSubject, t.emailBody);
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
