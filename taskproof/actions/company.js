"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, newId, CHANNELS } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { suggestScoresWithGemini } from "@/lib/ai";

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
  const channel = CHANNELS.includes(formData.get("channel")) ? formData.get("channel") : "EMAIL";
  let timeLimitSeconds = parseInt(formData.get("timeLimitSeconds"), 10);
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0) timeLimitSeconds = 60;
  timeLimitSeconds = Math.max(15, Math.min(600, timeLimitSeconds));

  if (!title || !senderName || !emailSubject || !emailBody) {
    return { error: "Title, sender name, subject and scenario message are required." };
  }

  const simId = newId();
  db.prepare(
    `INSERT INTO Simulation (id, companyId, isTemplate, title, description, instructions, senderName, senderRole, emailSubject, emailBody, channel, timeLimitSeconds)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    simId,
    user.company.id,
    title,
    description,
    instructions,
    senderName,
    senderRole,
    emailSubject,
    emailBody,
    channel,
    timeLimitSeconds
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
  const simulationId = String(formData.get("simulationId") || "") || null;

  if (!title || !description) return { error: "Job title and description are required." };

  const jobId = newId();
  db.prepare(
    `INSERT INTO Job (id, companyId, title, description, department, location, employmentType, requiredSkills, deadline, simulationId, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`
  ).run(jobId, user.company.id, title, description, department, location, employmentType, requiredSkills, deadline, simulationId);

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
  const simulationId = String(formData.get("simulationId") || "") || null;

  if (!title || !description) return { error: "Job title and description are required." };

  db.prepare(
    `UPDATE Job SET title=?, description=?, department=?, location=?, employmentType=?, requiredSkills=?, deadline=?, simulationId=? WHERE id=?`
  ).run(title, description, department, location, employmentType, requiredSkills, deadline, simulationId, jobId);

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

export async function generateAiSuggestion(applicationId) {
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

  const attempt = db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").get(applicationId);
  if (!attempt) return { error: "No simulation attempt found for this application." };

  const simulation = db.prepare("SELECT * FROM Simulation WHERE id = ?").get(attempt.simulationId);
  const criteria = db
    .prepare("SELECT * FROM EvaluationCriterion WHERE simulationId = ? ORDER BY sortOrder")
    .all(attempt.simulationId);

  const responseText = attempt.transcript || attempt.responseText || "";

  try {
    const result = await suggestScoresWithGemini({ simulation, criteria, responseText });
    const byId = {};
    for (const row of result.scores) {
      const crit = criteria.find((c) => c.id === row.criterionId);
      if (!crit) continue;
      let score = parseInt(row.score, 10);
      if (isNaN(score)) score = 0;
      score = Math.max(0, Math.min(crit.maxScore, score));
      byId[row.criterionId] = { score, justification: row.justification || "" };
    }

    const existing = db.prepare("SELECT id FROM AiSuggestion WHERE applicationId = ?").get(applicationId);
    const scoresJson = JSON.stringify(byId);
    if (existing) {
      db.prepare(
        "UPDATE AiSuggestion SET scoresJson = ?, notes = ?, model = ?, error = NULL, createdAt = datetime('now') WHERE id = ?"
      ).run(scoresJson, result.notes, result.model, existing.id);
    } else {
      db.prepare(
        "INSERT INTO AiSuggestion (id, applicationId, scoresJson, notes, model) VALUES (?, ?, ?, ?, ?)"
      ).run(newId(), applicationId, scoresJson, result.notes, result.model);
    }
    revalidatePath(`/company/candidates/${applicationId}`);
    return { success: "AI suggestion generated." };
  } catch (err) {
    const message = String(err?.message || err);
    const existing = db.prepare("SELECT id FROM AiSuggestion WHERE applicationId = ?").get(applicationId);
    if (existing) {
      db.prepare("UPDATE AiSuggestion SET error = ?, createdAt = datetime('now') WHERE id = ?").run(message, existing.id);
    } else {
      db.prepare(
        "INSERT INTO AiSuggestion (id, applicationId, scoresJson, error) VALUES (?, ?, '{}', ?)"
      ).run(newId(), applicationId, message);
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

  const attempt = db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").get(applicationId);
  if (!attempt) return { error: "No simulation attempt found for this application." };

  const criteria = db.prepare("SELECT * FROM EvaluationCriterion WHERE simulationId = ? ORDER BY sortOrder").all(attempt.simulationId);

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
