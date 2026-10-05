// OpenAI Whisper integration for transcribing recorded voice-simulation
// responses. Plain REST call via global fetch/FormData — no SDK dependency.
import fs from "fs/promises";

const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-1";

export async function transcribeAudioFile(filePath, { mimeType = "audio/webm", fileName = "response.webm" } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set on the server.");
    err.code = "NO_KEY";
    throw err;
  }

  const buffer = await fs.readFile(filePath);
  const blob = new Blob([buffer], { type: mimeType });

  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("model", WHISPER_MODEL);

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (networkErr) {
    const err = new Error(`Could not reach Whisper: ${networkErr.message}`);
    err.code = "NETWORK";
    throw err;
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const err = new Error(`Whisper API error ${res.status}: ${bodyText.slice(0, 400)}`);
    err.code = "API_ERROR";
    throw err;
  }

  const data = await res.json();
  if (typeof data.text !== "string") {
    throw new Error("Whisper returned no transcript text.");
  }
  return data.text;
}
