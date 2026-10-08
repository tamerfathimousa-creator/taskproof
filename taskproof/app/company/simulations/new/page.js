import { createSimulation } from "@/actions/company";
import SimulationForm from "../SimulationForm";

export default function NewSimulationPage() {
  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Write a simulation</h1>
      <SimulationForm action={createSimulation} />
    </div>
  );
}
