import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb, plain } from "@/lib/db";
import StatusPill from "@/components/StatusPill";
import ResponseForm from "./ResponseForm";

export default async function ApplicationPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();

  const application = db
    .prepare(
      `SELECT Application.*, Job.title as jobTitle, Company.name as companyName
       FROM Application
       JOIN Job ON Job.id = Application.jobId
       JOIN Company ON Company.id = Job.companyId
       WHERE Application.id = ? AND Application.candidateId = ?`
    )
    .get(params.id, user.candidateProfile.id);
  if (!application) notFound();

  const attempt = plain(db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").get(application.id));
  const simulation = attempt ? plain(db.prepare("SELECT * FROM Simulation WHERE id = ?").get(attempt.simulationId)) : null;

  const evaluation =
    application.status === "SHORTLISTED" || application.status === "REJECTED"
      ? db.prepare("SELECT * FROM Evaluation WHERE applicationId = ?").get(application.id)
      : null;

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <Link href="/candidate/dashboard" className="text-sm text-accent font-semibold">
        ← Dashboard
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{application.jobTitle}</h1>
          <p className="text-sm text-muted">{application.companyName}</p>
        </div>
        <StatusPill status={application.status} />
      </div>

      {!simulation ? (
        <p className="text-sm text-muted">This role has no simulation task — your application is with the company.</p>
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-line bg-surface2 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted">
                  {simulation.senderName} · {simulation.senderRole}
                </div>
                <div className="font-semibold">{simulation.emailSubject}</div>
              </div>
              <span className="pill bg-line text-muted whitespace-nowrap">
                {simulation.channel === "VOICE" ? "Voice" : simulation.channel === "CHAT" ? "Chat" : "Email"}
              </span>
            </div>
            <div className="px-5 py-4 whitespace-pre-wrap text-sm">{simulation.emailBody}</div>
            <div className="px-5 py-3 border-t border-line text-xs text-muted bg-surface2">
              {simulation.instructions}
            </div>
          </div>

          <ResponseForm applicationId={application.id} attempt={attempt} simulation={simulation} />

          {evaluation && (
            <div className="card p-5">
              <div className="text-xs uppercase text-muted font-medium mb-1">Result</div>
              <div className="text-2xl font-extrabold">{application.status === "SHORTLISTED" ? "Shortlisted" : "Not selected"}</div>
              {evaluation.notes && <p className="text-sm text-muted mt-2">{evaluation.notes}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
