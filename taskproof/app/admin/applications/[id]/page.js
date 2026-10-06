import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, plainAll, getJobSimulations, getSimulationTurns, getApplicationCriteria } from "@/lib/db";
import StatusPill from "@/components/StatusPill";
import TurnTranscript from "@/components/TurnTranscript";

// Admin's view of a single application: everything a company reviewer sees,
// plus what's deliberately kept out of that screen — Jev's raw confidence
// number per criterion. Read-only by design; admin isn't part of the hiring
// workflow, just oversight.
export default async function AdminApplicationPage({ params }) {
  const db = getDb();

  const application = db
    .prepare(
      `SELECT Application.*, Job.id as jobId, Job.title as jobTitle,
              Company.name as companyName, Company.id as companyId,
              CandidateProfile.fullName, CandidateProfile.phone, CandidateProfile.location,
              CandidateProfile.currentTitle, CandidateProfile.summary,
              User.email as candidateEmail
       FROM Application
       JOIN Job ON Job.id = Application.jobId
       JOIN Company ON Company.id = Job.companyId
       JOIN CandidateProfile ON CandidateProfile.id = Application.candidateId
       JOIN User ON User.id = CandidateProfile.userId
       WHERE Application.id = ?`
    )
    .get(params.id);
  if (!application) notFound();

  const jobSims = getJobSimulations(db, application.jobId);
  const attempts = db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").all(application.id);
  const attemptBySimId = Object.fromEntries(attempts.map((a) => [a.simulationId, a]));

  const criteria = plainAll(getApplicationCriteria(db, application.id));
  const criterionById = Object.fromEntries(criteria.map((c) => [c.id, c]));

  const evaluation = db.prepare("SELECT * FROM Evaluation WHERE applicationId = ?").get(application.id);
  const evaluator = evaluation ? db.prepare("SELECT email FROM User WHERE id = ?").get(evaluation.reviewerId) : null;
  const evalScores = evaluation
    ? db.prepare("SELECT * FROM EvaluationScore WHERE evaluationId = ?").all(evaluation.id)
    : [];

  const aiRow = db.prepare("SELECT * FROM AiSuggestion WHERE applicationId = ?").get(application.id);
  const aiScores = aiRow ? JSON.parse(aiRow.scoresJson || "{}") : {};

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <Link href="/admin/dashboard" className="text-sm text-accent font-semibold">
          ← Admin overview
        </Link>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{application.fullName}</h1>
          <p className="text-xs text-muted">
            {application.candidateEmail} · applied to <span className="font-medium">{application.jobTitle}</span> at{" "}
            <span className="font-medium">{application.companyName}</span>
          </p>
        </div>
        <StatusPill status={application.status} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <div className="card p-4">
          <div className="text-xs uppercase text-muted font-medium mb-2">Candidate details</div>
          <div className="flex flex-col gap-1">
            <div>
              <span className="text-muted">Title: </span>
              {application.currentTitle || "—"}
            </div>
            <div>
              <span className="text-muted">Location: </span>
              {application.location || "—"}
            </div>
            <div>
              <span className="text-muted">Phone: </span>
              {application.phone || "—"}
            </div>
          </div>
          {application.summary && <p className="mt-2 text-muted">{application.summary}</p>}
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase text-muted font-medium mb-2">Application</div>
          <div className="flex flex-col gap-1">
            <div>
              <span className="text-muted">Applied: </span>
              {(application.appliedAt || "").slice(0, 16).replace("T", " ")}
            </div>
            <div>
              <span className="text-muted">Company: </span>
              {application.companyName}
            </div>
            <div>
              <span className="text-muted">Status: </span>
              {application.status}
            </div>
          </div>
        </div>
      </div>

      {jobSims.length === 0 ? (
        <p className="text-sm text-muted">This job has no simulation assigned.</p>
      ) : (
        jobSims.map((sim, i) => {
          const attempt = attemptBySimId[sim.id];
          const label = jobSims.length > 1 ? `Simulation ${i + 1} of ${jobSims.length}: ${sim.title}` : sim.title;
          return (
            <div key={sim.id} className="card p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-line bg-surface2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-muted">{label}</div>
                  <div className="font-semibold">
                    {sim.senderName} · {sim.senderRole}
                  </div>
                </div>
                <StatusPill status={attempt?.status || "NOT_STARTED"} />
              </div>
              <div className="px-5 py-4">
                {attempt?.status !== "SUBMITTED" ? (
                  <p className="text-sm text-muted">The candidate hasn&apos;t submitted a response yet.</p>
                ) : (
                  <TurnTranscript
                    openingSender={sim.senderName}
                    openingMessage={sim.emailBody}
                    turns={plainAll(getSimulationTurns(db, attempt.id))}
                    channel={sim.channel}
                    showAudio
                  />
                )}
              </div>
            </div>
          );
        })
      )}

      <div className="card p-5 flex flex-col gap-3">
        <div className="text-xs uppercase text-muted font-medium">Jev AI suggestion (admin view — includes confidence)</div>
        {!aiRow ? (
          <p className="text-sm text-muted">No AI suggestion has been generated for this application yet.</p>
        ) : aiRow.error ? (
          <p className="text-sm text-bad">Last attempt failed: {aiRow.error}</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {Object.entries(aiScores).map(([criterionId, s]) => {
                const c = criterionById[criterionId];
                if (!c) return null;
                return (
                  <div key={criterionId} className="text-sm flex items-start justify-between gap-3">
                    <div>
                      <span className="font-medium">{c.name}: </span>
                      <span className="text-muted">
                        {s.score}/{c.maxScore}
                        {typeof s.confidence === "number" ? ` — ${s.confidence}% confidence` : " — confidence unavailable"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {aiRow.notes && <p className="text-sm text-muted border-t border-line pt-2">{aiRow.notes}</p>}
            <p className="text-xs text-muted">
              Model: {aiRow.model} · generated {(aiRow.createdAt || "").slice(0, 16).replace("T", " ")}
            </p>
          </>
        )}
      </div>

      <div className="card p-5 flex flex-col gap-3">
        <div className="text-xs uppercase text-muted font-medium">Saved evaluation</div>
        {!evaluation ? (
          <p className="text-sm text-muted">No evaluation has been saved by the company yet.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {evalScores.map((s) => {
                const c = criterionById[s.criterionId];
                return (
                  <div key={s.id} className="text-sm flex items-center justify-between gap-3">
                    <span className="font-medium">{c?.name || s.criterionId}</span>
                    <span className="tabular-nums">
                      {s.score}/{c?.maxScore ?? "?"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-line pt-2 flex items-center justify-between">
              <span className="text-muted text-sm">Total</span>
              <span className="text-xl font-extrabold tabular-nums">{evaluation.totalScore}</span>
            </div>
            {evaluation.notes && <p className="text-sm text-muted">{evaluation.notes}</p>}
            <p className="text-xs text-muted">
              Reviewed by {evaluator?.email || "unknown"} · {(evaluation.updatedAt || "").slice(0, 16).replace("T", " ")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
