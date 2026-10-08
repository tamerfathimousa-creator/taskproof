import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export default async function PublicJobDetailPage({ params }) {
  const db = getDb();
  const job = db
    .prepare(
      `SELECT Job.*, Company.name as companyName FROM Job
       JOIN Company ON Company.id = Job.companyId WHERE Job.id = ?`
    )
    .get(params.id);
  if (!job || job.status !== "OPEN") notFound();

  const user = await getCurrentUser();
  if (user?.role === "CANDIDATE") redirect(`/candidate/jobs/${job.id}`);

  return (
    <main className="max-w-2xl mx-auto px-5 md:px-0 py-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/login" className="text-sm text-muted hover:text-ink">
          Log in
        </Link>
      </div>

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
        <Link href={`/signup?as=candidate&next=/candidate/jobs/${job.id}`} className="btn-primary self-start mt-2">
          Apply now
        </Link>
      </div>
    </main>
  );
}
