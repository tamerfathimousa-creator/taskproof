import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb, plain, plainAll, getJobSimulations } from "@/lib/db";
import { updateJob, setJobStatus } from "@/actions/company";
import JobForm from "../JobForm";
import StatusPill from "@/components/StatusPill";

export default async function JobDetailPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();
  const job = plain(db.prepare("SELECT * FROM Job WHERE id = ? AND companyId = ?").get(params.id, user.company.id));
  if (!job) notFound();

  const templates = plainAll(db.prepare("SELECT id, title, channel FROM Simulation WHERE isTemplate = 1 ORDER BY title").all());
  const custom = plainAll(
    db.prepare("SELECT id, title, channel FROM Simulation WHERE companyId = ? ORDER BY createdAt DESC").all(user.company.id)
  );

  const applicantCount = db.prepare("SELECT COUNT(*) c FROM Application WHERE jobId = ?").get(job.id).c;
  const jobSimulationIds = getJobSimulations(db, job.id).map((s) => s.id);

  const updateJobWithId = updateJob.bind(null, job.id);

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <StatusPill status={job.status} />
        </div>
        <Link href={`/company/jobs/${job.id}/applicants`} className="btn-secondary">
          View applicants ({applicantCount})
        </Link>
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">Status:</span>
        <form action={setJobStatus.bind(null, job.id, "DRAFT")}>
          <button className="btn-secondary" disabled={job.status === "DRAFT"}>
            Draft
          </button>
        </form>
        <form action={setJobStatus.bind(null, job.id, "OPEN")}>
          <button className="btn-primary" disabled={job.status === "OPEN"}>
            Open · candidates can apply
          </button>
        </form>
        <form action={setJobStatus.bind(null, job.id, "CLOSED")}>
          <button className="btn-danger" disabled={job.status === "CLOSED"}>
            Close
          </button>
        </form>
      </div>

      <JobForm action={updateJobWithId} job={job} simulations={{ templates, custom }} jobSimulationIds={jobSimulationIds} />
    </div>
  );
}
