import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb, plain, plainAll } from "@/lib/db";
import { updateSimulation } from "@/actions/company";
import SimulationForm from "../../SimulationForm";

// Companies can only edit simulations they wrote themselves — never the
// shared template library, and never another company's simulation.
export default async function EditSimulationPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();

  const simulation = db
    .prepare("SELECT * FROM Simulation WHERE id = ? AND companyId = ? AND isTemplate = 0")
    .get(params.id, user.company.id);
  if (!simulation) notFound();

  const criteria = db
    .prepare("SELECT * FROM EvaluationCriterion WHERE simulationId = ? ORDER BY sortOrder")
    .all(simulation.id);

  const updateWithId = updateSimulation.bind(null, simulation.id);

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Edit simulation</h1>
      <SimulationForm action={updateWithId} simulation={plain(simulation)} criteria={plainAll(criteria)} />
    </div>
  );
}
