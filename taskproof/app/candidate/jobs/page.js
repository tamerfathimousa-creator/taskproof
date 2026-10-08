import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function CandidateJobsPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT Job.*, Company.name as companyName,
              (SELECT id FROM Application WHERE Application.jobId = Job.id AND Application.candidateId = ?) as myApplicationId
       FROM Job JOIN Company ON Company.id = Job.companyId
       WHERE Job.status = 'OPEN' ORDER BY Job.createdAt DESC`
    )
    .all(user.candidateProfile.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Open roles</h1>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No open roles right now — check back soon.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((j) => (
            <Link
              key={j.id}
              href={`/candidate/jobs/${j.id}`}
              className="card p-4 flex items-center justify-between hover:border-accent transition-colors"
            >
              <div>
                <div className="text-xs text-muted">{j.companyName}</div>
                <div className="font-semibold">{j.title}</div>
                <div className="text-xs text-muted">
                  {[j.location, j.employmentType].filter(Boolean).join(" · ")}
                </div>
              </div>
              {j.myApplicationId && <span className="pill bg-accentSoft text-accent">Applied</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
