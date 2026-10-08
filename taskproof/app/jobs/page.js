import Link from "next/link";
import Logo from "@/components/Logo";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function PublicJobsPage() {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT Job.*, Company.name as companyName FROM Job
       JOIN Company ON Company.id = Job.companyId
       WHERE Job.status = 'OPEN' ORDER BY Job.createdAt DESC`
    )
    .all();

  return (
    <main className="max-w-4xl mx-auto px-5 md:px-0 py-10 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/login" className="text-sm text-muted hover:text-ink">
          Log in
        </Link>
      </div>
      <h1 className="text-2xl font-bold">Open roles</h1>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No open roles right now — check back soon.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card p-4 flex flex-col hover:border-accent transition-colors">
              <span className="text-xs text-muted">{j.companyName}</span>
              <span className="font-semibold">{j.title}</span>
              <span className="text-xs text-muted">{[j.location, j.employmentType].filter(Boolean).join(" · ")}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
