import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb, plainAll } from "@/lib/db";
import StatusPill from "@/components/StatusPill";
import EvaluationForm from "./EvaluationForm";
import StatusControls from "./StatusControls";

export default async function CandidateReviewPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();

  const application = db
    .prepare(
      `SELECT Application.*, Job.title as jobTitle, Job.id as jobId,
              CandidateProfile.fullName, CandidateProfile.phone, CandidateProfile.location,
              CandidateProfile.currentTitle, CandidateProfile.summary, CandidateProfile.cvUrl, CandidateProfile.cvName,
              User.email
       FROM Application
       JOIN Job ON Job.id = Application.jobId
       JOIN CandidateProfile ON CandidateProfile.id = Application.candidateId
       JOIN User ON User.id = CandidateProfile.userId
       WHERE Application.id = ? AND Job.companyId = ?`
    )
    .get(params.applicationId, user.company.id);

  if (!application) notFound();

  const attempt = db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").get(application.id);
  const simulation = attempt ? db.prepare("SELECT * FROM Simulation WHERE id = ?").get(attempt.simulationId) : null;
  const criteria = simulation
    ? plainAll(db.prepare("SELECT * FROM EvaluationCriterion WHERE simulationId = ? ORDER BY sortOrder").all(simulation.id))
    : [];

  const evaluation = db.prepare("SELECT * FROM Evaluation WHERE applicationId = ?").get(application.id);
  const scores = evaluation
    ? db.prepare("SELECT * FROM EvaluationScore WHERE evaluationId = ?").all(evaluation.id)
    : [];
  const scoreMap = Object.fromEntries(scores.map((s) => [s.criterionId, s.score]));

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <Link href={`/company/jobs/${application.jobId}/applicants`} className="text-sm text-accent font-semibold">
          ← {application.jobTitle} applicants
        </Link>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-accentSoft text-accent grid place-items-center font-bold">
            {application.fullName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold">{application.fullName}</h1>
            <p className="text-xs text-muted">{application.email}</p>
          </div>
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
            {application.cvUrl && (
              <div>
                <a href={`/api/cv/${application.cvUrl}`} className="text-accent font-semibold">
                  Download CV
                </a>
              </div>
            )}
          </div>
          {application.summary && <p className="mt-2 text-muted">{application.summary}</p>}
        </div>

        <StatusControls applicationId={application.id} currentStatus={application.status} />
      </div>

      {!simulation ? (
        <p className="text-sm text-muted">This job has no simulation assigned.</p>
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-line bg-surface2 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted">
                  {simulation.senderName} · {simulation.senderRole}
                </div>
                <div className="font-semibold">{simulation.emailSubject}</div>
              </div>
              <StatusPill status={attempt.status} />
            </div>
            <div className="px-5 py-4 whitespace-pre-wrap text-sm">{simulation.emailBody}</div>
          </div>

          {attempt.status !== "SUBMITTED" ? (
            <p className="text-sm text-muted">The candidate hasn&apos;t submitted a response yet.</p>
          ) : (
            <>
              <div className="card p-5">
                <div className="text-xs uppercase text-muted font-medium mb-2">
                  Candidate&apos;s response · submitted {attempt.submittedAt?.slice(0, 16).replace("T", " ")}
                </div>
                <p className="whitespace-pre-wrap text-sm border-l-2 border-accent pl-4">{attempt.responseText}</p>
              </div>

              <EvaluationForm applicationId={application.id} criteria={criteria} scoreMap={scoreMap} notes={evaluation?.notes || ""} />
            </>
          )}
        </>
      )}
    </div>
  );
}
