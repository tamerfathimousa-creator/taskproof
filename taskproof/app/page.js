import Link from "next/link";
import Logo from "@/components/Logo";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  const openJobs = db
    .prepare(
      `SELECT Job.id, Job.title, Job.location, Job.employmentType, Company.name as companyName
       FROM Job JOIN Company ON Company.id = Job.companyId
       WHERE Job.status = 'OPEN' ORDER BY Job.createdAt DESC LIMIT 4`
    )
    .all();

  return (
    <main>
      <nav className="flex items-center justify-between px-6 md:px-14 py-6 max-w-6xl mx-auto">
        <Logo size="lg" />
        <div className="flex items-center gap-4 text-sm">
          <Link href="/jobs" className="text-muted hover:text-ink hidden sm:inline">
            Browse jobs
          </Link>
          <Link href="/login" className="text-muted hover:text-ink">
            Log in
          </Link>
          <Link href="/signup" className="btn-primary">
            Sign up
          </Link>
        </div>
      </nav>

      <section className="px-6 md:px-14 max-w-6xl mx-auto grid md:grid-cols-2 gap-10 items-center py-10 md:py-16">
        <div className="flex flex-col gap-6">
          <span className="text-xs font-semibold tracking-widest uppercase text-accent">
            Workplace simulations for hiring
          </span>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight tracking-tight text-balance">
            Hire on <span className="text-accent">proof</span>, not paper.
          </h1>
          <p className="text-lg text-muted max-w-md">
            See how candidates actually handle the job — before you make the offer.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup?as=company" className="btn-primary">
              I&apos;m hiring
            </Link>
            <Link href="/signup?as=candidate" className="btn-secondary">
              I&apos;m a candidate
            </Link>
          </div>
        </div>

        <div className="card p-0 overflow-hidden shadow-xl">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-line bg-surface2">
            <div className="w-9 h-9 rounded-full bg-accentSoft text-accent grid place-items-center font-bold">
              MI
            </div>
            <div>
              <div className="font-semibold text-sm">Mona Ibrahim</div>
              <div className="text-xs text-muted">Operations Manager</div>
            </div>
          </div>
          <div className="px-5 py-5 flex flex-col gap-2">
            <div className="font-bold text-lg">Urgent: client escalation</div>
            <p className="text-sm text-ink/80">
              Order #4821 is five days late and the client wants a refund. How do you handle it?
            </p>
            <p className="text-xs text-muted">Reply as you would at work.</p>
          </div>
        </div>
      </section>

      <section className="px-6 md:px-14 max-w-6xl mx-auto py-10 border-t border-line">
        <h2 className="text-xl font-bold mb-5">Open roles</h2>
        {openJobs.length === 0 ? (
          <p className="text-muted text-sm">No open roles yet — check back soon.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {openJobs.map((j) => (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className="card p-5 flex flex-col gap-1 hover:border-accent transition-colors"
              >
                <span className="text-xs text-muted">{j.companyName}</span>
                <span className="font-semibold">{j.title}</span>
                <span className="text-xs text-muted">
                  {[j.location, j.employmentType].filter(Boolean).join(" · ")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="px-6 md:px-14 max-w-6xl mx-auto py-10 text-xs text-muted border-t border-line">
        TaskProof — hire who can do the work.
      </footer>
    </main>
  );
}
