"use client";

import { useState, Suspense } from "react";
import { useFormState } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";
import { registerCompany, registerCandidate } from "@/actions/auth";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("as") === "candidate" ? "candidate" : "company");
  const [companyState, companyAction] = useFormState(registerCompany, null);
  const [candidateState, candidateAction] = useFormState(registerCandidate, null);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md card p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size="lg" />
          <p className="text-sm text-muted">Create your account</p>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-surface2 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setTab("company")}
            className={`rounded-md py-2 text-sm font-semibold transition-colors ${
              tab === "company" ? "bg-surface shadow text-ink" : "text-muted"
            }`}
          >
            I&apos;m hiring
          </button>
          <button
            type="button"
            onClick={() => setTab("candidate")}
            className={`rounded-md py-2 text-sm font-semibold transition-colors ${
              tab === "candidate" ? "bg-surface shadow text-ink" : "text-muted"
            }`}
          >
            I&apos;m a candidate
          </button>
        </div>

        {tab === "company" ? (
          <form action={companyAction} className="flex flex-col gap-4">
            <FormNotice state={companyState} />
            <div>
              <label className="label">Company name</label>
              <input name="companyName" required className="input" placeholder="Acme Inc." />
            </div>
            <div>
              <label className="label">Work email</label>
              <input name="email" type="email" required className="input" placeholder="you@company.com" />
            </div>
            <div>
              <label className="label">Password</label>
              <input name="password" type="password" required minLength={6} className="input" />
            </div>
            <SubmitButton>Create company account</SubmitButton>
          </form>
        ) : (
          <form action={candidateAction} className="flex flex-col gap-4">
            <FormNotice state={candidateState} />
            <div>
              <label className="label">Full name</label>
              <input name="fullName" required className="input" placeholder="Jane Doe" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" required className="input" placeholder="you@example.com" />
            </div>
            <div>
              <label className="label">Password</label>
              <input name="password" type="password" required minLength={6} className="input" />
            </div>
            <SubmitButton>Create candidate account</SubmitButton>
          </form>
        )}

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-accent font-semibold">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
