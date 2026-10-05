"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";
import { saveEvaluation, generateAiSuggestion } from "@/actions/company";

export default function EvaluationForm({ applicationId, criteria, scoreMap, notes, aiSuggestion }) {
  const router = useRouter();
  const boundAction = saveEvaluation.bind(null, applicationId);
  const [state, formAction] = useFormState(boundAction, null);
  const [generating, startGenerating] = useTransition();
  const [genError, setGenError] = useState(aiSuggestion?.error || null);

  const hasSavedScores = Object.keys(scoreMap || {}).length > 0;
  const [scores, setScores] = useState(() =>
    Object.fromEntries(
      criteria.map((c) => [
        c.id,
        scoreMap[c.id] ?? (!hasSavedScores ? aiSuggestion?.scores?.[c.id]?.score ?? "" : ""),
      ])
    )
  );
  const [reviewNotes, setReviewNotes] = useState(notes || "");

  const maxTotal = criteria.reduce((sum, c) => sum + c.maxScore, 0);
  const total = useMemo(
    () => criteria.reduce((sum, c) => sum + (parseInt(scores[c.id], 10) || 0), 0),
    [scores, criteria]
  );
  const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0;

  function handleGenerate() {
    setGenError(null);
    startGenerating(async () => {
      const res = await generateAiSuggestion(applicationId);
      if (res?.error) setGenError(res.error);
      router.refresh();
    });
  }

  function applySuggestionToForm() {
    if (!aiSuggestion?.scores) return;
    setScores((prev) => {
      const next = { ...prev };
      for (const c of criteria) {
        if (aiSuggestion.scores[c.id]) next[c.id] = aiSuggestion.scores[c.id].score;
      }
      return next;
    });
    if (aiSuggestion.notes && !reviewNotes.trim()) setReviewNotes(aiSuggestion.notes);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs uppercase text-muted font-medium">AI-suggested scoring</div>
            {aiSuggestion && !aiSuggestion.error && (
              <div className="text-xs text-muted">via {aiSuggestion.model} — a starting point, not a final score</div>
            )}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="btn-secondary disabled:opacity-60"
          >
            {generating ? "Asking Jev…" : aiSuggestion ? "Regenerate suggestion" : "Get AI suggestion"}
          </button>
        </div>

        {genError && (
          <div className="rounded-lg bg-badSoft border border-bad text-bad px-3 py-2 text-sm">{genError}</div>
        )}

        {aiSuggestion && !aiSuggestion.error && (
          <>
            <div className="flex flex-col gap-2">
              {criteria.map((c) => {
                const s = aiSuggestion.scores?.[c.id];
                if (!s) return null;
                return (
                  <div key={c.id} className="text-sm flex items-start justify-between gap-3">
                    <div>
                      <span className="font-medium">{c.name}: </span>
                      <span className="text-muted">{s.justification}</span>
                    </div>
                    <span className="tabular-nums font-semibold whitespace-nowrap">
                      {s.score}/{c.maxScore}
                    </span>
                  </div>
                );
              })}
            </div>
            {aiSuggestion.notes && <p className="text-sm text-muted border-t border-line pt-2">{aiSuggestion.notes}</p>}
            <div>
              <button type="button" onClick={applySuggestionToForm} className="text-accent text-sm font-semibold">
                Use these scores below
              </button>
            </div>
          </>
        )}
      </div>

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
          <textarea
            name="notes"
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            rows={3}
            className="input"
            placeholder="Optional notes for your team"
          />
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
    </div>
  );
}
