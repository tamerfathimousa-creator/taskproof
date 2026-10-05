"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import FormNotice from "@/components/FormNotice";
import SubmitButton from "@/components/SubmitButton";
import TurnTranscript from "@/components/TurnTranscript";
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
          senderRole: simulation.senderRole,
          emailSubject: simulation.emailSubject,
          emailBody: simulation.emailBody,
          instructions: simulation.instructions,
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
      expiredRef.current = true;
      if (autoInputRef.current) autoInputRef.current.value = "1";
      submitFormRef.current?.requestSubmit();
    }
  }, [remaining, effectiveStatus, isVoice, applicationId, simulationId, router]);

  // When a non-final text step completes, append the real candidate turn +
  // the real AI follow-up (both come straight from the server response, so
  // this is accurate, not a guess) and re-arm the timer for the new step.
  useEffect(() => {
    if (!submitState || submitState.error) return;
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
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      setSubmittingVoice(true);
      const fd = new FormData();
      fd.append("audio", blob, "response.webm");
      const result = await submitVoiceStep(applicationId, simulationId, null, fd);
      setSubmittingVoice(false);
      if (result?.error) {
        setVoiceError(result.error);
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
        <div className="text-xs uppercase text-muted font-medium">Your submitted response</div>
        {revealed ? (
          <TurnTranscript openingSender={revealed.senderName} openingMessage={revealed.emailBody} turns={turns} channel={channel} />
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
          <div className="font-semibold">{simulation.title}</div>
          {simulation.description && <p className="text-sm text-muted mt-0.5">{simulation.description}</p>}
        </div>
        <p className="text-sm text-muted">
          The scenario itself only appears once you click Start — there&apos;s no reading ahead. You&apos;ll have{" "}
          <strong>{timeLimit} seconds</strong> per reply
          {totalSteps > 1 ? `, across ${totalSteps} back-and-forth steps that react to what you say` : ""}, with no
          pausing.
        </p>
        <div>
          <button
            type="button"
            disabled={starting}
            onClick={isVoice ? handleStartVoice : handleStartText}
            className="btn-primary disabled:opacity-60"
          >
            {starting ? "Starting…" : isVoice ? "Start voice test" : "Start test"}
          </button>
        </div>
      </div>
    );
  }

  // ---- IN_PROGRESS ----
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-muted font-medium">
          {isVoice ? "Recording your response" : "Your reply"}
          {totalSteps > 1 ? ` · step ${currentStep} of ${totalSteps}` : ""}
        </span>
        <span className={`text-lg font-mono font-bold ${urgent ? "text-bad" : "text-ink"}`}>
          {mm}:{ss}
        </span>
      </div>

      {revealed && (
        <>
          <TurnTranscript openingSender={revealed.senderName} openingMessage={revealed.emailBody} turns={turns} channel={channel} />
          {revealed.instructions && (
            <p className="text-xs text-muted bg-surface2 rounded-lg px-3 py-2">{revealed.instructions}</p>
          )}
        </>
      )}

      {isVoice ? (
        <div className="flex flex-col gap-3 items-start">
          {voiceError && (
            <div className="rounded-lg bg-badSoft border border-bad text-bad px-3 py-2 text-sm">{voiceError}</div>
          )}
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${recording ? "bg-bad animate-pulse" : "bg-line"}`} />
            {recording ? "Recording…" : submittingVoice ? "Uploading…" : "Stopped"}
          </div>
          <button
            type="button"
            onClick={handleStopVoiceEarly}
            disabled={!recording || submittingVoice}
            className="btn-secondary disabled:opacity-60"
          >
            {submittingVoice ? "Submitting…" : isLastStep ? "Stop & submit now" : "Stop & send this reply"}
          </button>
          <p className="text-xs text-muted">
            {isLastStep
              ? "Recording stops and submits automatically when time runs out."
              : "Your reply sends automatically when time runs out, and the next step starts immediately after."}
          </p>
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
          <p className="text-xs text-muted -mt-2">Pasting is disabled for this test.</p>
          <div className="flex flex-wrap items-center gap-3">
            <form ref={draftFormRef} action={draftAction}>
              <input type="hidden" name="responseText" value={text} />
              <SubmitButton className="btn-secondary" pendingText="Saving…">
                Save draft
              </SubmitButton>
            </form>
            <form
              ref={submitFormRef}
              action={submitAction}
              onSubmit={(e) => {
                if (!text.trim() && autoInputRef.current?.value !== "1") e.preventDefault();
              }}
            >
              <input type="hidden" name="responseText" value={text} />
              <input ref={autoInputRef} type="hidden" name="auto" value="0" />
              <SubmitButton pendingText="Sending…">{isLastStep ? "Submit response" : "Send reply"}</SubmitButton>
            </form>
            <span className="text-xs text-muted">Auto-submits when time runs out.</span>
          </div>
        </>
      )}
    </div>
  );
}
