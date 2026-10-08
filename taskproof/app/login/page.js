"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import Logo from "@/components/Logo";
import SubmitButton from "@/components/SubmitButton";
import FormNotice from "@/components/FormNotice";
import { login } from "@/actions/auth";

export default function LoginPage() {
  const [state, formAction] = useFormState(login, null);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md card p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size="lg" />
          <p className="text-sm text-muted">Log in to your account</p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <FormNotice state={state} />
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" required className="input" />
          </div>
          <div>
            <label className="label">Password</label>
            <input name="password" type="password" required className="input" />
          </div>
          <SubmitButton>Log in</SubmitButton>
        </form>

        <p className="text-center text-sm text-muted">
          New to TaskProof?{" "}
          <Link href="/signup" className="text-accent font-semibold">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
