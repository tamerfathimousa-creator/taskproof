import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb, plain, plainAll, getJobSimulations, getSimulationTurns } from "@/lib/db";
import StatusPill from "@/components/StatusPill";
import TurnTranscript from "@/components/TurnTranscript";
import Bi from "@/components/Bi";
import ResponseForm from "./ResponseForm";

export default async function ApplicationPage({ params }) {
  const user = await getCurrentUser();
  const db = getDb();

  const application = db
    .prepare(
      `SELECT Application.*, Job.title as jobTitle, Company.name as companyName
       FROM Application
       JOIN Job ON Job.id = Application.jobId
       JOIN Company ON Company.id = Job.companyId
       WHERE Application.id = ? AND Application.candidateId = ?`
    )
    .get(params.id, user.candidateProfile.id);
  if (!application) notFound();

  const jobSims = getJobSimulations(db, application.jobId);
  const attempts = db.prepare("SELECT * FROM SimulationAttempt WHERE applicationId = ?").all(application.id);
  const attemptBySimId = Object.fromEntries(attempts.map((a) => [a.simulationId, a]));

  let currentIndex = jobSims.findIndex((s) => attemptBySimId[s.id]?.status !== "SUBMITTED");
  if (currentIndex === -1) currentIndex = jobSims.length;

  const evaluation =
    application.status === "SHORTLISTED" || application.status === "REJECTED"
      ? db.prepare("SELECT * FROM Evaluation WHERE applicationId = ?").get(application.id)
      : null;

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <Link href="/candidate/dashboard" className="text-sm text-accent font-semibold">
        ← Dashboard
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{application.jobTitle}</h1>
          <p className="text-sm text-muted">{application.companyName}</p>
        </div>
        <StatusPill status={application.status} />
      </div>

      {jobSims.length === 0 ? (
        <p className="text-sm text-muted">This role has no simulation task — your application is with the company.</p>
      ) : (
        <>
          {jobSims.length > 1 && (
            <p className="text-xs text-muted bg-surface2 rounded-lg px-3 py-2">
              <Bi
                en={`This application includes ${jobSims.length} simulations, completed one at a time, in order.`}
                ar={`يتضمن هذا الطلب ${jobSims.length} محاكاة، تُنجَز واحدة تلو الأخرى، بالترتيب.`}
              />
            </p>
          )}

          {jobSims.map((sim, i) => {
            const attempt = attemptBySimId[sim.id];
            const label =
              jobSims.length > 1
                ? `Simulation ${i + 1} of ${jobSims.length}: ${sim.title}`
                : sim.title;
            const labelAr = sim.titleAr
              ? jobSims.length > 1
                ? `محاكاة ${i + 1} من ${jobSims.length}: ${sim.titleAr}`
                : sim.titleAr
              : null;

            if (i > currentIndex) {
              return (
                <div key={sim.id} className="card p-5 flex items-center justify-between gap-3 opacity-60">
                  <div>
                    <Bi en={label} ar={labelAr} as="div" className="font-semibold" />
                    <Bi
                      en="Unlocks after the previous simulation is submitted."
                      ar="يُفتح بعد إرسال المحاكاة السابقة."
                      as="div"
                      className="text-xs text-muted"
                    />
                  </div>
                  <StatusPill status="NOT_STARTED" />
                </div>
              );
            }

            if (i < currentIndex) {
              // Already submitted — safe to show full content either way.
              const turns = plainAll(getSimulationTurns(db, attempt.id));
              return (
                <div key={sim.id} className="card p-0 overflow-hidden">
                  <div className="px-5 py-4 border-b border-line bg-surface2 flex items-center justify-between gap-3">
                    <Bi en={label} ar={labelAr} as="div" className="font-semibold" />
                    <StatusPill status="SUBMITTED" />
                  </div>
                  <div className="px-5 py-4">
                    <TurnTranscript
                      openingSender={sim.senderName}
                      openingSenderAr={sim.senderNameAr}
                      openingMessage={sim.emailBody}
                      openingMessageAr={sim.emailBodyAr}
                      turns={turns}
                      channel={sim.channel}
                    />
                  </div>
                </div>
              );
            }

            // The current (active) simulation. Only here does the client
            // ever receive the scenario text up front — and only once this
            // attempt is already past NOT_STARTED, meaning the clock is
            // already running against it. title/description (and their
            // Arabic translations) aren't scenario secrets — they're the
            // same label shown on the job listing before applying — so
            // those are safe to include even pre-Start.
            const revealScenario = attempt.status !== "NOT_STARTED";
            const visibleSim = revealScenario
              ? plain(sim)
              : {
                  id: sim.id,
                  title: sim.title,
                  titleAr: sim.titleAr,
                  description: sim.description,
                  descriptionAr: sim.descriptionAr,
                  channel: sim.channel,
                  timeLimitSeconds: sim.timeLimitSeconds,
                  totalSteps: sim.totalSteps,
                };
            const turns = revealScenario ? plainAll(getSimulationTurns(db, attempt.id)) : [];

            return (
              <div key={sim.id} className="flex flex-col gap-3">
                {jobSims.length > 1 && <Bi en={label} ar={labelAr} as="div" className="text-sm font-semibold" />}
                <ResponseForm
                  applicationId={application.id}
                  simulationId={sim.id}
                  attempt={plain(attempt)}
                  simulation={visibleSim}
                  turns={turns}
                />
              </div>
            );
          })}

          {evaluation && (
            <div className="card p-5">
              <div className="text-xs uppercase text-muted font-medium mb-1">Result</div>
              <div className="text-2xl font-extrabold">{application.status === "SHORTLISTED" ? "Shortlisted" : "Not selected"}</div>
              {evaluation.notes && <p className="text-sm text-muted mt-2">{evaluation.notes}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
