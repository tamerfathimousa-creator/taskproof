"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "fs/promises";
import path from "path";
import { getDb, newId, getJobSimulations, buildConversationText, getFirstCandidateReplyText } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { transcribeAudioFile } from "@/lib/whisper";
import { generateFollowUpMessage, detectReplyLanguage } from "@/lib/ai";

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
  const sims = getJobSimulations(db, jobId);
  db.prepare(
    `INSERT INTO Application (id, jobId, candidateId, status) VALUES (?, ?, ?, ?)`
  ).run(applicationId, jobId, user.candidateProfile.id, sims.length ? "SIMULATION_PENDING" : "APPLIED");

  for (const sim of sims) {
    db.prepare(
      "INSERT INTO SimulationAttempt (id, applicationId, simulationId, status) VALUES (?, ?, ?, 'NOT_STARTED')"
    ).run(newId(), applicationId, sim.id);
  }

  revalidatePath(`/candidate/jobs/${jobId}`);
  revalidatePath("/candidate/dashboard");
  redirect(`/candidate/applications/${applicationId}`);
}

async function loadOwnedContext(user, applicationId, simulationId) {
  const db = getDb();
  const application = db
    .prepare("SELECT * FROM Application WHERE id = ? AND candidateId = ?")
    .get(applicationId, user.candidateProfile.id);
  if (!application) return null;
  const job = db.prepare("SELECT * FROM Job WHERE id = ?").get(application.jobId);
  const attempt = db
    .prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ? AND simulationId = ?")
    .get(applicationId, simulationId);
  if (!attempt) return null;
  const simulation = db.prepare("SELECT * FROM Simulation WHERE id = ?").get(simulationId);
  return { db, application, job, attempt, simulation };
}

// A job's attached simulations run in a fixed order. Enforced here
// server-side (not just hidden in the UI) so a candidate can't jump ahead by
// calling an action directly.
function checkSequenceGate(db, jobId, simulationId, applicationId) {
  const sims = getJobSimulations(db, jobId);
  const idx = sims.findIndex((s) => s.id === simulationId);
  if (idx <= 0) return null;
  for (let i = 0; i < idx; i++) {
    const prior = db
      .prepare("SELECT status FROM SimulationAttempt WHERE applicationId = ? AND simulationId = ?")
      .get(applicationId, sims[i].id);
    if (!prior || prior.status !== "SUBMITTED") {
      return `Please complete "${sims[i].title}" first.`;
    }
  }
  return null;
}

function maybeAdvanceApplication(db, applicationId) {
  const remaining = db
    .prepare("SELECT COUNT(*) c FROM SimulationAttempt WHERE applicationId = ? AND status != 'SUBMITTED'")
    .get(applicationId).c;
  if (remaining === 0) {
    db.prepare(
      "UPDATE Application SET status = 'SIMULATION_SUBMITTED' WHERE id = ? AND status NOT IN ('REVIEWED','SHORTLISTED','REJECTED')"
    ).run(applicationId);
  }
}

export async function startAttempt(applicationId, simulationId) {
  const user = await requireCandidate();
  const ctx = await loadOwnedContext(user, applicationId, simulationId);
  if (!ctx) return { error: "Simulation not found." };
  const { db, job, attempt, simulation } = ctx;
  if (attempt.status === "SUBMITTED") return { error: "Already submitted." };

  const gate = checkSequenceGate(db, job.id, simulationId, applicationId);
  if (gate) return { error: gate };

  if (attempt.status === "NOT_STARTED") {
    // Mint the first step's token now — every reply from here on must echo
    // it back, so a duplicate/stale submission for an already-answered step
    // can be told apart from a genuine one (see submitSimulationStep).
    db.prepare(
      "UPDATE SimulationAttempt SET status = 'IN_PROGRESS', startedAt = COALESCE(startedAt, datetime('now')), currentStepStartedAt = datetime('now'), stepToken = ? WHERE id = ?"
    ).run(newId(), attempt.id);
    revalidatePath(`/candidate/applications/${applicationId}`);
  }
  const updated = db
    .prepare("SELECT startedAt, currentStep, currentStepStartedAt, stepToken FROM SimulationAttempt WHERE id = ?")
    .get(attempt.id);

  return {
    success: true,
    startedAt: updated.startedAt,
    currentStep: updated.currentStep,
    currentStepStartedAt: updated.currentStepStartedAt,
    stepToken: updated.stepToken,
    // The scenario text is only ever sent to the client from here — never as
    // part of the initial page load — so there's no way to read it, go ask
    // an AI somewhere else, and come back with an answer ready before the
    // clock starts.
    scenario: {
      senderName: simulation.senderName,
      senderNameAr: simulation.senderNameAr,
      senderRole: simulation.senderRole,
      senderRoleAr: simulation.senderRoleAr,
      emailSubject: simulation.emailSubject,
      emailSubjectAr: simulation.emailSubjectAr,
      emailBody: simulation.emailBody,
      emailBodyAr: simulation.emailBodyAr,
      instructions: simulation.instructions,
      instructionsAr: simulation.instructionsAr,
    },
  };
}

// Called when the client detects the timer already expired before any
// submission happened (e.g. the candidate closed the tab mid-test and never
// came back). Leaves whatever draft text/audio exists and just locks it.
export async function expireAttempt(applicationId, simulationId) {
  const user = await requireCandidate();
  const ctx = await loadOwnedContext(user, applicationId, simulationId);
  if (!ctx) return { error: "Simulation not found." };
  const { db, attempt } = ctx;
  if (attempt.status === "SUBMITTED") return { success: true };
  db.prepare("UPDATE SimulationAttempt SET status = 'SUBMITTED', submittedAt = datetime('now') WHERE id = ?").run(
    attempt.id
  );
  maybeAdvanceApplication(db, applicationId);
  revalidatePath(`/candidate/applications/${applicationId}`);
  return { success: true };
}

export async function saveDraft(applicationId, simulationId, prevState, formData) {
  const user = await requireCandidate();
  const ctx = await loadOwnedContext(user, applicationId, simulationId);
  if (!ctx) return { error: "Simulation not found." };
  const { db, attempt } = ctx;
  if (attempt.status === "SUBMITTED") return { error: "This response was already submitted." };

  const responseText = String(formData.get("responseText") || "");
  db.prepare(
    "UPDATE SimulationAttempt SET responseText = ?, status = 'IN_PROGRESS', startedAt = COALESCE(startedAt, datetime('now')) WHERE id = ?"
  ).run(responseText, attempt.id);

  revalidatePath(`/candidate/applications/${applicationId}`);
  return { success: "Draft saved." };
}

// Handles one text reply (EMAIL and CHAT channels) for whichever step the
// attempt is currently on. For simulations with more than one step, this
// asks Gemini to generate the next message from the scenario's persona and
// advances the attempt to the next step; on the final step it submits.
export async function submitSimulationStep(applicationId, simulationId, prevState, formData) {
  const user = await requireCandidate();
  const ctx = await loadOwnedContext(user, applicationId, simulationId);
  if (!ctx) return { error: "Simulation not found." };
  const { db, job, attempt, simulation } = ctx;
  if (attempt.status === "SUBMITTED") return { error: "This response was already submitted." };
  if (attempt.status === "NOT_STARTED") return { error: "Please start the test first." };

  const gate = checkSequenceGate(db, job.id, simulationId, applicationId);
  if (gate) return { error: gate };

  const responseText = String(formData.get("responseText") || "").trim();
  const auto = formData.get("auto") === "1";
  if (!responseText && !auto) return { error: "Please write a response before submitting." };

  const step = attempt.currentStep;

  // Guards against the same reply landing twice as two DIFFERENT steps' —
  // e.g. the auto-submit timer firing just as a manual submit for this same
  // step was already mid-flight, which previously could record the exact
  // same stale text as the reply to the step AFTER this one too. Every step
  // issues a one-time token when it starts (see startAttempt and the step
  // advance below); a submission that doesn't carry the CURRENT token is
  // stale and gets silently dropped — not recorded as a reply at all —
  // rather than processed as a second, different step's answer. (A missing
  // attempt.stepToken means this attempt predates the token being added;
  // it self-heals once this request mints the first one below.)
  const submittedToken = String(formData.get("stepToken") || "");
  if (attempt.stepToken && submittedToken !== attempt.stepToken) {
    return { duplicate: true };
  }
  // Belt-and-suspenders for a tighter race (two requests landing concurrently
  // before either's token check/step-advance has committed): if this exact
  // step already has a recorded candidate reply, this request is a duplicate
  // of it — don't call Gemini again or insert a second turn.
  const alreadyCandidate = db
    .prepare("SELECT 1 FROM SimulationTurn WHERE attemptId = ? AND stepIndex = ? AND speaker = 'CANDIDATE'")
    .get(attempt.id, step);
  if (alreadyCandidate) {
    return { duplicate: true };
  }

  db.prepare(
    "INSERT INTO SimulationTurn (id, attemptId, stepIndex, speaker, text) VALUES (?, ?, ?, 'CANDIDATE', ?)"
  ).run(newId(), attempt.id, step, responseText);
  db.prepare("UPDATE SimulationAttempt SET responseText = ? WHERE id = ?").run(responseText, attempt.id);

  if (step < simulation.totalSteps) {
    const conversationSoFar = buildConversationText(db, attempt, simulation);
    // Pin the AI's language to whatever the candidate's very first reply was
    // in, so a conversation that started in Arabic stays in Arabic the whole
    // way through instead of Gemini drifting back to English.
    const firstReplyText = getFirstCandidateReplyText(db, attempt.id) || responseText;
    const candidateLanguage = detectReplyLanguage(firstReplyText);
    let aiMessage;
    try {
      aiMessage = await generateFollowUpMessage({
        simulation,
        conversationSoFar,
        latestCandidateReply: responseText,
        stepIndex: step,
        totalSteps: simulation.totalSteps,
        candidateLanguage,
      });
    } catch {
      // Never let a flaky AI call break the candidate's test — fall back to
      // a neutral nudge that keeps the conversation moving, in the same
      // language the candidate has been using.
      aiMessage = candidateLanguage === "ar" ? "تمام — وبعد ذلك، هتعمل إيه؟" : "Okay — and what would you do next?";
    }
    // This step was just confirmed un-processed above (alreadyCandidate was
    // false), so the AI turn for it is guaranteed new too — no need to
    // re-check before inserting.
    db.prepare(
      "INSERT INTO SimulationTurn (id, attemptId, stepIndex, speaker, text) VALUES (?, ?, ?, 'AI', ?)"
    ).run(newId(), attempt.id, step, aiMessage);
    const nextStepToken = newId();
    db.prepare(
      "UPDATE SimulationAttempt SET currentStep = ?, currentStepStartedAt = datetime('now'), stepToken = ? WHERE id = ?"
    ).run(step + 1, nextStepToken, attempt.id);
    const nextStepStartedAt = db
      .prepare("SELECT currentStepStartedAt FROM SimulationAttempt WHERE id = ?")
      .get(attempt.id)?.currentStepStartedAt;
    revalidatePath(`/candidate/applications/${applicationId}`);
    return {
      success: auto ? "Time's up — your reply was submitted automatically." : "Reply sent.",
      nextMessage: aiMessage,
      nextStep: step + 1,
      nextStepStartedAt,
      nextStepToken,
      done: false,
      candidateTurn: { id: newId(), speaker: "CANDIDATE", stepIndex: step, text: responseText },
    };
  }

  db.prepare(
    "UPDATE SimulationAttempt SET status = 'SUBMITTED', startedAt = COALESCE(startedAt, datetime('now')), submittedAt = datetime('now') WHERE id = ?"
  ).run(attempt.id);
  maybeAdvanceApplication(db, applicationId);
  revalidatePath(`/candidate/applications/${applicationId}`);
  return {
    success: auto ? "Time's up — your response was submitted automatically." : "Response submitted.",
    done: true,
  };
}

// Handles one recorded reply (VOICE channel) for the attempt's current step.
export async function submitVoiceStep(applicationId, simulationId, prevState, formData) {
  const user = await requireCandidate();
  const ctx = await loadOwnedContext(user, applicationId, simulationId);
  if (!ctx) return { error: "Simulation not found." };
  const { db, job, attempt, simulation } = ctx;
  if (attempt.status === "SUBMITTED") return { error: "This response was already submitted." };
  if (attempt.status === "NOT_STARTED") return { error: "Please start the test first." };

  const gate = checkSequenceGate(db, job.id, simulationId, applicationId);
  if (gate) return { error: gate };

  const file = formData.get("audio");
  if (!file || typeof file !== "object" || file.size === 0) {
    return { error: "No recording was received — please record your response before submitting." };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { error: "Recording is too large (max 15MB)." };
  }

  const step = attempt.currentStep;

  // Same duplicate guard as submitSimulationStep — stop a stale re-submit
  // (e.g. the auto-stop-on-timeout recorder firing just as a manual "Stop &
  // send" was already mid-flight) before it gets as far as saving the file
  // or transcribing it.
  const submittedToken = String(formData.get("stepToken") || "");
  if (attempt.stepToken && submittedToken !== attempt.stepToken) {
    return { duplicate: true };
  }
  const alreadyCandidate = db
    .prepare("SELECT 1 FROM SimulationTurn WHERE attemptId = ? AND stepIndex = ? AND speaker = 'CANDIDATE'")
    .get(attempt.id, step);
  if (alreadyCandidate) {
    return { duplicate: true };
  }

  await fs.mkdir(VOICE_STORAGE_DIR, { recursive: true });
  const rawExt = file.type ? file.type.split("/")[1]?.split(";")[0] : null;
  const ext = rawExt && /^[a-z0-9]+$/i.test(rawExt) ? rawExt : "webm";
  const storedName = `${newId()}.${ext}`;
  const storedPath = path.join(VOICE_STORAGE_DIR, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storedPath, bytes);

  const turnId = newId();
  db.prepare(
    "INSERT INTO SimulationTurn (id, attemptId, stepIndex, speaker, audioUrl, audioName) VALUES (?, ?, ?, 'CANDIDATE', ?, ?)"
  ).run(turnId, attempt.id, step, storedName, file.name || storedName);

  let transcript = null;
  try {
    transcript = await transcribeAudioFile(storedPath, {
      mimeType: file.type || "audio/webm",
      fileName: storedName,
    });
    db.prepare("UPDATE SimulationTurn SET transcript = ?, transcriptError = NULL WHERE id = ?").run(transcript, turnId);
  } catch (err) {
    db.prepare("UPDATE SimulationTurn SET transcriptError = ? WHERE id = ?").run(String(err?.message || err), turnId);
  }

  if (step < simulation.totalSteps) {
    const conversationSoFar = buildConversationText(db, attempt, simulation);
    const firstReplyText = getFirstCandidateReplyText(db, attempt.id) || transcript;
    const candidateLanguage = detectReplyLanguage(firstReplyText);
    let aiMessage;
    try {
      aiMessage = await generateFollowUpMessage({
        simulation,
        conversationSoFar,
        latestCandidateReply: transcript || "(the candidate's recording could not be transcribed)",
        stepIndex: step,
        totalSteps: simulation.totalSteps,
        candidateLanguage,
      });
    } catch {
      aiMessage = candidateLanguage === "ar" ? "كمّل — هتعمل إيه بعد ذلك؟" : "Go on — what would you do next?";
    }
    db.prepare(
      "INSERT INTO SimulationTurn (id, attemptId, stepIndex, speaker, text) VALUES (?, ?, ?, 'AI', ?)"
    ).run(newId(), attempt.id, step, aiMessage);
    const nextStepToken = newId();
    db.prepare(
      "UPDATE SimulationAttempt SET currentStep = ?, currentStepStartedAt = datetime('now'), stepToken = ? WHERE id = ?"
    ).run(step + 1, nextStepToken, attempt.id);
    const nextStepStartedAt = db
      .prepare("SELECT currentStepStartedAt FROM SimulationAttempt WHERE id = ?")
      .get(attempt.id)?.currentStepStartedAt;
    revalidatePath(`/candidate/applications/${applicationId}`);
    return {
      success: "Recording submitted.",
      nextStepToken,
      nextMessage: aiMessage,
      nextStep: step + 1,
      nextStepStartedAt,
      done: false,
      candidateTurn: { id: turnId, speaker: "CANDIDATE", stepIndex: step, audioUrl: storedName, transcript, transcriptError: transcript ? null : "Transcription failed" },
    };
  }

  db.prepare(
    "UPDATE SimulationAttempt SET status = 'SUBMITTED', startedAt = COALESCE(startedAt, datetime('now')), submittedAt = datetime('now') WHERE id = ?"
  ).run(attempt.id);
  maybeAdvanceApplication(db, applicationId);
  revalidatePath(`/candidate/applications/${applicationId}`);
  return { success: "Recording submitted.", done: true };
}
