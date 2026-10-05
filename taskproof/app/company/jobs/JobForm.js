"use client";

import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import Link from "next/link";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";

function channelLabel(channel) {
  return channel === "VOICE" ? "Voice" : channel === "CHAT" ? "Chat" : "Email";
}

export default function JobForm({ action, job, simulations, jobSimulationIds }) {
  const [state, formAction] = useFormState(action, null);

  const allSims = useMemo(() => [...simulations.custom, ...simulations.templates], [simulations]);
  const simById = useMemo(() => Object.fromEntries(allSims.map((s) => [s.id, s])), [allSims]);

  const [selected, setSelected] = useState(jobSimulationIds || []);

  function addSim(id) {
    if (!id || selected.includes(id)) return;
    setSelected((prev) => [...prev, id]);
  }
  function removeSim(id) {
    setSelected((prev) => prev.filter((s) => s !== id));
  }
  function moveSim(index, dir) {
    setSelected((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  const available = allSims.filter((s) => !selected.includes(s.id));

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
        <label className="label">Simulations</label>
        <p className="text-xs text-muted mb-2">
          Attach one or more. Candidates complete them in this order, one at a time — later ones unlock only once the
          one before is submitted.
        </p>

        {selected.length > 0 && (
          <div className="flex flex-col gap-2 mb-3">
            {selected.map((id, i) => {
              const s = simById[id];
              if (!s) return null;
              return (
                <div key={id} className="flex items-center gap-2 bg-surface2 border border-line rounded-lg px-3 py-2">
                  <span className="text-xs text-muted w-5">{i + 1}.</span>
                  <span className="flex-1 text-sm font-medium">
                    {s.title} <span className="text-muted font-normal">({channelLabel(s.channel)})</span>
                  </span>
                  <button type="button" onClick={() => moveSim(i, -1)} disabled={i === 0} className="text-muted disabled:opacity-30 px-1" aria-label="Move up">
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSim(i, 1)}
                    disabled={i === selected.length - 1}
                    className="text-muted disabled:opacity-30 px-1"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => removeSim(id)} className="text-bad px-1" aria-label="Remove">
                    ✕
                  </button>
                  <input type="hidden" name="simulationIds" value={id} />
                </div>
              );
            })}
          </div>
        )}

        {available.length > 0 ? (
          <select
            value=""
            onChange={(e) => addSim(e.target.value)}
            className="input"
          >
            <option value="">+ Add a simulation…</option>
            {simulations.custom.filter((s) => !selected.includes(s.id)).length > 0 && (
              <optgroup label="Your simulations">
                {simulations.custom
                  .filter((s) => !selected.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({channelLabel(s.channel)})
                    </option>
                  ))}
              </optgroup>
            )}
            {simulations.templates.filter((s) => !selected.includes(s.id)).length > 0 && (
              <optgroup label="Template library">
                {simulations.templates
                  .filter((s) => !selected.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({channelLabel(s.channel)})
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        ) : (
          <p className="text-sm text-muted">All available simulations are already attached.</p>
        )}

        {selected.length === 0 && <p className="text-xs text-muted mt-1">No simulation attached — applicants skip straight to review.</p>}

        <p className="text-xs text-muted mt-2">
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
