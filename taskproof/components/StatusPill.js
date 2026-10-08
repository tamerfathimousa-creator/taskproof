const map = {
  DRAFT: "bg-line text-muted",
  OPEN: "bg-accentSoft text-accent",
  CLOSED: "bg-badSoft text-bad",
  APPLIED: "bg-line text-muted",
  SIMULATION_PENDING: "bg-warmSoft text-warm",
  SIMULATION_SUBMITTED: "bg-accentSoft text-accent",
  REVIEWED: "bg-line text-ink",
  SHORTLISTED: "bg-accentSoft text-accent",
  REJECTED: "bg-badSoft text-bad",
  NOT_STARTED: "bg-line text-muted",
  IN_PROGRESS: "bg-warmSoft text-warm",
  SUBMITTED: "bg-accentSoft text-accent",
};

export default function StatusPill({ status }) {
  const label = status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return <span className={`pill ${map[status] || "bg-line text-muted"}`}>{label}</span>;
}
