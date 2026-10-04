"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import FormNotice from "@/components/FormNotice";
import SubmitButton from "@/components/SubmitButton";
import { saveDraft, submitResponse, submitVoiceResponse, startAttempt, expireAttempt } from "@/actions/candidate";

function parseUtc(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").getTime();
}

export default function ResponseForm({ applicationId, attempt, simulation }) {
  const router = useRouter();
  const channel = simulation?.channel || "EMAIL";
  const timeLimit = simulation?.timeLimitSeconds || 60;
  const isVoice = channel === "VOICE";

  // The server's attempt.status is the source of truth. localStarted only
  // bridges the brief gap between clicking "Start" and the page re-fetching.
  const [localStarted, setLocalStarted] = useState(null);
  const effectiveStatus = attempt.status === "SUBMITTED" ? "SUBMITTED" : localStarted ? "IN_PROGRESS" : attempt.status;
  const effectiveStartedAt = attempt.startedAt || localStarted?.startedAt;

  const [text, setText] = useState(attempt.responseText || "");
  const [starting, setStarting] = useState(false);
  const [micError, setMicError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [submittingVoice, setSubmittingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const [remaining, setRemaining] = useState(timeLimit);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const autoInputRef = useRef(null);
  const draftFormRef = useRef(null);
  const submitFormRef = useRef(null);
  const expiredRef = useRef(false);

  const [draftState, draftAction] = useFormState(saveDraft.bind(null, applicationId), null);
  const [submitState, submitAction] = useFormState(submitResponse.bind(null, applicationId), null);

  // Countdown tick
  useEffect(() => {
    if (effectiveStatus !== "IN_PROGRESS") return;
    const started = parseUtc(effectiveStartedAt);
    if (!started) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((started + timeLimit * 1000 - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [effectiveStatus, effectiveStartedAt, timeLimit]);

  // When time runs out: auto-submit whatever exists (text form, or stop the
  // recorder so its own onstop handler uploads it). If there's nothing live
  // to submit (e.g. the candidate reloaded mid-recording and lost it), just
  // lock the attempt server-side so it doesn't hang open forever.
  useEffect(() => {
    if (effectiveStatus !== "IN_PROGRESS" || remaining > 0) return;
    if (isVoice) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      } else if (!expiredRef.current) {
        expiredRef.current = true;
        expireAttempt(applicationId).then(() => router.refresh());
      }
    } else if (!expiredRef.current) {
      expiredRef.current = true;
      if (autoInputRef.current) autoInputRef.current.value = "1";
      submitFormRef.current?.requestSubmit();
    }
  }, [remaining, effectiveStatus, isVoice, applicationId, router]);

  async function handleStartText() {
    setStarting(true);
    const res = await startAttempt(applicationId);
    setStarting(false);
    if (res?.error) {
      router.refresh();
      return;
    }
    setLocalStarted({ startedAt: res.startedAt });
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

    const res = await startAttempt(applicationId);
    if (res?.error) {
      setStarting(false);
      stream.getTracks().forEach((t) => t.stop());
      router.refresh();
      return;
    }

    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      setSubmittingVoice(true);
      const fd = new FormData();
      fd.append("audio", blob, "response.webm");
      const result = await submitVoiceResponse(applicationId, null, fd);
      setSubmittingVoice(false);
      if (result?.error) {
        setVoiceError(result.error);
      } else {
        router.refresh();
      }
    };
    mediaRecorderRef.current = mr;
    setLocalStarted({ startedAt: res.startedAt });
    mr.start();
    setRecording(true);
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

  // ---- SUBMITTED ----
  if (effectiveStatus === "SUBMITTED") {
    return (
      <div className="card p-5 flex flex-col gap-2">
        <div className="text-xs uppercase text-muted font-medium">Your submitted response</div>
        {isVoice ? (
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
        <p className="text-xs text-muted">
          Submitted {attempt.submittedAt?.slice(0, 16).replace("T", " ")} · you can&apos;t edit after submitting.
        </p>
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
        <p className="text-sm text-muted">
          You&apos;ll have <strong>{timeLimit} seconds</strong> to {isVoice ? "record your spoken reply" : "write your reply"}{" "}
          once you start — there&apos;s no pausing, so read the scenario above first.
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
        </span>
        <span className={`text-lg font-mono font-bold ${urgent ? "text-bad" : "text-ink"}`}>
          {mm}:{ss}
        </span>
      </div>

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
            {submittingVoice ? "Submitting…" : "Stop & submit now"}
          </button>
          <p className="text-xs text-muted">Recording stops and submits automatically when time runs out.</p>
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
              <SubmitButton pendingText="Submitting…">Submit response</SubmitButton>
            </form>
            <span className="text-xs text-muted">Auto-submits when time runs out.</span>
          </div>
        </>
      )}
    </div>
  );
}
