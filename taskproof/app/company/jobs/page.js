import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StatusPill from "@/components/StatusPill";

export default async function CompanyJobsPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT Job.*, (SELECT COUNT(*) FROM Application WHERE Application.jobId = Job.id) as applicantCount
       FROM Job WHERE companyId = ? ORDER BY createdAt DESC`
    )
    .all(user.company.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <Link href="/company/jobs/new" className="btn-primary">
          + New job
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No jobs yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((j) => (
            <Link
              key={j.id}
              href={`/company/jobs/${j.id}`}
              className="card p-4 flex items-center justify-between hover:border-accent transition-colors"
            >
              <div>
                <div className="font-semibold">{j.title}</div>
                <div className="text-xs text-muted">
                  {[j.department, j.location].filter(Boolean).join(" · ") || "—"} · {j.applicantCount} applicant(s)
                </div>
              </div>
              <StatusPill status={j.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
