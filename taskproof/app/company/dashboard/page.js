import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import StatusPill from "@/components/StatusPill";

export default async function CompanyDashboard() {
  const user = await getCurrentUser();
  const db = getDb();
  const companyId = user.company.id;

  const openJobs = db.prepare("SELECT COUNT(*) c FROM Job WHERE companyId = ? AND status = 'OPEN'").get(companyId).c;
  const totalApplicants = db
    .prepare(
      `SELECT COUNT(*) c FROM Application JOIN Job ON Job.id = Application.jobId WHERE Job.companyId = ?`
    )
    .get(companyId).c;
  const awaitingReview = db
    .prepare(
      `SELECT COUNT(*) c FROM Application JOIN Job ON Job.id = Application.jobId
       WHERE Job.companyId = ? AND Application.status = 'SIMULATION_SUBMITTED'`
    )
    .get(companyId).c;

  const recentJobs = db
    .prepare(
      `SELECT Job.*, (SELECT COUNT(*) FROM Application WHERE Application.jobId = Job.id) as applicantCount
       FROM Job WHERE companyId = ? ORDER BY createdAt DESC LIMIT 5`
    )
    .all(companyId);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">{user.company.name}</h1>
        <Link href="/company/jobs/new" className="btn-primary">
          + New job
        </Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Open jobs" value={openJobs} />
        <Stat label="Total applicants" value={totalApplicants} />
        <Stat label="Awaiting review" value={awaitingReview} accent />
      </div>

      <div>
        <h2 className="font-semibold mb-3">Recent jobs</h2>
        {recentJobs.length === 0 ? (
          <p className="text-sm text-muted">
            No jobs yet.{" "}
            <Link href="/company/jobs/new" className="text-accent font-semibold">
              Create your first job
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentJobs.map((j) => (
              <Link
                key={j.id}
                href={`/company/jobs/${j.id}`}
                className="card p-4 flex items-center justify-between hover:border-accent transition-colors"
              >
                <div>
                  <div className="font-semibold">{j.title}</div>
                  <div className="text-xs text-muted">{j.applicantCount} applicant(s)</div>
                </div>
                <StatusPill status={j.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wide text-muted font-medium">{label}</div>
      <div className={`text-3xl font-extrabold mt-1 ${accent ? "text-warm" : ""}`}>{value}</div>
    </div>
  );
}
