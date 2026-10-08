"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";

const DEFAULT_CRITERIA = [
  { name: "Problem Understanding", max: 5 },
  { name: "Decision Quality", max: 5 },
  { name: "Communication", max: 5 },
  { name: "Prioritization", max: 5 },
  { name: "Professionalism", max: 5 },
];

const CHANNEL_OPTIONS = [
  { value: "EMAIL", label: "Email", hint: "Candidate reads a message and writes a reply." },
  { value: "CHAT", label: "Chat", hint: "Same as email, shown as a quick back-and-forth chat." },
  { value: "VOICE", label: "Voice call", hint: "Candidate records a spoken reply, transcribed automatically." },
];

// Shared by the "write a simulation" and "edit simulation" screens — pass an
// existing `simulation` (plus its `criteria`) to pre-fill and edit in place,
// or omit both to create a new one. Mirrors the JobForm pattern used for jobs.
export default function SimulationForm({ action, simulation, criteria: initialCriteria }) {
  const [state, formAction] = useFormState(action, null);
  const [criteria, setCriteria] = useState(
    initialCriteria && initialCriteria.length
      ? initialCriteria.map((c) => ({ id: c.id, name: c.name, max: c.maxScore }))
      : DEFAULT_CRITERIA
  );
  const [channel, setChannel] = useState(simulation?.channel || "EMAIL");
  const [totalSteps, setTotalSteps] = useState(simulation?.totalSteps || 3);
  const multiStepEligible = channel !== "EMAIL";

  function handleChannelChange(value) {
    setChannel(value);
    // Chat/voice simulations are always at least a 3-message back-and-forth
    // (enforced again server-side); email stays a single reply.
    if (value === "EMAIL") setTotalSteps(1);
    else if (totalSteps < 3) setTotalSteps(3);
  }

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
    <form action={formAction} className="card p-6 flex flex-col gap-4">
      <FormNotice state={state} />

      <p className="text-xs text-muted -mb-2">
        Arabic fields are optional — leave any of them blank and that part of the simulation stays English-only. When
        filled in, candidates see both languages together.
      </p>

      <div>
        <label className="label">Scenario title</label>
        <input name="title" required defaultValue={simulation?.title || ""} className="input" placeholder="Handling a supplier delay" />
        <input
          name="titleAr"
          defaultValue={simulation?.titleAr || ""}
          className="input mt-2"
          dir="rtl"
          lang="ar"
          placeholder="عنوان السيناريو (اختياري)"
        />
      </div>
      <div>
        <label className="label">Short description</label>
        <input name="description" defaultValue={simulation?.description || ""} className="input" placeholder="One line describing the scenario" />
        <input
          name="descriptionAr"
          defaultValue={simulation?.descriptionAr || ""}
          className="input mt-2"
          dir="rtl"
          lang="ar"
          placeholder="وصف مختصر بالعربية (اختياري)"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Test format</label>
          <select name="channel" value={channel} onChange={(e) => handleChannelChange(e.target.value)} className="input">
            {CHANNEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted mt-1">{CHANNEL_OPTIONS.find((o) => o.value === channel)?.hint}</p>
        </div>
        <div>
          <label className="label">Time limit (seconds, per reply)</label>
          <input
            name="timeLimitSeconds"
            type="number"
            min={15}
            max={600}
            step={5}
            defaultValue={simulation?.timeLimitSeconds || 120}
            className="input"
          />
          <p className="text-xs text-muted mt-1">
            120s (2 minutes) is the suggested default — enough time to think and type a real answer, while a timer
            (of whatever length you choose) is still what stops candidates from pasting in an AI-written one.
          </p>
        </div>
      </div>

      {multiStepEligible && (
        <div>
          <label className="label">Conversation steps</label>
          <select
            name="totalSteps"
            value={totalSteps}
            onChange={(e) => setTotalSteps(Number(e.target.value))}
            className="input"
          >
            <option value={3}>3 — two AI follow-ups, then a final reply</option>
            <option value={4}>4 — three AI follow-ups, then a final reply</option>
          </select>
          <p className="text-xs text-muted mt-1">
            Chat and voice simulations always run at least a 3-message back-and-forth, so a candidate can&apos;t pass
            on one lucky reply. After each reply, Gemini generates the other side&apos;s next message live — a real,
            sometimes-surprising, tougher reaction, not a scripted conversation — so the candidate has to keep
            adapting under real pressure. Each step gets its own full-length timer, using the time limit above.
          </p>
        </div>
      )}

      <div>
        <label className="label">Candidate instructions</label>
        <textarea
          name="instructions"
          rows={2}
          className="input"
          defaultValue={simulation?.instructions || "Read the email below and reply as you would if this landed in your inbox at work."}
        />
        <textarea
          name="instructionsAr"
          rows={2}
          dir="rtl"
          lang="ar"
          defaultValue={simulation?.instructionsAr || ""}
          className="input mt-2"
          placeholder="التعليمات بالعربية (اختياري)"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Simulated sender name</label>
          <input name="senderName" required defaultValue={simulation?.senderName || ""} className="input" placeholder="Mona Ibrahim" />
          <input
            name="senderNameAr"
            defaultValue={simulation?.senderNameAr || ""}
            dir="rtl"
            lang="ar"
            className="input mt-2"
            placeholder="اسم المرسل (اختياري)"
          />
        </div>
        <div>
          <label className="label">Simulated sender role</label>
          <input name="senderRole" defaultValue={simulation?.senderRole || ""} className="input" placeholder="Operations Manager" />
          <input
            name="senderRoleAr"
            defaultValue={simulation?.senderRoleAr || ""}
            dir="rtl"
            lang="ar"
            className="input mt-2"
            placeholder="منصب المرسل (اختياري)"
          />
        </div>
      </div>

      <div>
        <label className="label">{channel === "EMAIL" ? "Simulated email subject" : "Scenario headline"}</label>
        <input name="emailSubject" required defaultValue={simulation?.emailSubject || ""} className="input" placeholder="Urgent: ..." />
        <input
          name="emailSubjectAr"
          defaultValue={simulation?.emailSubjectAr || ""}
          dir="rtl"
          lang="ar"
          className="input mt-2"
          placeholder="العنوان بالعربية (اختياري)"
        />
      </div>
      <div>
        <label className="label">{channel === "EMAIL" ? "Simulated email message" : "Scenario message the candidate will see"}</label>
        <textarea
          name="emailBody"
          required
          rows={5}
          className="input"
          defaultValue={simulation?.emailBody || ""}
          placeholder={
            channel === "VOICE"
              ? "Describe the situation the candidate is about to respond to out loud…"
              : "Write the scenario message the candidate will receive…"
          }
        />
        <textarea
          name="emailBodyAr"
          rows={5}
          dir="rtl"
          lang="ar"
          defaultValue={simulation?.emailBodyAr || ""}
          className="input mt-2"
          placeholder="نص الرسالة بالعربية (اختياري)"
        />
      </div>

      <div>
        <label className="label">Evaluation criteria</label>
        <div className="flex flex-col gap-2">
          {criteria.map((c, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input type="hidden" name="criterionId" value={c.id || ""} />
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
              <button type="button" onClick={() => removeCriterion(i)} className="text-bad text-sm px-2" aria-label="Remove criterion">
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addCriterion} className="text-accent text-sm font-semibold mt-2">
          + Add criterion
        </button>
        {simulation && (
          <p className="text-xs text-muted mt-2">
            Renaming or removing a criterion here only changes how new reviews are scored — it won&apos;t touch
            scores already saved for past applicants.
          </p>
        )}
      </div>

      <div>
        <SubmitButton>{simulation ? "Save changes" : "Save simulation"}</SubmitButton>
      </div>
    </form>
  );
}
