"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import FormNotice from "@/components/FormNotice";
import SubmitButton from "@/components/SubmitButton";
import { saveDraft, submitResponse } from "@/actions/candidate";

export default function ResponseForm({ applicationId, attempt }) {
  const [text, setText] = useState(attempt.responseText || "");
  const [draftState, draftAction] = useFormState(saveDraft.bind(null, applicationId), null);
  const [submitState, submitAction] = useFormState(submitResponse.bind(null, applicationId), null);

  if (attempt.status === "SUBMITTED") {
    return (
      <div className="card p-5 flex flex-col gap-2">
        <div className="text-xs uppercase text-muted font-medium">Your submitted response</div>
        <p className="whitespace-pre-wrap text-sm">{attempt.responseText}</p>
        <p className="text-xs text-muted">
          Submitted {attempt.submittedAt?.slice(0, 16).replace("T", " ")} · you can&apos;t edit after submitting.
        </p>
      </div>
    );
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="card p-5 flex flex-col gap-3">
      <FormNotice state={draftState} />
      <FormNotice state={submitState} />
      <div className="flex items-center justify-between">
        <label htmlFor="responseText" className="label mb-0">
          Your reply
        </label>
        <span className="text-xs text-muted">{wordCount} words</span>
      </div>
      <textarea
        id="responseText"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="input"
        placeholder="Write your reply as you would at work…"
      />
      <div className="flex flex-wrap items-center gap-3">
        <form action={draftAction}>
          <input type="hidden" name="responseText" value={text} />
          <SubmitButton className="btn-secondary" pendingText="Saving…">
            Save draft
          </SubmitButton>
        </form>
        <form
          action={submitAction}
          onSubmit={(e) => {
            if (!text.trim()) e.preventDefault();
          }}
        >
          <input type="hidden" name="responseText" value={text} />
          <SubmitButton pendingText="Submitting…">Submit response</SubmitButton>
        </form>
        <span className="text-xs text-muted">You can&apos;t edit after submitting.</span>
      </div>
    </div>
  );
}
