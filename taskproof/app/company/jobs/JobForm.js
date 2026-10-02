"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";

export default function JobForm({ action, job, simulations }) {
  const [state, formAction] = useFormState(action, null);

  return (
    <form action={formAction} className="card p-6 flex flex-col gap-4">
      <FormNotice state={state} />

      <div>
        <label className="label">Job title</label>
        <input name="title" defaultValue={job?.title || ""} required className="input" placeholder="Customer Support Lead" />
      </div>

      <div>
        <label className="label">Description</label>
        <textarea
          name="description"
          defaultValue={job?.description || ""}
          required
          rows={4}
          className="input"
          placeholder="What will this person do?"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Department</label>
          <input name="department" defaultValue={job?.department || ""} className="input" />
        </div>
        <div>
          <label className="label">Location</label>
          <input name="location" defaultValue={job?.location || ""} className="input" placeholder="Cairo, hybrid" />
        </div>
        <div>
          <label className="label">Employment type</label>
          <select name="employmentType" defaultValue={job?.employmentType || "Full-time"} className="input">
            <option>Full-time</option>
            <option>Part-time</option>
            <option>Contract</option>
            <option>Internship</option>
          </select>
        </div>
        <div>
          <label className="label">Application deadline (optional)</label>
          <input type="date" name="deadline" defaultValue={job?.deadline?.slice(0, 10) || ""} className="input" />
        </div>
      </div>

      <div>
        <label className="label">Required skills (comma separated)</label>
        <input name="requiredSkills" defaultValue={job?.requiredSkills || ""} className="input" placeholder="Communication, CRM tools" />
      </div>

      <div>
        <label className="label">Simulation</label>
        <select name="simulationId" defaultValue={job?.simulationId || ""} className="input">
          <option value="">— No simulation —</option>
          {simulations.templates.length > 0 && (
            <optgroup label="Template library">
              {simulations.templates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          )}
          {simulations.custom.length > 0 && (
            <optgroup label="Your simulations">
              {simulations.custom.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="text-xs text-muted mt-1">
          Need a different scenario?{" "}
          <Link href="/company/simulations/new" className="text-accent font-semibold">
            Write your own simulation
          </Link>
          .
        </p>
      </div>

      <div>
        <SubmitButton>{job ? "Save changes" : "Create job"}</SubmitButton>
      </div>
    </form>
  );
}
