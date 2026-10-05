// Google Gemini integration — plays the "other side" of the conversation in
// multi-step chat/voice simulations. Plain REST calls via global fetch, no
// SDK dependency, nothing to install.
//
// (Final evaluation scoring used to live here too, but now uses Jev —
// see lib/jev.js — which is purpose-built for calibrated judging. Gemini's
// job here is purely generative: stay in character and react.)

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Generates the next line from the scenario's persona (e.g. the angry
// customer, the coworker) after the candidate's latest reply, for simulations
// with more than one step. Deliberately asked to be unpredictable — a real
// person reacting, not a scripted "great, thanks!" — so the candidate has to
// keep problem-solving instead of pattern-matching a rehearsed answer.
export async function generateFollowUpMessage({ simulation, conversationSoFar, latestCandidateReply }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not set on the server.");
    err.code = "NO_KEY";
    throw err;
  }

  const prompt = `You are roleplaying as ${simulation.senderName} (${simulation.senderRole}) in a workplace ${
    simulation.channel === "VOICE" ? "phone call" : "chat conversation"
  } with a job candidate being tested. Stay fully in character — never break it, never mention you are an AI.

Original situation you raised:
"""
${simulation.emailBody}
"""

Conversation so far:
${conversationSoFar || "(nothing yet)"}

The candidate's latest reply:
"""
${latestCandidateReply && latestCandidateReply.trim() ? latestCandidateReply : "(no reply given)"}"""

Write your next message back to the candidate, as ${simulation.senderName} would really say it. Rules:
- 1-3 short sentences, natural spoken/typed tone, no markdown, no labels like "${simulation.senderName}:".
- React genuinely to what they actually said — if it's vague, push back and ask for specifics; if it's generic reassurance, raise a realistic complication or follow-up demand; if it's good, still add one real, slightly surprising wrinkle (a new constraint, a sharper deadline, an unexpected objection).
- The goal is to keep testing their judgment, not to wrap the conversation up neatly. Do not thank them and end the conversation early.
- Never give away what a "correct" answer would look like.

Reply with ONLY the message text, nothing else.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9 },
      }),
    });
  } catch (networkErr) {
    const err = new Error(`Could not reach Gemini: ${networkErr.message}`);
    err.code = "NETWORK";
    throw err;
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const err = new Error(`Gemini API error ${res.status}: ${bodyText.slice(0, 400)}`);
    err.code = "API_ERROR";
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini blocked the request: ${blockReason}` : "Gemini returned no content.");
  }

  return text.trim();
}
