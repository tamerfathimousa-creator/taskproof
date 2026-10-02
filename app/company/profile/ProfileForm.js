"use client";

import { useFormState } from "react-dom";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";
import { updateCompanyProfile } from "@/actions/company";

export default function ProfileForm({ company }) {
  const [state, formAction] = useFormState(updateCompanyProfile, null);
  return (
    <form action={formAction} className="card p-6 flex flex-col gap-4">
      <FormNotice state={state} />
      <div>
        <label className="label">Company name</label>
        <input name="name" defaultValue={company.name} required className="input" />
      </div>
      <div>
        <label className="label">Industry</label>
        <input name="industry" defaultValue={company.industry || ""} className="input" placeholder="e.g. E-commerce" />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea
          name="description"
          defaultValue={company.description || ""}
          rows={4}
          className="input"
          placeholder="What does your company do?"
        />
      </div>
      <div>
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </form>
  );
}
