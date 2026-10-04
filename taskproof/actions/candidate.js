"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "fs/promises";
import path from "path";
import { getDb, newId } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { transcribeAudioFile } from "@/lib/whisper";

const STORAGE_DIR = path.join(process.cwd(), "storage", "cvs");
const VOICE_STORAGE_DIR = path.join(process.cwd(), "storage", "voice");

async function requireCandidate() {
  const user = await getCurrentUser();
  if (!user || user.role !== "CANDIDATE") redirect("/login");
  if (!user.candidateProfile) redirect("/login");
  return user;
}

export async function updateCandidateProfile(prevState, formData) {
  const user = await requireCandidate();
  const db = getDb();

  const fullName = String(formData.get("fullName") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const currentTitle = String(formData.get("currentTitle") || "").trim();
  const summary = String(formData.get("summary") || "").trim();
  if (!fullName) return { error: "Full name is required." };

  let cvUrl = user.candidateProfile.cvUrl;
  let cvName = user.candidateProfile.cvName;

  const file = formData.get("cv");
  if (file && typeof file === "object" && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) return { error: "CV must be 5MB or smaller." };
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${newId()}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(STORAGE_DIR, storedName), bytes);
    cvUrl = storedName;
    cvName = file.name;
  }

  db.prepare(
    "UPDATE CandidateProfile SET fullName=?, phone=?, location=?, currentTitle=?, summary=?, cvUrl=?, cvName=? WHERE id=?"
  ).run(fullName, phone, location, currentTitle, summary, cvUrl, cvName, user.candidateProfile.id);

  revalidatePath("/candidate/profile");
  return { success: "Profile updated." };
}

export async function applyToJob(jobId) {
  const user = await requireCandidate();
  const db = getDb();

  const job = db.prepare("SELECT * FROM Job WHERE id = ? AND status = 'OPEN'").get(jobId);
  if (!job) return { error: "This job is not open for applications." };

  const existing = db
    .prepare("SELECT id FROM Application WHERE jobId = ? AND candidateId = ?")
    .get(jobId, user.candidateProfile.id);
  if (existing) return { error: "You've already applied to this job." };

  const applicationId = newId();
  db.prepare(
    "INSERT INTO Application (id, jobId, candidateId, status) VALUES (?, ?, ?, 'SIMULATION_PENDING')"
  ).run(applicationId, jobId, user.candidateProfile.id);

  if (job.simulationId) {
    db.prepare(
      "INSERT INTO SimulationAttempt (id, applicationId, simulationId, status) VALUES (?, ?, ?, 'NOT_STARTED')"
    ).run(newId(), applicationId, job.simulationId);
  }

  revalidatePath(`/candidate/jobs/${jobId}`);
  revalidatePath("/candidate/dashboard");
  redirect(`/candidate/applications/${applicationId}`);
}

async function loadOwnedAttempt(user, applicationId) {
  const db = getDb();
  const application = db
    .prepare("SELECT * FROM Application WHERE id = ? AND candidateId = ?")
    .get(applicationId, user.candidateProfile.id);
  if (!application) return null;
  const attempt = db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").get(applicationId);
  return { application, attempt };
}

export async function startAttempt(applicationId) {
  const user = await requireCandidate();
  const db = getDb();
  const found = await loadOwnedAttempt(user, applicationId);
  if (!found || !found.attempt) return { error: "Simulation not found." };
  if (found.attempt.status === "SUBMITTED") return { error: "Already submitted." };
  if (found.attempt.status === "NOT_STARTED") {
    db.prepare(
      "UPDATE SimulationAttempt SET status = 'IN_PROGRESS', startedAt = COALESCE(startedAt, datetime('now')) WHERE id = ?"
    ).run(found.attempt.id);
    revalidatePath(`/candidate/applications/${applicationId}`);
  }
  const updated = db.prepare("SELECT startedAt FROM SimulationAttempt WHERE id = ?").get(found.attempt.id);
  return { success: true, startedAt: updated.startedAt };
}

// Called when the client detects the timer already expired before any
// submission happened (e.g. the candidate closed the tab mid-test and never
// came back). Leaves whatever draft text/audio exists and just locks it.
export async function expireAttempt(applicationId) {
  const user = await requireCandidate();
  const db = getDb();
  const found = await loadOwnedAttempt(user, applicationId);
  if (!found || !found.attempt) return { error: "Simulation not found." };
  if (found.attempt.status === "SUBMITTED") return { success: true };
  db.prepare("UPDATE SimulationAttempt SET status = 'SUBMITTED', submittedAt = datetime('now') WHERE id = ?").run(
    found.attempt.id
  );
  db.prepare("UPDATE Application SET status = 'SIMULATION_SUBMITTED' WHERE id = ?").run(applicationId);
  revalidatePath(`/candidate/applications/${applicationId}`);
  return { success: true };
}

export async function saveDraft(applicationId, prevState, formData) {
  const user = await requireCandidate();
  const db = getDb();
  const found = await loadOwnedAttempt(user, applicationId);
  if (!found || !found.attempt) return { error: "Simulation not found." };
  if (found.attempt.status === "SUBMITTED") return { error: "This response was already submitted." };

  const responseText = String(formData.get("responseText") || "");
  db.prepare(
    "UPDATE SimulationAttempt SET responseText = ?, status = 'IN_PROGRESS', startedAt = COALESCE(startedAt, datetime('now')) WHERE id = ?"
  ).run(responseText, found.attempt.id);

  revalidatePath(`/candidate/applications/${applicationId}`);
  return { success: "Draft saved." };
}

export async function submitResponse(applicationId, prevState, formData) {
  const user = await requireCandidate();
  const db = getDb();
  const found = await loadOwnedAttempt(user, applicationId);
  if (!found || !found.attempt) return { error: "Simulation not found." };
  if (found.attempt.status === "SUBMITTED") return { error: "This response was already submitted." };

  const responseText = String(formData.get("responseText") || "").trim();
  const auto = formData.get("auto") === "1";
  if (!responseText && !auto) return { error: "Please write a response before submitting." };

  db.prepare(
    "UPDATE SimulationAttempt SET responseText = ?, status = 'SUBMITTED', startedAt = COALESCE(startedAt, datetime('now')), submittedAt = datetime('now') WHERE id = ?"
  ).run(responseText, found.attempt.id);

  db.prepare("UPDATE Application SET status = 'SIMULATION_SUBMITTED' WHERE id = ?").run(applicationId);

  revalidatePath(`/candidate/applications/${applicationId}`);
  return { success: auto ? "Time's up — your response was submitted automatically." : "Response submitted." };
}

export async function submitVoiceResponse(applicationId, prevState, formData) {
  const user = await requireCandidate();
  const db = getDb();
  const found = await loadOwnedAttempt(user, applicationId);
  if (!found || !found.attempt) return { error: "Simulation not found." };
  if (found.attempt.status === "SUBMITTED") return { error: "This response was already submitted." };

  const file = formData.get("audio");
  if (!file || typeof file !== "object" || file.size === 0) {
    return { error: "No recording was received — please record your response before submitting." };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { error: "Recording is too large (max 15MB)." };
  }

  await fs.mkdir(VOICE_STORAGE_DIR, { recursive: true });
  const rawExt = file.type ? file.type.split("/")[1]?.split(";")[0] : null;
  const ext = rawExt && /^[a-z0-9]+$/i.test(rawExt) ? rawExt : "webm";
  const storedName = `${newId()}.${ext}`;
  const storedPath = path.join(VOICE_STORAGE_DIR, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storedPath, bytes);

  db.prepare(
    "UPDATE SimulationAttempt SET audioUrl = ?, audioName = ?, status = 'SUBMITTED', startedAt = COALESCE(startedAt, datetime('now')), submittedAt = datetime('now') WHERE id = ?"
  ).run(storedName, file.name || storedName, found.attempt.id);

  db.prepare("UPDATE Application SET status = 'SIMULATION_SUBMITTED' WHERE id = ?").run(applicationId);

  // Transcribe right away so the reviewer gets readable text, not just audio.
  try {
    const transcript = await transcribeAudioFile(storedPath, {
      mimeType: file.type || "audio/webm",
      fileName: storedName,
    });
    db.prepare("UPDATE SimulationAttempt SET transcript = ?, transcriptError = NULL WHERE id = ?").run(
      transcript,
      found.attempt.id
    );
  } catch (err) {
    db.prepare("UPDATE SimulationAttempt SET transcriptError = ? WHERE id = ?").run(
      String(err?.message || err),
      found.attempt.id
    );
  }

  revalidatePath(`/candidate/applications/${applicationId}`);
  return { success: "Recording submitted." };
}
