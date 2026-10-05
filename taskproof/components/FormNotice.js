"use client";

export default function FormNotice({ state }) {
  if (!state) return null;
  if (state.error) {
    return (
      <div className="rounded-lg bg-badSoft border border-bad text-bad px-3 py-2 text-sm">{state.error}</div>
    );
  }
  if (state.success) {
    return (
      <div className="rounded-lg bg-accentSoft border border-accent text-accent px-3 py-2 text-sm">
        {state.success}
      </div>
    );
  }
  return null;
}
