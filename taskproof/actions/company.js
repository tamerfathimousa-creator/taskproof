"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, newId, CHANNELS, getJobSimulations, setJobSimulations, buildConversationText, getApplicationCriteria } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { suggestScoresWithJev } from "@/lib/jev";
import { suggestScoresWithClaude } from "@/lib/claude";

const AI_SUGGESTION_SOURCES = ["JEV", "CLAUDE"];

async function requireCompany() {
  const user = await getCurrentUser();
  if (!user || user.role !== "COMPANY") redirect("/login");
  if (!user.company) redirect("/login");
  return user;
}

export async function updateCompanyProfile(prevState, formData) {
  const user = await requireCompany();
  const db = getDb();
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  if (!name) return { error: "Company name is required." };

  db.prepare("UPDATE Company SET name = ?, description = ?, industry = ? WHERE id = ?").run(
    name,
    description,
    industry,
    user.company.id
  );
  revalidatePath("/company/profile");
  return { success: "Profile updated." };
}

export async function createSimulation(prevState, formData) {
  const user = await requireCompany();
  const db = getDb();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const instructions = String(formData.get("instructions") || "Read the email below and reply as you would at work.").trim();
  const senderName = String(formData.get("senderName") || "").trim();
  const senderRole = String(formData.get("senderRole") || "").trim();
  const emailSubject = String(formData.get("emailSubject") || "").trim();
  const emailBody = String(formData.get("emailBody") || "").trim();
  // Arabic translations are all optional — a company can leave any or all of
  // these blank and the simulation stays English-only, same as before.
  const titleAr = String(formData.get("titleAr") || "").trim() || null;
  const descriptionAr = String(formData.get("descriptionAr") || "").trim() || null;
  const instructionsAr = String(formData.get("instructionsAr") || "").trim() || null;
  const senderNameAr = String(formData.get("senderNameAr") || "").trim() || null;
  const senderRoleAr = String(formData.get("senderRoleAr") || "").trim() || null;
  const emailSubjectAr = String(formData.get("emailSubjectAr") || "").trim() || null;
  const emailBodyAr = String(formData.get("emailBodyAr") || "").trim() || null;
  const channel = CHANNELS.includes(formData.get("channel")) ? formData.get("channel") : "EMAIL";
  let timeLimitSeconds = parseInt(formData.get("timeLimitSeconds"), 10);
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0) timeLimitSeconds = 120;
  timeLimitSeconds = Math.max(15, Math.min(600, timeLimitSeconds));

  // Multi-step (a back-and-forth with an AI-generated follow-up) only makes
  // sense for chat/voice — email stays the original one-shot reply. Chat/
  // voice simulations always run at least a 3-message exchange now, so a
  // candidate can't be tested on a single lucky reply — up to 4.
  let totalSteps = parseInt(formData.get("totalSteps"), 10);
  if (!Number.isFinite(totalSteps)) totalSteps = channel === "EMAIL" ? 1 : 3;
  totalSteps = Math.max(1, Math.min(4, totalSteps));
  if (channel === "EMAIL") {
    totalSteps = 1;
  } else if (totalSteps < 3) {
    totalSteps = 3;
  }

  if (!title || !senderName || !emailSubject || !emailBody) {
    return { error: "Title, sender name, subject and scenario message are required." };
  }

  const simId = newId();
  db.prepare(
    `INSERT INTO Simulation (id, companyId, isTemplate, title, titleAr, description, descriptionAr, instructions, instructionsAr, senderName, senderNameAr, senderRole, senderRoleAr, emailSubject, emailSubjectAr, emailBody, emailBodyAr, channel, timeLimitSeconds, totalSteps)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    simId,
    user.company.id,
    title,
    titleAr,
    description,
    descriptionAr,
    instructions,
    instructionsAr,
    senderName,
    senderNameAr,
    senderRole,
    senderRoleAr,
    emailSubject,
    emailSubjectAr,
    emailBody,
    emailBodyAr,
    channel,
    timeLimitSeconds,
    totalSteps
  );

  const names = formData.getAll("criterionName");
  const maxes = formData.getAll("criterionMax");
  if (names.length) {
    const insertCrit = db.prepare(
      "INSERT INTO EvaluationCriterion (id, simulationId, name, description, maxScore, sortOrder) VALUES (?, ?, ?, '', ?, ?)"
    );
    names.forEach((n, i) => {
      const name = String(n || "").trim();
      const max = parseInt(maxes[i], 10) || 5;
      if (name) insertCrit.run(newId(), simId, name, max, i);
    });
  } else {
    const defaults = [
      "Problem Understanding",
      "Decision Quality",
      "Communication",
      "Prioritization",
      "Professionalism",
    ];
    const insertCrit = db.prepare(
      "INSERT INTO EvaluationCriterion (id, simulationId, name, description, maxScore, sortOrder) VALUES (?, ?, ?, '', 5, ?)"
    );
    defaults.forEach((name, i) => insertCrit.run(newId(), simId, name, i));
  }

  revalidatePath("/company/simulations");
  redirect("/company/simulations");
}

export async function updateSimulation(simulationId, prevState, formData) {
  const user = await requireCompany();
  const db = getDb();

  // Only a company's own, custom-written simulations can be edited — never
  // the shared template library (isTemplate = 1), and never another
  // company's simulation.
  const existing = db
    .prepare("SELECT * FROM Simulation WHERE id = ? AND companyId = ? AND isTemplate = 0")
    .get(simulationId, user.company.id);
  if (!existing) return { error: "Simulation not found." };

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const instructions = String(formData.get("instructions") || "Read the email below and reply as you would at work.").trim();
  const senderName = String(formData.get("senderName") || "").trim();
  const senderRole = String(formData.get("senderRole") || "").trim();
  const emailSubject = String(formData.get("emailSubject") || "").trim();
  const emailBody = String(formData.get("emailBody") || "").trim();
  const titleAr = String(formData.get("titleAr") || "").trim() || null;
  const descriptionAr = String(formData.get("descriptionAr") || "").trim() || null;
  const instructionsAr = String(formData.get("instructionsAr") || "").trim() || null;
  const senderNameAr = String(formData.get("senderNameAr") || "").trim() || null;
  const senderRoleAr = String(formData.get("senderRoleAr") || "").trim() || null;
  const emailSubjectAr = String(formData.get("emailSubjectAr") || "").trim() || null;
  const emailBodyAr = String(formData.get("emailBodyAr") || "").trim() || null;
  const channel = CHANNELS.includes(formData.get("channel")) ? formData.get("channel") : "EMAIL";
  let timeLimitSeconds = parseInt(formData.get("timeLimitSeconds"), 10);
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0) timeLimitSeconds = 120;
  timeLimitSeconds = Math.max(15, Math.min(600, timeLimitSeconds));

  let totalSteps = parseInt(formData.get("totalSteps"), 10);
  if (!Number.isFinite(totalSteps)) totalSteps = channel === "EMAIL" ? 1 : 3;
  totalSteps = Math.max(1, Math.min(4, totalSteps));
  if (channel === "EMAIL") {
    totalSteps = 1;
  } else if (totalSteps < 3) {
    totalSteps = 3;
  }

  if (!title || !senderName || !emailSubject || !emailBody) {
    return { error: "Title, sender name, subject and scenario message are required." };
  }

  db.prepare(
    `UPDATE Simulation SET
       title = ?, titleAr = ?, description = ?, descriptionAr = ?,
       instructions = ?, instructionsAr = ?,
       senderName = ?, senderNameAr = ?, senderRole = ?, senderRoleAr = ?,
       emailSubject = ?, emailSubjectAr = ?, emailBody = ?, emailBodyAr = ?,
       channel = ?, timeLimitSeconds = ?, totalSteps = ?
     WHERE id = ? AND companyId = ?`
  ).run(
    title,
    titleAr,
    description,
    descriptionAr,
    instructions,
    instructionsAr,
    senderName,
    senderNameAr,
    senderRole,
    senderRoleAr,
    emailSubject,
    emailSubjectAr,
    emailBody,
    emailBodyAr,
    channel,
    timeLimitSeconds,
    totalSteps,
    simulationId,
    user.company.id
  );

  // Criteria: update existing rows by id, insert any new ones, and drop rows
  // that were removed in the form — unless an evaluation has already scored
  // against that criterion, in which case we leave it in place (removing it
  // would orphan saved scores) and just stop offering it going forward would
  // require more bookkeeping than this MVP needs, so instead we simply keep
  // it rather than breaking existing evaluation history.
  const ids = formData.getAll("criterionId");
  const names = formData.getAll("criterionName");
  const maxes = formData.getAll("criterionMax");
  const keptIds = new Set();

  const updateCrit = db.prepare("UPDATE EvaluationCriterion SET name = ?, maxScore = ?, sortOrder = ? WHERE id = ? AND simulationId = ?");
  const insertCrit = db.prepare(
    "INSERT INTO EvaluationCriterion (id, simulationId, name, description, maxScore, sortOrder) VALUES (?, ?, ?, '', ?, ?)"
  );

  names.forEach((n, i) => {
    const name = String(n || "").trim();
    if (!name) return;
    const max = parseInt(maxes[i], 10) || 5;
    const id = ids[i];
    if (id) {
      updateCrit.run(name, max, i, id, simulationId);
      keptIds.add(id);
    } else {
      const newCritId = newId();
      insertCrit.run(newCritId, simulationId, name, max, i);
      keptIds.add(newCritId);
    }
  });

  const existingCriteria = db.prepare("SELECT id FROM EvaluationCriterion WHERE simulationId = ?").all(simulationId);
  const deleteCrit = db.prepare("DELETE FROM EvaluationCriterion WHERE id = ?");
  for (const c of existingCriteria) {
    if (keptIds.has(c.id)) continue;
    // A criterion that already has saved scores against it can't be deleted
    // without orphaning that history — leave it in place in that case.
    try {
      deleteCrit.run(c.id);
    } catch {
      // Has existing EvaluationScore rows referencing it (FK constraint) — keep it.
    }
  }

  revalidatePath("/company/simulations");
  revalidatePath(`/company/simulations/${simulationId}/edit`);
  return { success: "Simulation updated." };
}

export async function createJob(prevState, formData) {
  const user = await requireCompany();
  const db = getDb();

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const department = String(formData.get("department") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const employmentType = String(formData.get("employmentType") || "").trim();
  const requiredSkills = String(formData.get("requiredSkills") || "").trim();
  const deadline = String(formData.get("deadline") || "") || null;
  const simulationIds = formData.getAll("simulationIds").map(String).filter(Boolean);

  if (!title || !description) return { error: "Job title and description are required." };

  const jobId = newId();
  db.prepare(
    `INSERT INTO Job (id, companyId, title, description, department, location, employmentType, requiredSkills, deadline, simulationId, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`
  ).run(
    jobId,
    user.company.id,
    title,
    description,
    department,
    location,
    employmentType,
    requiredSkills,
    deadline,
    simulationIds[0] || null
  );
  setJobSimulations(db, jobId, simulationIds);

  revalidatePath("/company/jobs");
  redirect(`/company/jobs/${jobId}`);
}

export async function updateJob(jobId, prevState, formData) {
  const user = await requireCompany();
  const db = getDb();
  const job = db.prepare("SELECT * FROM Job WHERE id = ? AND companyId = ?").get(jobId, user.company.id);
  if (!job) return { error: "Job not found." };

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const department = String(formData.get("department") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const employmentType = String(formData.get("employmentType") || "").trim();
  const requiredSkills = String(formData.get("requiredSkills") || "").trim();
  const deadline = String(formData.get("deadline") || "") || null;
  const simulationIds = formData.getAll("simulationIds").map(String).filter(Boolean);

  if (!title || !description) return { error: "Job title and description are required." };

  db.prepare(
    `UPDATE Job SET title=?, description=?, department=?, location=?, employmentType=?, requiredSkills=?, deadline=?, simulationId=? WHERE id=?`
  ).run(title, description, department, location, employmentType, requiredSkills, deadline, simulationIds[0] || null, jobId);
  setJobSimulations(db, jobId, simulationIds);

  revalidatePath(`/company/jobs/${jobId}`);
  return { success: "Job updated." };
}

export async function setJobStatus(jobId, status) {
  const user = await requireCompany();
  const db = getDb();
  const job = db.prepare("SELECT * FROM Job WHERE id = ? AND companyId = ?").get(jobId, user.company.id);
  if (!job) return { error: "Job not found." };
  if (!["DRAFT", "OPEN", "CLOSED"].includes(status)) return { error: "Invalid status." };
  db.prepare("UPDATE Job SET status = ? WHERE id = ?").run(status, jobId);
  revalidatePath(`/company/jobs/${jobId}`);
  revalidatePath("/company/jobs");
}

export async function generateAiSuggestion(applicationId, source = "JEV") {
  const user = await requireCompany();
  const db = getDb();

  const normalizedSource = AI_SUGGESTION_SOURCES.includes(source) ? source : "JEV";
  const suggestScores = normalizedSource === "CLAUDE" ? suggestScoresWithClaude : suggestScoresWithJev;

  const application = db
    .prepare(
      `SELECT Application.* FROM Application
       JOIN Job ON Job.id = Application.jobId
       WHERE Application.id = ? AND Job.companyId = ?`
    )
    .get(applicationId, user.company.id);
  if (!application) return { error: "Application not found." };

  const attempts = db
    .prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ? AND status = 'SUBMITTED'")
    .all(applicationId);
  if (!attempts.length) return { error: "No submitted simulation responses found for this application." };

  try {
    const byId = {};
    const noteParts = [];
    let modelLabel = "";

    // A job can carry several simulations now — score each one's exchange
    // against its own criteria, then combine into one suggestion. Jev and
    // Claude are independent sources: each stores its own row, keyed by
    // (applicationId, source), so neither overwrites the other.
    for (const attempt of attempts) {
      const simulation = db.prepare("SELECT * FROM Simulation WHERE id = ?").get(attempt.simulationId);
      const criteria = db
        .prepare("SELECT * FROM EvaluationCriterion WHERE simulationId = ? ORDER BY sortOrder")
        .all(attempt.simulationId);
      if (!criteria.length) continue;

      const conversationText = buildConversationText(db, attempt, simulation);
      const result = await suggestScores({ simulation, criteria, conversationText });
      modelLabel = result.model;
      for (const row of result.scores) {
        // confidence is stored here (in AiSuggestion.scoresJson) but never
        // rendered on the company-facing review screen — only the admin
        // area reads it back out. Jev's is a real calibrated number; Claude
        // doesn't provide one (see lib/claude.js), so it's always null there.
        byId[row.criterionId] = { score: row.score, justification: row.justification, confidence: row.confidence };
      }
      if (result.notes) noteParts.push(attempts.length > 1 ? `${simulation.title}: ${result.notes}` : result.notes);
    }

    const existing = db
      .prepare("SELECT id FROM AiSuggestion WHERE applicationId = ? AND source = ?")
      .get(applicationId, normalizedSource);
    const scoresJson = JSON.stringify(byId);
    const notes = noteParts.join(" ");
    if (existing) {
      db.prepare(
        "UPDATE AiSuggestion SET scoresJson = ?, notes = ?, model = ?, error = NULL, createdAt = datetime('now') WHERE id = ?"
      ).run(scoresJson, notes, modelLabel, existing.id);
    } else {
      db.prepare(
        "INSERT INTO AiSuggestion (id, applicationId, source, scoresJson, notes, model) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(newId(), applicationId, normalizedSource, scoresJson, notes, modelLabel);
    }
    revalidatePath(`/company/candidates/${applicationId}`);
    return { success: `${normalizedSource === "CLAUDE" ? "Claude" : "Jev"} suggestion generated.` };
  } catch (err) {
    const message = String(err?.message || err);
    const existing = db
      .prepare("SELECT id FROM AiSuggestion WHERE applicationId = ? AND source = ?")
      .get(applicationId, normalizedSource);
    if (existing) {
      db.prepare("UPDATE AiSuggestion SET error = ?, createdAt = datetime('now') WHERE id = ?").run(message, existing.id);
    } else {
      db.prepare(
        "INSERT INTO AiSuggestion (id, applicationId, source, scoresJson, error) VALUES (?, ?, ?, '{}', ?)"
      ).run(newId(), applicationId, normalizedSource, message);
    }
    revalidatePath(`/company/candidates/${applicationId}`);
    return { error: `AI suggestion failed: ${message}` };
  }
}

export async function saveEvaluation(applicationId, prevState, formData) {
  const user = await requireCompany();
  const db = getDb();

  const application = db
    .prepare(
      `SELECT Application.* FROM Application
       JOIN Job ON Job.id = Application.jobId
       WHERE Application.id = ? AND Job.companyId = ?`
    )
    .get(applicationId, user.company.id);
  if (!application) return { error: "Application not found." };

  const attempts = db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").all(applicationId);
  if (!attempts.length) return { error: "No simulation attempts found for this application." };

  const criteria = getApplicationCriteria(db, applicationId);

  const notes = String(formData.get("notes") || "").trim();

  let existingEval = db.prepare("SELECT * FROM Evaluation WHERE applicationId = ?").get(applicationId);
  const evalId = existingEval ? existingEval.id : newId();

  let total = 0;
  const scoreRows = [];
  for (const c of criteria) {
    const raw = formData.get(`score_${c.id}`);
    let score = parseInt(raw, 10);
    if (isNaN(score)) score = 0;
    score = Math.max(0, Math.min(c.maxScore, score));
    total += score;
    scoreRows.push({ criterionId: c.id, score });
  }

  if (existingEval) {
    db.prepare("UPDATE Evaluation SET totalScore = ?, notes = ?, updatedAt = datetime('now') WHERE id = ?").run(
      total,
      notes,
      evalId
    );
    db.prepare("DELETE FROM EvaluationScore WHERE evaluationId = ?").run(evalId);
  } else {
    db.prepare(
      "INSERT INTO Evaluation (id, applicationId, reviewerId, totalScore, notes) VALUES (?, ?, ?, ?, ?)"
    ).run(evalId, applicationId, user.id, total, notes);
  }

  const insertScore = db.prepare(
    "INSERT INTO EvaluationScore (id, evaluationId, criterionId, score) VALUES (?, ?, ?, ?)"
  );
  for (const row of scoreRows) {
    insertScore.run(newId(), evalId, row.criterionId, row.score);
  }

  db.prepare("UPDATE Application SET status = 'REVIEWED' WHERE id = ? AND status != 'SHORTLISTED' AND status != 'REJECTED'").run(
    applicationId
  );

  revalidatePath(`/company/candidates/${applicationId}`);
  return { success: "Evaluation saved." };
}

export async function setApplicationStatus(applicationId, status) {
  const user = await requireCompany();
  const db = getDb();
  const application = db
    .prepare(
      `SELECT Application.* FROM Application
       JOIN Job ON Job.id = Application.jobId
       WHERE Application.id = ? AND Job.companyId = ?`
    )
    .get(applicationId, user.company.id);
  if (!application) return { error: "Application not found." };
  const allowed = ["APPLIED", "SIMULATION_PENDING", "SIMULATION_SUBMITTED", "REVIEWED", "SHORTLISTED", "REJECTED"];
  if (!allowed.includes(status)) return { error: "Invalid status." };
  db.prepare("UPDATE Application SET status = ? WHERE id = ?").run(status, applicationId);
  revalidatePath(`/company/candidates/${applicationId}`);
}
