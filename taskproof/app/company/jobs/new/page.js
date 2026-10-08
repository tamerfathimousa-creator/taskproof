import { getCurrentUser } from "@/lib/auth";
import { getDb, plainAll } from "@/lib/db";
import { createJob } from "@/actions/company";
import JobForm from "../JobForm";

export default async function NewJobPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const templates = plainAll(db.prepare("SELECT id, title, channel FROM Simulation WHERE isTemplate = 1 ORDER BY title").all());
  const custom = plainAll(
    db.prepare("SELECT id, title, channel FROM Simulation WHERE companyId = ? ORDER BY createdAt DESC").all(user.company.id)
  );

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">New job</h1>
      <JobForm action={createJob} simulations={{ templates, custom }} jobSimulationIds={[]} />
    </div>
  );
}
