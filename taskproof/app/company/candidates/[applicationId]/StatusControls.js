"use client";

import { setApplicationStatus } from "@/actions/company";

const OPTIONS = ["APPLIED", "SIMULATION_PENDING", "SIMULATION_SUBMITTED", "REVIEWED", "SHORTLISTED", "REJECTED"];

export default function StatusControls({ applicationId, currentStatus }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase text-muted font-medium mb-2">Recruitment status</div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((status) => (
          <form key={status} action={setApplicationStatus.bind(null, applicationId, status)}>
            <button
              className={`pill border ${
                status === currentStatus
                  ? "bg-accent text-white border-accent"
                  : "bg-surface border-line text-muted hover:border-accent hover:text-ink"
              }`}
              disabled={status === currentStatus}
            >
              {status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
