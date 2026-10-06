import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb, getJobSimulations } from "@/lib/db";
import StatusPill from "@/components/StatusPill";

export default async function ApplicantsPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();
  const job = db.prepare("SELECT * FROM Job WHERE id = ? AND companyId = ?").get(params.id, user.company.id);
  if (!job) notFound();

  const jobSims = getJobSimulations(db, job.id);
  const maxTotal = jobSims.reduce(
    (sum, s) => sum + (db.prepare("SELECT SUM(maxScore) t FROM EvaluationCriterion WHERE simulationId = ?").get(s.id).t || 0),
    0
  );

  const applicants = db
    .prepare(
      `SELECT Application.id as applicationId, Application.status, Application.appliedAt,
              CandidateProfile.fullName, User.email,
              Evaluation.totalScore
       FROM Application
       JOIN CandidateProfile ON CandidateProfile.id = Application.candidateId
       JOIN User ON User.id = CandidateProfile.userId
       LEFT JOIN Evaluation ON Evaluation.applicationId = Application.id
       WHERE Application.jobId = ?
       ORDER BY Application.appliedAt DESC`
    )
    .all(job.id);

  // Aggregate simulation progress per applicant: SUBMITTED only once every
  // attached simulation is submitted, IN_PROGRESS if any is underway.
  const attemptStatusCounts = db
    .prepare(
      `SELECT applicationId, status, COUNT(*) c FROM SimulationAttempt
       WHERE applicationId IN (SELECT id FROM Application WHERE jobId = ?)
       GROUP BY applicationId, status`
    )
    .all(job.id);
  const byApplication = {};
  for (const row of attemptStatusCounts) {
    byApplication[row.applicationId] = byApplication[row.applicationId] || {};
    byApplication[row.applicationId][row.status] = row.c;
  }
  function aggregateAttemptStatus(applicationId) {
    const counts = byApplication[applicationId];
    if (!counts) return "NOT_STARTED";
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (counts.SUBMITTED === total) return "SUBMITTED";
    if (counts.IN_PROGRESS || counts.SUBMITTED) return "IN_PROGRESS";
    return "NOT_STARTED";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/company/jobs/${job.id}`} className="text-sm text-accent font-semibold">
          ← {job.title}
        </Link>
        <h1 className="text-2xl font-bold mt-1">Applicants</h1>
      </div>

      {applicants.length === 0 ? (
        <p className="text-sm text-muted">No applicants yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Applied</th>
                <th className="text-left px-4 py-3 font-medium">Simulation</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {applicants.map((a) => (
                <tr key={a.applicationId} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.fullName}</div>
                    <div className="text-xs text-muted">{a.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">{a.appliedAt?.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={aggregateAttemptStatus(a.applicationId)} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums">
                    {a.totalScore != null ? `${a.totalScore} / ${maxTotal || "—"}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/company/candidates/${a.applicationId}`} className="text-accent font-semibold">
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
