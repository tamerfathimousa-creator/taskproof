import { DatabaseSync } from "node:sqlite";
import path from "path";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const DB_PATH = path.join(process.cwd(), "data.db");

function id() {
  return randomUUID();
}

const SCHEMA = `
-- ADMIN is a backend-only role: there's no public signup for it. An account
-- is seeded from ADMIN_EMAIL/ADMIN_PASSWORD env vars (see seedAdmin below) so
-- someone with server access can review every company's and candidate's
-- data — including things deliberately hidden from companies, like Jev's
-- raw confidence numbers.
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('COMPANY','CANDIDATE','ADMIN')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small key/value store for one-time migration flags that can't be detected
-- by checking column existence (e.g. a CHECK constraint baked into a table
-- that already exists can't be introspected via PRAGMA table_info).
CREATE TABLE IF NOT EXISTS Meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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

-- The *Ar columns are optional Arabic translations of the matching English
-- field: NULL for any simulation whose company (or template) hasn't supplied
-- one, so English-only simulations keep working exactly as before. Where
-- both are present, the candidate sees English + Arabic together.
CREATE TABLE IF NOT EXISTS Simulation (
  id TEXT PRIMARY KEY,
  companyId TEXT REFERENCES Company(id),
  isTemplate INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  titleAr TEXT,
  description TEXT NOT NULL,
  descriptionAr TEXT,
  instructions TEXT NOT NULL,
  instructionsAr TEXT,
  senderName TEXT NOT NULL,
  senderNameAr TEXT,
  senderRole TEXT NOT NULL,
  senderRoleAr TEXT,
  emailSubject TEXT NOT NULL,
  emailSubjectAr TEXT,
  emailBody TEXT NOT NULL,
  emailBodyAr TEXT,
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL','CHAT','VOICE')),
  timeLimitSeconds INTEGER NOT NULL DEFAULT 60,
  totalSteps INTEGER NOT NULL DEFAULT 1 CHECK (totalSteps IN (1,2,3,4)),
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

  // Optional Arabic translations, added after the first release — all
  // nullable, so an existing English-only simulation is unaffected.
  for (const col of [
    "titleAr",
    "descriptionAr",
    "instructionsAr",
    "senderNameAr",
    "senderRoleAr",
    "emailSubjectAr",
    "emailBodyAr",
  ]) {
    if (!columnExists(db, "Simulation", col)) {
      db.exec(`ALTER TABLE Simulation ADD COLUMN ${col} TEXT`);
    }
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS Meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // User.role used to be CHECK'd to ('COMPANY','CANDIDATE') only. That CHECK
  // is baked into the table at creation time and isn't visible to
  // PRAGMA table_info, so there's no column to gate on like the migrations
  // above — a Meta flag marks it done instead. Same rebuild-and-swap
  // approach as SimulationAttempt above: copy every row across unchanged,
  // then swap in a table whose CHECK also allows 'ADMIN'.
  if (!db.prepare("SELECT value FROM Meta WHERE key = 'userRoleIncludesAdmin'").get()) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      db.exec(`
        CREATE TABLE User_new (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('COMPANY','CANDIDATE','ADMIN')),
          createdAt TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec(`
        INSERT INTO User_new (id, email, passwordHash, role, createdAt)
        SELECT id, email, passwordHash, role, createdAt FROM User;
      `);
      db.exec("DROP TABLE User;");
      db.exec("ALTER TABLE User_new RENAME TO User;");
      db.prepare("INSERT INTO Meta (key, value) VALUES ('userRoleIncludesAdmin', '1')").run();
      db.exec("COMMIT;");
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

// Seeds (or leaves untouched) a single backend admin account from
// ADMIN_EMAIL/ADMIN_PASSWORD env vars. There's no public admin signup —
// this is the only way an admin account gets created. Idempotent and safe
// to call every boot: it never overwrites an existing account (admin or
// otherwise) at that email, so rotating the password here requires deleting
// the old row first.
function seedAdmin(db) {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password) return;
  const existing = db.prepare("SELECT id FROM User WHERE email = ?").get(email);
  if (existing) return;
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO User (id, email, passwordHash, role) VALUES (?, ?, ?, 'ADMIN')").run(
    id(),
    email,
    passwordHash
  );
}

const TEMPLATES = [
  {
    title: "Handling an Unhappy Customer",
    titleAr: "التعامل مع عميل غاضب",
    description: "A client's order is late and they are demanding a refund today.",
    descriptionAr: "تأخر طلب أحد العملاء وهو يطالب باسترداد أمواله اليوم.",
    instructions: "Read the email below and reply as you would if this landed in your inbox at work.",
    instructionsAr: "اقرأ البريد الإلكتروني أدناه ورُد كما لو وصلتك هذه الرسالة فعليًا في عملك.",
    senderName: "Mona Ibrahim",
    senderNameAr: "منى إبراهيم",
    senderRole: "Operations Manager",
    senderRoleAr: "مديرة العمليات",
    emailSubject: "Urgent: client escalation — order #4821 is 5 days late",
    emailSubjectAr: "عاجل: تصعيد من العميل — الطلب رقم 4821 متأخر 5 أيام",
    emailBody:
      "Hi,\n\nOrder #4821 is now five days late and the client is furious, demanding a refund today. Can you tell me how you'd handle it, step by step, and what exactly you'd say to the client?\n\nThanks,\nMona",
    emailBodyAr:
      "مرحبًا،\n\nالطلب رقم 4821 تأخر الآن خمسة أيام والعميل غاضب جدًا ويطالب باسترداد أمواله اليوم. هل يمكنك أن تخبرني كيف ستتعامل مع الأمر خطوة بخطوة، وماذا ستقول للعميل بالضبط؟\n\nشكرًا،\nمنى",
  },
  {
    title: "Prioritizing Conflicting Tasks",
    titleAr: "تحديد الأولويات بين مهام متعارضة",
    description: "Two urgent requests land at the same time and only one can go first.",
    descriptionAr: "يصل طلبان عاجلان في نفس الوقت ولا يمكن تنفيذ سوى أحدهما أولاً.",
    instructions: "Read the email below and reply explaining how you would prioritize and why.",
    instructionsAr: "اقرأ البريد الإلكتروني أدناه ورُد موضحًا كيف ستحدد الأولويات ولماذا.",
    senderName: "Karim Adel",
    senderNameAr: "كريم عادل",
    senderRole: "Team Lead",
    senderRoleAr: "قائد الفريق",
    emailSubject: "Two urgent asks, need your call",
    emailSubjectAr: "طلبان عاجلان، أحتاج قرارك",
    emailBody:
      "Hey,\n\nFinance needs the expense report in the next hour or payroll is delayed, but the client call in 20 minutes needs a demo you haven't finished. I can't do both. What's your plan?\n\n— Karim",
    emailBodyAr:
      "مرحبًا،\n\nقسم المالية يحتاج تقرير المصروفات خلال الساعة القادمة وإلا تأخرت الرواتب، لكن مكالمة العميل خلال 20 دقيقة تحتاج عرضًا توضيحيًا لم تنتهِ منه بعد. لا أستطيع إنجاز الاثنين معًا. ما خطتك؟\n\n— كريم",
  },
  {
    title: "Responding to a Manager Request",
    titleAr: "الرد على طلب من المدير",
    description: "A manager asks for something with an unrealistic deadline.",
    descriptionAr: "يطلب منك المدير أمرًا بموعد نهائي غير واقعي.",
    instructions: "Read the email below and write your reply.",
    instructionsAr: "اقرأ البريد الإلكتروني أدناه واكتب ردك.",
    senderName: "Laila Hassan",
    senderNameAr: "ليلى حسن",
    senderRole: "Department Head",
    senderRoleAr: "رئيسة القسم",
    emailSubject: "Can you turn this around by tomorrow morning?",
    emailSubjectAr: "هل يمكنك إنجاز هذا بحلول صباح الغد؟",
    emailBody:
      "Hi,\n\nI need the full Q3 summary deck ready for the board by tomorrow 9am. I know it's short notice. Can you make it happen, and if not, what do you suggest?\n\nLaila",
    emailBodyAr:
      "مرحبًا،\n\nأحتاج عرض ملخص الربع الثالث كاملاً جاهزًا لمجلس الإدارة بحلول التاسعة صباح الغد. أعلم أن الوقت قصير. هل يمكنك إنجاز ذلك، وإن لم يكن ممكنًا، فما اقتراحك؟\n\nليلى",
  },
  {
    title: "Solving an Operational Problem",
    titleAr: "حل مشكلة تشغيلية",
    description: "A recurring process failure is causing repeated delays.",
    descriptionAr: "فشل متكرر في إحدى العمليات يتسبب في تأخيرات متكررة.",
    instructions: "Read the email below and propose how you'd fix it.",
    instructionsAr: "اقرأ البريد الإلكتروني أدناه واقترح كيف ستحل المشكلة.",
    senderName: "Youssef Nabil",
    senderNameAr: "يوسف نبيل",
    senderRole: "Operations Director",
    senderRoleAr: "مدير العمليات",
    emailSubject: "Same shipping error, third time this month",
    emailSubjectAr: "نفس خطأ الشحن، للمرة الثالثة هذا الشهر",
    emailBody:
      "Hi,\n\nWe've had the same mislabeled-shipment error three times this month, each time costing us a client's trust. What would you do to actually fix this, not just patch it?\n\nYoussef",
    emailBodyAr:
      "مرحبًا،\n\nتكرر نفس خطأ وضع الملصقات الخاطئة على الشحنات ثلاث مرات هذا الشهر، وفي كل مرة نخسر ثقة أحد العملاء. ماذا ستفعل لحل هذه المشكلة فعليًا، لا مجرد معالجتها مؤقتًا؟\n\nيوسف",
  },
  {
    title: "Handling an Urgent Deadline",
    titleAr: "التعامل مع موعد نهائي عاجل",
    description: "A deliverable is due today and there isn't enough time left.",
    descriptionAr: "موعد تسليم اليوم ولا يوجد وقت كافٍ متبقٍ.",
    instructions: "Read the email below and reply with your plan.",
    instructionsAr: "اقرأ البريد الإلكتروني أدناه ورُد بخطتك.",
    senderName: "Nadia Farouk",
    senderNameAr: "نادية فاروق",
    senderRole: "Project Manager",
    senderRoleAr: "مديرة المشروع",
    emailSubject: "Launch is today — status?",
    emailSubjectAr: "الإطلاق اليوم — ما الوضع؟",
    emailBody:
      "Hi,\n\nWe launch at 5pm today and I just found out two tasks are still incomplete. What's your plan to get us there, and what should I tell the client if we can't?\n\nNadia",
    emailBodyAr:
      "مرحبًا،\n\nموعد الإطلاق الساعة الخامسة مساءً اليوم، واكتشفت للتو أن مهمتين لم تكتملا بعد. ما خطتك لإنجاز ذلك، وماذا يجب أن أخبر العميل إذا لم نتمكن؟\n\nنادية",
  },
  {
    title: "Last-Minute Schedule Change",
    titleAr: "تغيير مفاجئ في الجدول",
    description: "A coworker messages you in chat needing an immediate answer about covering a shift.",
    descriptionAr: "يراسلك زميل في الدردشة ويحتاج إجابة فورية بخصوص تغطية مناوبة.",
    instructions: "Reply in the chat below like you would to a real coworker message — quick, natural, and to the point. You have 60 seconds.",
    instructionsAr: "رُد في الدردشة أدناه كما لو كنت ترد على رسالة حقيقية من زميل — بسرعة وبشكل طبيعي ومباشر. لديك 60 ثانية.",
    senderName: "Sara Mahmoud",
    senderNameAr: "سارة محمود",
    senderRole: "Shift Lead",
    senderRoleAr: "رئيسة المناوبة",
    emailSubject: "need you to cover 2pm-6pm today, can you?",
    emailSubjectAr: "أحتاجك لتغطية 2-6 مساءً اليوم، ممكن؟",
    emailBody:
      "hey! so sorry for the short notice but Hossam just called in sick and we're uncovered 2-6pm today. any chance you can take it? if not I need to know right now so I can call someone else",
    emailBodyAr:
      "هاي! آسفة جدًا على التنبيه المتأخر بس حسام اتصل للتو إنه مريض واحنا بدون تغطية من 2 لـ6 مساءً اليوم. فيه فرصة تقدر تاخد المناوبة؟ لو لأ محتاجة أعرف فورًا عشان أتصل بحد تاني",
    channel: "CHAT",
    timeLimitSeconds: 60,
    totalSteps: 3,
  },
  {
    title: "Calming an Angry Caller",
    titleAr: "تهدئة متصل غاضب",
    description: "A manager gives you a heads-up that an angry customer is about to call, and you need to talk them down.",
    descriptionAr: "يخبرك المدير أن عميلاً غاضبًا سيتصل بك الآن وعليك تهدئته.",
    instructions:
      "Read the situation below, then press record and speak your reply out loud as you would on an actual phone call. You'll have 60 seconds — speak naturally, like you're really on the call.",
    instructionsAr:
      "اقرأ الموقف أدناه، ثم اضغط على زر التسجيل وتحدث بردك بصوت عالٍ كما لو كنت فعلاً في مكالمة هاتفية. لديك 60 ثانية — تحدث بشكل طبيعي كما لو كنت في المكالمة فعلاً.",
    senderName: "Tarek Fouad",
    senderNameAr: "طارق فؤاد",
    senderRole: "Customer Support Lead",
    senderRoleAr: "رئيس دعم العملاء",
    emailSubject: "Heads up — angry customer calling you next",
    emailSubjectAr: "تنبيه — عميل غاضب سيتصل بك الآن",
    emailBody:
      "The customer on line 2 has been waiting three weeks for a replacement part and just found out it's delayed again. I'm transferring them to you now. Talk them down and tell them what happens next.",
    emailBodyAr:
      "العميل على الخط الثاني ينتظر قطعة الغيار البديلة منذ ثلاثة أسابيع واكتشف للتو أنها تأخرت مرة أخرى. سأحوّله إليك الآن. هدّئه وأخبره بما سيحدث بعد ذلك.",
    channel: "VOICE",
    timeLimitSeconds: 60,
    totalSteps: 3,
  },
  {
    title: "A Client Threatens to Cancel a Major Contract",
    titleAr: "عميل يهدد بإلغاء عقد كبير",
    description:
      "A long-time client is furious about repeated delivery delays and is threatening to cancel a six-figure contract today.",
    descriptionAr: "عميل قديم غاضب من التأخيرات المتكررة في التسليم ويهدد بإلغاء عقد بقيمة كبيرة اليوم.",
    instructions:
      "Reply in the chat below like you're really talking to this client. Stay professional, but don't expect them to calm down easily — this is a serious, high-stakes conversation. You have 45 seconds per reply.",
    instructionsAr:
      "رُد في الدردشة أدناه كما لو كنت تتحدث فعليًا مع هذا العميل. حافظ على الاحترافية، لكن لا تتوقع أن يهدأ بسهولة — هذا حوار جاد وعالي المخاطر. لديك 45 ثانية لكل رد.",
    senderName: "Hany Zaki",
    senderNameAr: "هاني زكي",
    senderRole: "VP of Operations, client account",
    senderRoleAr: "نائب رئيس العمليات لدى العميل",
    emailSubject: "This is the third delay this quarter. I'm done.",
    emailSubjectAr: "هذا التأخير الثالث هذا الربع. انتهى الأمر.",
    emailBody:
      "I'm going to be blunt: this is the third shipment delay this quarter, and my board is asking why we're still working with you. I have a call with legal in an hour about terminating the contract. Convince me not to pull the plug right now.",
    emailBodyAr:
      "سأكون صريحًا: هذا هو التأخير الثالث في الشحن هذا الربع، ومجلس إدارتي يسأل لماذا ما زلنا نتعامل معكم. لدي مكالمة مع القسم القانوني خلال ساعة بخصوص إنهاء العقد. أقنعني الآن بعدم إلغاء العقد.",
    channel: "CHAT",
    timeLimitSeconds: 45,
    totalSteps: 4,
  },
  {
    title: "Taking an Urgent Workplace Safety Call",
    titleAr: "تلقي مكالمة عاجلة بشأن سلامة في مكان العمل",
    description:
      "A site supervisor calls in, rattled, to report an incident on the warehouse floor and needs you to guide the next steps immediately.",
    descriptionAr:
      "يتصل بك مشرف الموقع، مرتبكًا، للإبلاغ عن حادثة في أرضية المستودع ويحتاج منك توجيهه للخطوات التالية فورًا.",
    instructions:
      "Read the situation below, then press record and speak your reply out loud as you would on a real phone call. You have 45 seconds per reply — stay calm and in control even as new details come in.",
    instructionsAr:
      "اقرأ الموقف أدناه، ثم اضغط على زر التسجيل وتحدث بردك بصوت عالٍ كما لو كنت في مكالمة هاتفية حقيقية. لديك 45 ثانية لكل رد — حافظ على هدوئك وسيطرتك حتى مع ورود تفاصيل جديدة.",
    senderName: "Omar Said",
    senderNameAr: "عمر سعيد",
    senderRole: "Warehouse Floor Supervisor",
    senderRoleAr: "مشرف أرضية المستودع",
    emailSubject: "Forklift incident on the floor — need you on the phone now",
    emailSubjectAr: "حادثة رافعة شوكية في الأرضية — أحتاجك على الهاتف الآن",
    emailBody:
      "A forklift just clipped a shelving unit and it's leaning badly — one of the guys was standing right next to it and jumped back just in time. Everyone's shaken up and I don't know if I should clear the whole floor or just that aisle. What do you need me to do right now?",
    emailBodyAr:
      "اصطدمت رافعة شوكية للتو برف تخزين وهو يميل بشدة — أحد العمال كان واقفًا بجانبه مباشرة وقفز بعيدًا في اللحظة الأخيرة. الجميع مرتبك ولا أعرف إذا كان يجب إخلاء الأرضية بالكامل أم فقط ذلك الممر. ماذا تريدني أن أفعل الآن؟",
    channel: "VOICE",
    timeLimitSeconds: 45,
    totalSteps: 3,
  },
  {
    title: "A Social Media Post Is Going Viral for the Wrong Reasons",
    titleAr: "منشور على وسائل التواصل الاجتماعي ينتشر بشكل سلبي",
    description:
      "A company social media post was misread as offensive and is spreading fast, with a journalist already asking for comment.",
    descriptionAr:
      "تمت إساءة فهم منشور للشركة على وسائل التواصل الاجتماعي على أنه مسيء وهو ينتشر بسرعة، وصحفي يطلب التعليق بالفعل.",
    instructions:
      "Reply in the chat below as the situation unfolds in real time. Think fast — the next message in this thread may contain a new complication you don't expect. You have 45 seconds per reply.",
    instructionsAr:
      "رُد في الدردشة أدناه بينما يتطور الموقف في الوقت الفعلي. فكّر بسرعة — قد تحمل الرسالة التالية في هذا الخيط تعقيدًا جديدًا لا تتوقعه. لديك 45 ثانية لكل رد.",
    senderName: "Dina Kamal",
    senderNameAr: "دينا كمال",
    senderRole: "Head of Marketing",
    senderRoleAr: "رئيسة التسويق",
    emailSubject: "Our post is blowing up for all the wrong reasons",
    emailSubjectAr: "منشورنا ينتشر لأسباب خاطئة تمامًا",
    emailBody:
      "The post from this morning is getting ratio'd hard — people are reading it as tone-deaf and it's already at 2,000 angry comments. A tech journalist just DM'd asking if we have an official statement. I need your call on what we do in the next ten minutes.",
    emailBodyAr:
      "المنشور الذي نشرناه هذا الصباح يتلقى ردود فعل غاضبة بشدة — الناس يقرأونه على أنه غير حساس وقد وصل بالفعل إلى 2000 تعليق غاضب. تواصلت معنا للتو صحفية تقنية تسأل إن كان لدينا بيان رسمي. أحتاج قرارك بشأن ما سنفعله خلال العشر دقائق القادمة.",
    channel: "CHAT",
    timeLimitSeconds: 45,
    totalSteps: 3,
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
    `INSERT INTO Simulation (id, companyId, isTemplate, title, titleAr, description, descriptionAr, instructions, instructionsAr, senderName, senderNameAr, senderRole, senderRoleAr, emailSubject, emailSubjectAr, emailBody, emailBodyAr, channel, timeLimitSeconds, totalSteps)
     VALUES (?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      t.titleAr || null,
      t.description,
      t.descriptionAr || null,
      t.instructions,
      t.instructionsAr || null,
      t.senderName,
      t.senderNameAr || null,
      t.senderRole,
      t.senderRoleAr || null,
      t.emailSubject,
      t.emailSubjectAr || null,
      t.emailBody,
      t.emailBodyAr || null,
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
  seedAdmin(db);
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
