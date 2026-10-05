// Renders a scenario's opening message plus every reply/follow-up turn so
// far as a simple chat-style log. Used both on the candidate's own
// (text-only) view and the company's review view (which can also play back
// voice recordings). `channel` decides how CANDIDATE turns are rendered
// (typed text vs. a recording + transcript) — every candidate turn in one
// simulation is the same modality, so this is simpler and more reliable than
// guessing per-turn from which fields happen to be set.
export default function TurnTranscript({ openingSender, openingMessage, turns, channel, showAudio = false }) {
  const isVoice = channel === "VOICE";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 items-start">
        <span className="text-xs text-muted">{openingSender}</span>
        <p className="whitespace-pre-wrap text-sm bg-surface2 rounded-lg px-3 py-2 max-w-[85%]">{openingMessage}</p>
      </div>
      {turns.map((t) => {
        const isCandidate = t.speaker === "CANDIDATE";
        return (
          <div key={t.id} className={`flex flex-col gap-1 ${isCandidate ? "items-end" : "items-start"}`}>
            <span className="text-xs text-muted">{isCandidate ? "Candidate" : openingSender}</span>
            {isCandidate && isVoice ? (
              <div className="flex flex-col gap-1 max-w-[85%] items-end">
                {showAudio && t.audioUrl && (
                  <audio controls className="w-full" src={`/api/voice/${t.audioUrl}`}>
                    Your browser does not support audio playback.
                  </audio>
                )}
                {t.transcript ? (
                  <p className="whitespace-pre-wrap text-sm bg-accentSoft text-ink rounded-lg px-3 py-2">{t.transcript}</p>
                ) : t.transcriptError ? (
                  <p className="text-sm text-bad">
                    Transcription failed{showAudio ? " — listen to the recording above." : "."}
                  </p>
                ) : t.audioUrl ? (
                  <p className="text-sm text-muted">Transcribing…</p>
                ) : (
                  <p className="text-sm text-muted">(no recording captured)</p>
                )}
              </div>
            ) : (
              <p
                className={`whitespace-pre-wrap text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                  isCandidate ? "bg-accentSoft text-ink" : "bg-surface2"
                }`}
              >
                {t.text || "(no reply)"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
