import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

function SimCard({ sim, criteria }) {
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{sim.title}</h3>
        {sim.isTemplate ? (
          <span className="pill bg-accentSoft text-accent">Template</span>
        ) : (
          <span className="pill bg-line text-muted">Custom</span>
        )}
      </div>
      <p className="text-sm text-muted">{sim.description}</p>
      <div className="rounded-lg bg-surface2 border border-line p-3 text-sm">
        <div className="text-xs text-muted mb-1">
          {sim.senderName} · {sim.senderRole}
        </div>
        <div className="font-semibold">{sim.emailSubject}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {criteria.map((c) => (
          <span key={c.id} className="pill bg-line text-ink">
            {c.name} · {c.maxScore}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function SimulationsPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const templates = db.prepare("SELECT * FROM Simulation WHERE isTemplate = 1 ORDER BY title").all();
  const custom = db
    .prepare("SELECT * FROM Simulation WHERE companyId = ? ORDER BY createdAt DESC")
    .all(user.company.id);

  const critFor = (simId) =>
    db.prepare("SELECT * FROM EvaluationCriterion WHERE simulationId = ? ORDER BY sortOrder").all(simId);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Simulations</h1>
        <Link href="/company/simulations/new" className="btn-primary">
          + Write your own
        </Link>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Your simulations</h2>
        {custom.length === 0 ? (
          <p className="text-sm text-muted">You haven&apos;t written a custom simulation yet.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {custom.map((s) => (
              <SimCard key={s.id} sim={s} criteria={critFor(s.id)} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-3">Template library</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {templates.map((s) => (
            <SimCard key={s.id} sim={s} criteria={critFor(s.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
