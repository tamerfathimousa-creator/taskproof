"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import FormNotice from "@/components/FormNotice";
import SubmitButton from "@/components/SubmitButton";
import TurnTranscript from "@/components/TurnTranscript";
import Bi from "@/components/Bi";
import { saveDraft, submitSimulationStep, submitVoiceStep, startAttempt, expireAttempt } from "@/actions/candidate";

function parseUtc(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").getTime();
}

export default function ResponseForm({ applicationId, simulationId, attempt, simulation, turns: initialTurns }) {
  const router = useRouter();
  const channel = simulation?.channel || "EMAIL";
  const timeLimit = simulation?.timeLimitSeconds || 60;
  const totalSteps = simulation?.totalSteps || 1;
  const isVoice = channel === "VOICE";

  // If the attempt was already started before this page load, the server
  // already included the full scenario in `simulation` (see page.js) — only
  // a NOT_STARTED attempt gets a redacted one, revealed solely through the
  // Start action's return value below.
  const alreadyStarted = attempt.status !== "NOT_STARTED";

  const [localStarted, setLocalStarted] = useState(false);
  const [finished, setFinished] = useState(attempt.status === "SUBMITTED");
  const effectiveStatus = attempt.status === "SUBMITTED" || finished ? "SUBMITTED" : localStarted || alreadyStarted ? "IN_PROGRESS" : attempt.status;

  const [revealed, setRevealed] = useState(
    alreadyStarted
      ? {
          senderName: simulation.senderName,
          senderNameAr: simulation.senderNameAr,
          senderRole: simulation.senderRole,
          senderRoleAr: simulation.senderRoleAr,
          emailSubject: simulation.emailSubject,
          emailSubjectAr: simulation.emailSubjectAr,
          emailBody: simulation.emailBody,
          emailBodyAr: simulation.emailBodyAr,
          instructions: simulation.instructions,
          instructionsAr: simulation.instructionsAr,
        }
      : null
  );

  const [turns, setTurns] = useState(initialTurns || []);
  const [currentStep, setCurrentStep] = useState(attempt.currentStep || 1);
  const [stepStartedAt, setStepStartedAt] = useState(attempt.currentStepStartedAt || attempt.startedAt || null);

  const [text, setText] = useState(attempt.responseText || "");
  const [starting, setStarting] = useState(false);
  const [micError, setMicError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [submittingVoice, setSubmittingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const [remaining, setRemaining] = useState(timeLimit);

  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const autoInputRef = useRef(null);
  const draftFormRef = useRef(null);
  const submitFormRef = useRef(null);
  const expiredRef = useRef(false);

  // The current step's one-time token (see actions/candidate.js) and whether
  // a submission for the current step is already in flight. Both are refs,
  // not state: they have to be correct the instant the countdown hits zero
  // or a click fires, not after React's next render — the whole point is to
  // stop a second, stale submission from going out at all, not just handle
  // one gracefully after the fact.
  const stepTokenRef = useRef(attempt.stepToken || "");
  const stepTokenInputRef = useRef(null);
  const submittingRef = useRef(false);
  function setStepToken(token) {
    stepTokenRef.current = token || "";
    if (stepTokenInputRef.current) stepTokenInputRef.current.value = token || "";
  }

  const [draftState, draftAction] = useFormState(saveDraft.bind(null, applicationId, simulationId), null);
  const [submitState, submitAction] = useFormState(submitSimulationStep.bind(null, applicationId, simulationId), null);

  // Countdown tick, keyed to whichever step is currently active.
  useEffect(() => {
    if (effectiveStatus !== "IN_PROGRESS") return;
    const started = parseUtc(stepStartedAt);
    if (!started) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((started + timeLimit * 1000 - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [effectiveStatus, stepStartedAt, timeLimit]);

  // Auto-submit/advance at zero.
  useEffect(() => {
    if (effectiveStatus !== "IN_PROGRESS" || remaining > 0) return;
    if (isVoice) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      } else if (!expiredRef.current) {
        expiredRef.current = true;
        expireAttempt(applicationId, simulationId).then(() => router.refresh());
      }
    } else if (!expiredRef.current) {
      // Guard against a race with a manual submit that's already mid-flight
      // for this same step (e.g. the candidate clicked "Send reply" right as
      // the clock hit zero): if one is already in progress, let IT handle
      // this step rather than firing a second, stale submission alongside
      // it — that's exactly what used to produce a duplicate reply.
      if (submittingRef.current) return;
      expiredRef.current = true;
      submittingRef.current = true;
      if (autoInputRef.current) autoInputRef.current.value = "1";
      submitFormRef.current?.requestSubmit();
    }
  }, [remaining, effectiveStatus, isVoice, applicationId, simulationId, router]);

  // When a non-final text step completes, append the real candidate turn +
  // the real AI follow-up (both come straight from the server response, so
  // this is accurate, not a guess) and re-arm the timer for the new step.
  useEffect(() => {
    if (!submitState) return;
    // Whatever this submission turned out to be — success, a rejected
    // duplicate, or an error — it has now resolved, so a later timer
    // expiry is free to submit again for whatever step is actually current.
    submittingRef.current = false;
    if (submitState.error) return;
    if (submitState.duplicate) {
      // The server recognized this as a stale/duplicate submission for a
      // step that's already been answered (by the genuine submission this
      // one raced against) and dropped it without recording anything —
      // nothing to update here.
      return;
    }
    if (submitState.done) {
      setFinished(true);
      router.refresh();
      return;
    }
    if (submitState.nextMessage) {
      setTurns((prev) => [
        ...prev,
        submitState.candidateTurn,
        { id: `ai-${submitState.nextStep - 1}`, speaker: "AI", stepIndex: submitState.nextStep - 1, text: submitState.nextMessage },
      ]);
      setText("");
      setCurrentStep(submitState.nextStep);
      setStepStartedAt(submitState.nextStepStartedAt);
      setStepToken(submitState.nextStepToken);
      expiredRef.current = false;
    }
    // Only react to a NEW submitState (new object reference per submission) —
    // deliberately not depending on `text`/`currentStep` here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitState]);

  async function handleStartText() {
    setStarting(true);
    const res = await startAttempt(applicationId, simulationId);
    setStarting(false);
    if (res?.error) {
      router.refresh();
      return;
    }
    setRevealed(res.scenario);
    setCurrentStep(res.currentStep);
    setStepStartedAt(res.currentStepStartedAt || res.startedAt);
    setStepToken(res.stepToken);
    setLocalStarted(true);
  }

  function beginRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      // Set the instant stop() fires (manual click or the auto-stop-on-
      // timeout path) — the recorder can only be stopped once per
      // recording, so this really just mirrors the text form's guard for
      // consistency rather than closing a live race, but costs nothing.
      submittingRef.current = true;
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      setSubmittingVoice(true);
      const fd = new FormData();
      fd.append("audio", blob, "response.webm");
      fd.append("stepToken", stepTokenRef.current);
      const result = await submitVoiceStep(applicationId, simulationId, null, fd);
      setSubmittingVoice(false);
      submittingRef.current = false;
      if (result?.error) {
        setVoiceError(result.error);
        return;
      }
      if (result?.duplicate) {
        // A stale/duplicate submission the server recognized and dropped —
        // the genuine one already advanced things, so there's nothing to
        // apply here, and no reason to restart the recorder a second time.
        return;
      }
      if (result.done) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setFinished(true);
        router.refresh();
        return;
      }
      // Next step starts the instant it's revealed — same principle as the
      // very first Start — so the recorder re-arms immediately, with no
      // extra click, and the timer resets to the server's new timestamp.
      setTurns((prev) => [
        ...prev,
        result.candidateTurn,
        { id: `ai-${result.nextStep - 1}`, speaker: "AI", stepIndex: result.nextStep - 1, text: result.nextMessage },
      ]);
      setCurrentStep(result.nextStep);
      setStepStartedAt(result.nextStepStartedAt);
      setStepToken(result.nextStepToken);
      expiredRef.current = false;
      beginRecording();
    };
    mediaRecorderRef.current = mr;
    mr.start();
    setRecording(true);
  }

  async function handleStartVoice() {
    setStarting(true);
    setMicError(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStarting(false);
      setMicError(
        "Microphone access is required for this voice test. Please allow microphone access in your browser and try again."
      );
      return;
    }

    const res = await startAttempt(applicationId, simulationId);
    if (res?.error) {
      setStarting(false);
      stream.getTracks().forEach((t) => t.stop());
      router.refresh();
      return;
    }

    streamRef.current = stream;
    setRevealed(res.scenario);
    setCurrentStep(res.currentStep);
    setStepStartedAt(res.currentStepStartedAt || res.startedAt);
    setStepToken(res.stepToken);
    setLocalStarted(true);
    beginRecording();
    setStarting(false);
  }

  function handleStopVoiceEarly() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  const urgent = remaining <= 10;
  const isLastStep = currentStep >= totalSteps;

  // ---- SUBMITTED ----
  if (effectiveStatus === "SUBMITTED") {
    return (
      <div className="card p-5 flex flex-col gap-3">
        <Bi
          en="Your submitted response"
          ar="ردك المُرسَل"
          as="div"
          className="text-xs uppercase text-muted font-medium"
        />
        {revealed ? (
          <TurnTranscript
            openingSender={revealed.senderName}
            openingSenderAr={revealed.senderNameAr}
            openingMessage={revealed.emailBody}
            openingMessageAr={revealed.emailBodyAr}
            turns={turns}
            channel={channel}
          />
        ) : isVoice ? (
          attempt.transcript ? (
            <p className="whitespace-pre-wrap text-sm">{attempt.transcript}</p>
          ) : attempt.transcriptError ? (
            <p className="text-sm text-bad">
              Your recording was saved, but automatic transcription failed. The reviewer can still listen to your
              recording directly.
            </p>
          ) : attempt.audioUrl ? (
            <p className="text-sm text-muted">Transcribing your recording…</p>
          ) : (
            <p className="text-sm text-muted">No recording was captured before time ran out.</p>
          )
        ) : (
          <p className="whitespace-pre-wrap text-sm">{attempt.responseText || "(no response submitted)"}</p>
        )}
        {attempt.submittedAt && (
          <p className="text-xs text-muted">
            Submitted {attempt.submittedAt.slice(0, 16).replace("T", " ")} · you can&apos;t edit after submitting.
          </p>
        )}
      </div>
    );
  }

  // ---- NOT_STARTED ----
  if (effectiveStatus === "NOT_STARTED") {
    return (
      <div className="card p-5 flex flex-col gap-3">
        {micError && (
          <div className="rounded-lg bg-badSoft border border-bad text-bad px-3 py-2 text-sm">{micError}</div>
        )}
        <div>
          <Bi en={simulation.title} ar={simulation.titleAr} as="div" className="font-semibold" />
          {simulation.description && (
            <Bi
              en={simulation.description}
              ar={simulation.descriptionAr}
              as="p"
              className="text-sm text-muted mt-0.5"
            />
          )}
        </div>
        <Bi
          as="div"
          className="text-sm text-muted"
          en={
            <>
              The scenario itself only appears once you click Start — there&apos;s no reading ahead. You&apos;ll have{" "}
              <strong>{timeLimit} seconds</strong> per reply
              {totalSteps > 1 ? `, across ${totalSteps} back-and-forth steps that react to what you say` : ""}, with
              no pausing.
            </>
          }
          ar={`لن يظهر محتوى السيناريو إلا بعد الضغط على "ابدأ" — لا يمكن قراءته مسبقًا. سيكون لديك ${timeLimit} ثانية لكل رد${
            totalSteps > 1 ? `، على مدى ${totalSteps} خطوات متبادلة تتفاعل مع ما تكتبه` : ""
          }، دون إمكانية الإيقاف المؤقت.`}
        />
        <div>
          <button
            type="button"
            disabled={starting}
            onClick={isVoice ? handleStartVoice : handleStartText}
            className="btn-primary disabled:opacity-60 flex flex-col items-center leading-tight"
          >
            <span>{starting ? "Starting…" : isVoice ? "Start voice test" : "Start test"}</span>
            {!starting && (
              <span dir="rtl" lang="ar" className="text-xs opacity-80">
                {isVoice ? "ابدأ الاختبار الصوتي" : "ابدأ الاختبار"}
              </span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ---- IN_PROGRESS ----
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Bi
          as="span"
          className="text-xs uppercase text-muted font-medium"
          en={`${isVoice ? "Recording your response" : "Your reply"}${
            totalSteps > 1 ? ` · step ${currentStep} of ${totalSteps}` : ""
          }`}
          ar={`${isVoice ? "جارٍ تسجيل ردك" : "ردك"}${
            totalSteps > 1 ? ` · الخطوة ${currentStep} من ${totalSteps}` : ""
          }`}
        />
        <span className={`text-lg font-mono font-bold ${urgent ? "text-bad" : "text-ink"}`}>
          {mm}:{ss}
        </span>
      </div>

      {revealed && (
        <>
          <TurnTranscript
            openingSender={revealed.senderName}
            openingSenderAr={revealed.senderNameAr}
            openingMessage={revealed.emailBody}
            openingMessageAr={revealed.emailBodyAr}
            turns={turns}
            channel={channel}
          />
          {revealed.instructions && (
            <div className="text-xs text-muted bg-surface2 rounded-lg px-3 py-2">
              <p>{revealed.instructions}</p>
              {revealed.instructionsAr && (
                <p dir="rtl" lang="ar" className="mt-1">
                  {revealed.instructionsAr}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {isVoice ? (
        <div className="flex flex-col gap-3 items-start">
          {voiceError && (
            <div className="rounded-lg bg-badSoft border border-bad text-bad px-3 py-2 text-sm">{voiceError}</div>
          )}
          <Bi
            as="div"
            className="flex items-center gap-2 text-sm text-muted"
            en={
              <>
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${recording ? "bg-bad animate-pulse" : "bg-line"}`}
                />
                {recording ? "Recording…" : submittingVoice ? "Uploading…" : "Stopped"}
              </>
            }
            ar={recording ? "جارٍ التسجيل…" : submittingVoice ? "جارٍ الرفع…" : "متوقف"}
          />
          <button
            type="button"
            onClick={handleStopVoiceEarly}
            disabled={!recording || submittingVoice}
            className="btn-secondary disabled:opacity-60 flex flex-col items-center leading-tight"
          >
            <span>{submittingVoice ? "Submitting…" : isLastStep ? "Stop & submit now" : "Stop & send this reply"}</span>
            {!submittingVoice && (
              <span dir="rtl" lang="ar" className="text-xs opacity-80">
                {isLastStep ? "أوقف وأرسل الآن" : "أوقف وأرسل هذا الرد"}
              </span>
            )}
          </button>
          <Bi
            as="p"
            className="text-xs text-muted"
            en={
              isLastStep
                ? "Recording stops and submits automatically when time runs out."
                : "Your reply sends automatically when time runs out, and the next step starts immediately after."
            }
            ar={
              isLastStep
                ? "يتوقف التسجيل ويُرسل تلقائيًا عند انتهاء الوقت."
                : "يُرسل ردك تلقائيًا عند انتهاء الوقت، وتبدأ الخطوة التالية فورًا بعد ذلك."
            }
          />
        </div>
      ) : (
        <>
          <FormNotice state={draftState} />
          <FormNotice state={submitState} />
          <textarea
            id="responseText"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            rows={channel === "CHAT" ? 5 : 8}
            className="input"
            placeholder={channel === "CHAT" ? "Type your reply…" : "Write your reply as you would at work…"}
            autoFocus
          />
          <Bi
            as="p"
            className="text-xs text-muted -mt-2"
            en="Pasting is disabled for this test."
            ar="اللصق معطّل في هذا الاختبار."
          />
          <div className="flex flex-wrap items-center gap-3">
            <form ref={draftFormRef} action={draftAction}>
              <input type="hidden" name="responseText" value={text} />
              <SubmitButton className="btn-secondary" pendingText="Saving…">
                <span className="flex flex-col items-center leading-tight">
                  <span>Save draft</span>
                  <span dir="rtl" lang="ar" className="text-xs opacity-80">
                    حفظ كمسودة
                  </span>
                </span>
              </SubmitButton>
            </form>
            <form
              ref={submitFormRef}
              action={submitAction}
              onSubmit={(e) => {
                if (!text.trim() && autoInputRef.current?.value !== "1") {
                  e.preventDefault();
                  return;
                }
                // Set synchronously, before the action is even dispatched —
                // if the countdown reaches zero while this request is still
                // in flight, the auto-submit effect sees this flag and
                // skips firing a second, stale submission for the same step.
                submittingRef.current = true;
              }}
            >
              <input type="hidden" name="responseText" value={text} />
              <input ref={autoInputRef} type="hidden" name="auto" value="0" />
              <input ref={stepTokenInputRef} type="hidden" name="stepToken" defaultValue={stepTokenRef.current} />
              <SubmitButton pendingText="Sending…">
                <span className="flex flex-col items-center leading-tight">
                  <span>{isLastStep ? "Submit response" : "Send reply"}</span>
                  <span dir="rtl" lang="ar" className="text-xs opacity-80">
                    {isLastStep ? "إرسال الرد" : "إرسال الرد والمتابعة"}
                  </span>
                </span>
              </SubmitButton>
            </form>
            <Bi as="span" className="text-xs text-muted" en="Auto-submits when time runs out." ar="يُرسل تلقائيًا عند انتهاء الوقت." />
          </div>
        </>
      )}
    </div>
  );
}
