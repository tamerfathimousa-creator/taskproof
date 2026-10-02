"use client";

import { useFormState } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";
import { updateCandidateProfile } from "@/actions/candidate";

export default function ProfileForm({ profile }) {
  const [state, formAction] = useFormState(updateCandidateProfile, null);

  return (
    <form action={formAction} className="card p-6 flex flex-col gap-4">
      <FormNotice state={state} />
      <div>
        <label className="label">Full name</label>
        <input name="fullName" defaultValue={profile.fullName} required className="input" />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Phone (optional)</label>
          <input name="phone" defaultValue={profile.phone || ""} className="input" />
        </div>
        <div>
          <label className="label">Location (optional)</label>
          <input name="location" defaultValue={profile.location || ""} className="input" />
        </div>
      </div>
      <div>
        <label className="label">Current job title (optional)</label>
        <input name="currentTitle" defaultValue={profile.currentTitle || ""} className="input" />
      </div>
      <div>
        <label className="label">Short professional summary (optional)</label>
        <textarea name="summary" defaultValue={profile.summary || ""} rows={3} className="input" />
      </div>
      <div>
        <label className="label">CV (optional, PDF/DOC, max 5MB)</label>
        {profile.cvName && <p className="text-xs text-muted mb-1">Current file: {profile.cvName}</p>}
        <input type="file" name="cv" accept=".pdf,.doc,.docx" className="input" />
      </div>
      <div>
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </form>
  );
}
