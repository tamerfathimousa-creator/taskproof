"use client";

import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";
import { saveEvaluation } from "@/actions/company";

export default function EvaluationForm({ applicationId, criteria, scoreMap, notes }) {
  const boundAction = saveEvaluation.bind(null, applicationId);
  const [state, formAction] = useFormState(boundAction, null);
  const [scores, setScores] = useState(() =>
    Object.fromEntries(criteria.map((c) => [c.id, scoreMap[c.id] ?? ""]))
  );

  const maxTotal = criteria.reduce((sum, c) => sum + c.maxScore, 0);
  const total = useMemo(
    () => criteria.reduce((sum, c) => sum + (parseInt(scores[c.id], 10) || 0), 0),
    [scores, criteria]
  );
  const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0;

  return (
    <form action={formAction} className="card p-5 flex flex-col gap-4">
      <FormNotice state={state} />
      <div className="text-xs uppercase text-muted font-medium">Score each criterion</div>

      <div className="flex flex-col gap-3">
        {criteria.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{c.name}</div>
              {c.description && <div className="text-xs text-muted">{c.description}</div>}
            </div>
            <input
              type="number"
              name={`score_${c.id}`}
              min={0}
              max={c.maxScore}
              value={scores[c.id]}
              onChange={(e) => setScores((s) => ({ ...s, [c.id]: e.target.value }))}
              className="input w-20 text-center tabular-nums"
              placeholder={`0–${c.maxScore}`}
            />
          </div>
        ))}
      </div>

      <div>
        <label className="label">Reviewer notes</label>
        <textarea name="notes" defaultValue={notes} rows={3} className="input" placeholder="Optional notes for your team" />
      </div>

      <div className="border-t border-line pt-3 flex items-center justify-between">
        <div>
          <span className="text-3xl font-extrabold tabular-nums">{total}</span>
          <span className="text-muted"> / {maxTotal}</span>
          <span className="text-warm font-semibold ml-2">{pct}%</span>
        </div>
        <SubmitButton>Save evaluation</SubmitButton>
      </div>
      <p className="text-xs text-muted">Total is calculated automatically from the criteria above.</p>
    </form>
  );
}
