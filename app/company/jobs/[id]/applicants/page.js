import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StatusPill from "@/components/StatusPill";

export default async function ApplicantsPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();
  const job = db.prepare("SELECT * FROM Job WHERE id = ? AND companyId = ?").get(params.id, user.company.id);
  if (!job) notFound();

  const applicants = db
    .prepare(
      `SELECT Application.id as applicationId, Application.status, Application.appliedAt,
              CandidateProfile.fullName, User.email,
              SimulationAttempt.status as attemptStatus,
              Evaluation.totalScore,
              (SELECT SUM(maxScore) FROM EvaluationCriterion WHERE simulationId = SimulationAttempt.simulationId) as maxTotal
       FROM Application
       JOIN CandidateProfile ON CandidateProfile.id = Application.candidateId
       JOIN User ON User.id = CandidateProfile.userId
       LEFT JOIN SimulationAttempt ON SimulationAttempt.applicationId = Application.id
       LEFT JOIN Evaluation ON Evaluation.applicationId = Application.id
       WHERE Application.jobId = ?
       ORDER BY Application.appliedAt DESC`
    )
    .all(job.id);

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
                    <StatusPill status={a.attemptStatus || "NOT_STARTED"} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums">
                    {a.totalScore != null ? `${a.totalScore} / ${a.maxTotal ?? "—"}` : "—"}
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
