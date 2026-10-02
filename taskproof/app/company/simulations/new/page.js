"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";
import { createSimulation } from "@/actions/company";

const DEFAULT_CRITERIA = [
  { name: "Problem Understanding", max: 5 },
  { name: "Decision Quality", max: 5 },
  { name: "Communication", max: 5 },
  { name: "Prioritization", max: 5 },
  { name: "Professionalism", max: 5 },
];

export default function NewSimulationPage() {
  const [state, formAction] = useFormState(createSimulation, null);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);

  function updateCriterion(i, field, value) {
    setCriteria((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));
  }
  function addCriterion() {
    setCriteria((prev) => [...prev, { name: "", max: 5 }]);
  }
  function removeCriterion(i) {
    setCriteria((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Write a simulation</h1>
      <form action={formAction} className="card p-6 flex flex-col gap-4">
        <FormNotice state={state} />

        <div>
          <label className="label">Scenario title</label>
          <input name="title" required className="input" placeholder="Handling a supplier delay" />
        </div>
        <div>
          <label className="label">Short description</label>
          <input name="description" className="input" placeholder="One line describing the scenario" />
        </div>
        <div>
          <label className="label">Candidate instructions</label>
          <textarea
            name="instructions"
            rows={2}
            className="input"
            defaultValue="Read the email below and reply as you would if this landed in your inbox at work."
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Simulated sender name</label>
            <input name="senderName" required className="input" placeholder="Mona Ibrahim" />
          </div>
          <div>
            <label className="label">Simulated sender role</label>
            <input name="senderRole" className="input" placeholder="Operations Manager" />
          </div>
        </div>

        <div>
          <label className="label">Simulated email subject</label>
          <input name="emailSubject" required className="input" placeholder="Urgent: ..." />
        </div>
        <div>
          <label className="label">Simulated email message</label>
          <textarea name="emailBody" required rows={5} className="input" placeholder="Write the scenario email the candidate will receive…" />
        </div>

        <div>
          <label className="label">Evaluation criteria</label>
          <div className="flex flex-col gap-2">
            {criteria.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  name="criterionName"
                  value={c.name}
                  onChange={(e) => updateCriterion(i, "name", e.target.value)}
                  className="input flex-1"
                  placeholder="Criterion name"
                />
                <input
                  name="criterionMax"
                  type="number"
                  min={1}
                  max={20}
                  value={c.max}
                  onChange={(e) => updateCriterion(i, "max", e.target.value)}
                  className="input w-20"
                />
                <button
                  type="button"
                  onClick={() => removeCriterion(i)}
                  className="text-bad text-sm px-2"
                  aria-label="Remove criterion"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addCriterion} className="text-accent text-sm font-semibold mt-2">
            + Add criterion
          </button>
        </div>

        <div>
          <SubmitButton>Save simulation</SubmitButton>
        </div>
      </form>
    </div>
  );
}
