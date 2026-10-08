import Link from "next/link";
import { getDb } from "@/lib/db";
import StatusPill from "@/components/StatusPill";

export default async function AdminDashboardPage() {
  const db = getDb();

  const counts = {
    companies: db.prepare("SELECT COUNT(*) c FROM Company").get().c,
    candidates: db.prepare("SELECT COUNT(*) c FROM CandidateProfile").get().c,
    jobs: db.prepare("SELECT COUNT(*) c FROM Job").get().c,
    applications: db.prepare("SELECT COUNT(*) c FROM Application").get().c,
    evaluations: db.prepare("SELECT COUNT(*) c FROM Evaluation").get().c,
    aiSuggestions: db.prepare("SELECT COUNT(*) c FROM AiSuggestion WHERE error IS NULL").get().c,
  };

  const companies = db
    .prepare(
      `SELECT Company.id, Company.name, Company.createdAt, User.email,
              (SELECT COUNT(*) FROM Job WHERE Job.companyId = Company.id) AS jobCount,
              (SELECT COUNT(*) FROM Application
                 JOIN Job ON Job.id = Application.jobId
                 WHERE Job.companyId = Company.id) AS applicationCount
       FROM Company JOIN User ON User.id = Company.userId
       ORDER BY Company.createdAt DESC`
    )
    .all();

  const recentApplications = db
    .prepare(
      `SELECT Application.id, Application.status, Application.appliedAt,
              Job.title AS jobTitle, Company.name AS companyName,
              CandidateProfile.fullName AS candidateName,
              (SELECT 1 FROM Evaluation WHERE Evaluation.applicationId = Application.id) AS hasEvaluation,
              (SELECT 1 FROM AiSuggestion WHERE AiSuggestion.applicationId = Application.id AND AiSuggestion.error IS NULL) AS hasAiSuggestion
       FROM Application
       JOIN Job ON Job.id = Application.jobId
       JOIN Company ON Company.id = Job.companyId
       JOIN CandidateProfile ON CandidateProfile.id = Application.candidateId
       ORDER BY Application.appliedAt DESC
       LIMIT 50`
    )
    .all();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Admin overview</h1>
        <p className="text-sm text-muted mt-1">
          Read-only visibility across every company and candidate on the platform — including the Jev confidence
          figures left out of the company-facing review screen.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {[
          ["Companies", counts.companies],
          ["Candidates", counts.candidates],
          ["Jobs", counts.jobs],
          ["Applications", counts.applications],
          ["Evaluations", counts.evaluations],
          ["AI suggestions", counts.aiSuggestions],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-2xl font-extrabold tabular-nums">{value}</div>
            <div className="text-xs text-muted mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-line bg-surface2 font-semibold text-sm">Companies</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="px-5 py-2">Company</th>
                <th className="px-5 py-2">Owner email</th>
                <th className="px-5 py-2">Jobs</th>
                <th className="px-5 py-2">Applications</th>
                <th className="px-5 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-5 py-2 font-medium">{c.name}</td>
                  <td className="px-5 py-2 text-muted">{c.email}</td>
                  <td className="px-5 py-2 tabular-nums">{c.jobCount}</td>
                  <td className="px-5 py-2 tabular-nums">{c.applicationCount}</td>
                  <td className="px-5 py-2 text-muted">{(c.createdAt || "").slice(0, 10)}</td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-4 text-muted text-center">
                    No companies yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-line bg-surface2 font-semibold text-sm">
          Recent applications (latest 50)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="px-5 py-2">Candidate</th>
                <th className="px-5 py-2">Job</th>
                <th className="px-5 py-2">Company</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">AI suggestion</th>
                <th className="px-5 py-2">Evaluated</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {recentApplications.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-5 py-2 font-medium">{a.candidateName}</td>
                  <td className="px-5 py-2">{a.jobTitle}</td>
                  <td className="px-5 py-2 text-muted">{a.companyName}</td>
                  <td className="px-5 py-2">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="px-5 py-2 text-muted">{a.hasAiSuggestion ? "Yes" : "—"}</td>
                  <td className="px-5 py-2 text-muted">{a.hasEvaluation ? "Yes" : "—"}</td>
                  <td className="px-5 py-2">
                    <Link href={`/admin/applications/${a.id}`} className="text-accent font-semibold">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {recentApplications.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-4 text-muted text-center">
                    No applications yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
