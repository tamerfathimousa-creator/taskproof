import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StatusPill from "@/components/StatusPill";

export default async function CandidateDashboard() {
  const user = await getCurrentUser();
  const db = getDb();
  const candidateId = user.candidateProfile.id;

  const applications = db
    .prepare(
      `SELECT Application.*, Job.title as jobTitle, Company.name as companyName,
              SimulationAttempt.status as attemptStatus
       FROM Application
       JOIN Job ON Job.id = Application.jobId
       JOIN Company ON Company.id = Job.companyId
       LEFT JOIN SimulationAttempt ON SimulationAttempt.applicationId = Application.id
       WHERE Application.candidateId = ?
       ORDER BY Application.appliedAt DESC`
    )
    .all(candidateId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Welcome, {user.candidateProfile.fullName.split(" ")[0]}</h1>
        <Link href="/candidate/jobs" className="btn-primary">
          Browse jobs
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="text-xs uppercase tracking-wide text-muted font-medium">Applications</div>
          <div className="text-3xl font-extrabold mt-1">{applications.length}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs uppercase tracking-wide text-muted font-medium">Awaiting your response</div>
          <div className="text-3xl font-extrabold mt-1 text-warm">
            {applications.filter((a) => a.attemptStatus && a.attemptStatus !== "SUBMITTED").length}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Your applications</h2>
        {applications.length === 0 ? (
          <p className="text-sm text-muted">
            You haven&apos;t applied to any jobs yet.{" "}
            <Link href="/candidate/jobs" className="text-accent font-semibold">
              Browse open roles
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {applications.map((a) => (
              <Link
                key={a.id}
                href={`/candidate/applications/${a.id}`}
                className="card p-4 flex items-center justify-between hover:border-accent transition-colors"
              >
                <div>
                  <div className="font-semibold">{a.jobTitle}</div>
                  <div className="text-xs text-muted">{a.companyName}</div>
                </div>
                <div className="flex items-center gap-2">
                  {a.attemptStatus && <StatusPill status={a.attemptStatus} />}
                  <StatusPill status={a.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
