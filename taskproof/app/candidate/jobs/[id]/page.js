import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { applyToJob } from "@/actions/candidate";

export default async function CandidateJobDetailPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();
  const job = db
    .prepare(
      `SELECT Job.*, Company.name as companyName, Company.description as companyDescription
       FROM Job JOIN Company ON Company.id = Job.companyId WHERE Job.id = ?`
    )
    .get(params.id);
  if (!job || job.status !== "OPEN") notFound();

  const existing = db
    .prepare("SELECT id FROM Application WHERE jobId = ? AND candidateId = ?")
    .get(job.id, user.candidateProfile.id);

  const simulation = job.simulationId
    ? db.prepare("SELECT channel, timeLimitSeconds FROM Simulation WHERE id = ?").get(job.simulationId)
    : null;

  const applyAction = applyToJob.bind(null, job.id);

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <Link href="/candidate/jobs" className="text-sm text-accent font-semibold">
        ← All jobs
      </Link>

      <div className="card p-6 flex flex-col gap-3">
        <span className="text-xs text-muted">{job.companyName}</span>
        <h1 className="text-2xl font-bold">{job.title}</h1>
        <div className="text-sm text-muted">
          {[job.department, job.location, job.employmentType].filter(Boolean).join(" · ")}
        </div>
        <p className="text-sm whitespace-pre-wrap">{job.description}</p>
        {job.requiredSkills && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {job.requiredSkills.split(",").map((s) => (
              <span key={s} className="pill bg-line text-ink">
                {s.trim()}
              </span>
            ))}
          </div>
        )}

        {simulation && !existing && (
          <p className="text-xs text-muted bg-surface2 rounded-lg px-3 py-2">
            This role includes a {simulation.timeLimitSeconds}-second{" "}
            {simulation.channel === "VOICE" ? "voice" : simulation.channel === "CHAT" ? "chat" : "email"} simulation
            as part of applying — once you start, there&apos;s no pausing.
          </p>
        )}

        {existing ? (
          <Link href={`/candidate/applications/${existing.id}`} className="btn-secondary self-start mt-2">
            View your application
          </Link>
        ) : (
          <form action={applyAction} className="mt-2">
            <button className="btn-primary">Apply now</button>
          </form>
        )}
      </div>
    </div>
  );
}
