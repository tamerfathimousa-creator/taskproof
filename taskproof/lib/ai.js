// Google Gemini integration — plays the "other side" of the conversation in
// multi-step chat/voice simulations. Plain REST calls via global fetch, no
// SDK dependency, nothing to install.
//
// (Final evaluation scoring used to live here too, but now uses Jev —
// see lib/jev.js — which is purpose-built for calibrated judging. Gemini's
// job here is purely generative: stay in character and react.)

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Scenarios ship bilingual (English + Arabic shown together), but a
// candidate replies in whichever one language they actually type in. Gemini's
// generated follow-up used to always come back in English regardless, which
// reads as jarring and inconsistent when the candidate is replying in
// Arabic. This looks at the candidate's FIRST reply in the conversation and
// classifies it so every later AI turn can be told to match that one
// language consistently, instead of possibly flip-flopping turn to turn.
export function detectReplyLanguage(text) {
  if (!text) return "en";
  const arabicMatches = text.match(/[؀-ۿ]/g) || [];
  const latinMatches = text.match(/[A-Za-z]/g) || [];
  if (arabicMatches.length === 0) return "en";
  if (latinMatches.length === 0) return "ar";
  return arabicMatches.length >= latinMatches.length ? "ar" : "en";
}

// Generates the next line from the scenario's persona (e.g. the angry
// customer, the coworker) after the candidate's latest reply, for simulations
// with more than one step. Deliberately asked to be unpredictable — a real
// person reacting, not a scripted "great, thanks!" — so the candidate has to
// keep problem-solving instead of pattern-matching a rehearsed answer.
// stepIndex/totalSteps (both 1-based/absolute) let the prompt calibrate how
// hard to escalate: simulations now run at least 3 steps, so the persona has
// room to genuinely develop the situation instead of resolving it in one beat.
export async function generateFollowUpMessage({
  simulation,
  conversationSoFar,
  latestCandidateReply,
  stepIndex,
  totalSteps,
  candidateLanguage,
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not set on the server.");
    err.code = "NO_KEY";
    throw err;
  }

  const stepsRemainingAfterThis = Number.isFinite(totalSteps) && Number.isFinite(stepIndex)
    ? Math.max(0, totalSteps - stepIndex)
    : null;

  const language = candidateLanguage === "ar" ? "ar" : "en";
  const languageInstruction =
    language === "ar"
      ? `Write your entire reply in Arabic only — natural, professional spoken/written Arabic (the same language the candidate has been replying in). Do not mix in English words or sentences, and do not give a bilingual or translated version.`
      : `Write your entire reply in English only. Do not switch into Arabic or any other language.`;

  const prompt = `You are roleplaying as ${simulation.senderName} (${simulation.senderRole}) in a tough, realistic, high-stakes workplace ${
    simulation.channel === "VOICE" ? "phone call" : "chat conversation"
  } with a job candidate being tested. This is not a friendly, easily-resolved exchange — real workplace situations like this involve real stakes, real pressure, and people who don't calm down just because someone said the right words. Stay fully in character — never break it, never mention you are an AI, never soften into a customer-service tone that doesn't fit who you are.

Description of the overall situation/scenario being tested:
"""
${simulation.description || "(no separate description given)"}
"""

Directions given to the candidate for this simulation (what they were told to do — use this to understand what
kind of response they're expected to produce, so your reaction makes sense in that context):
"""
${simulation.instructions || "(no separate instructions given)"}
"""

Original situation you raised:
"""
${simulation.emailBody}
"""

Conversation so far:
${conversationSoFar || "(nothing yet)"}

The candidate's latest reply:
"""
${latestCandidateReply && latestCandidateReply.trim() ? latestCandidateReply : "(no reply given)"}"""
${
  stepsRemainingAfterThis !== null
    ? `\nThis is reply ${stepIndex} of ${totalSteps} in the conversation, with ${stepsRemainingAfterThis} more exchange${
        stepsRemainingAfterThis === 1 ? "" : "s"
      } after this one before the candidate's final answer. Use that room: don't resolve or de-escalate the situation early just because it's "your turn" — a real person in this situation would keep pushing, keep raising the stakes, or introduce a new realistic complication, until there's a genuinely good reason to ease up.`
    : ""
}

Write your next message back to the candidate, as ${simulation.senderName} would really say it. Rules:
- ${languageInstruction}
- 1-3 short sentences, natural spoken/typed tone, no markdown, no labels like "${simulation.senderName}:".
- React genuinely to what they actually said — if it's vague, push back hard and demand specifics; if it's generic reassurance or corporate-speak, call that out and raise a realistic complication; if it's good, still add one real, substantial wrinkle (a new constraint, a sharper deadline, an unexpected objection, a stakeholder who disagrees, new information that makes things worse) — not a token nitpick.
- Make this genuinely tough and true to real life: real anger doesn't vanish after one apology, real deadlines don't move just because someone asks nicely, and real problems often have a second layer underneath the first one. Surprise the candidate — don't let the conversation go where they're obviously steering it.
- The goal is to keep testing their judgment under real pressure, not to wrap the conversation up neatly or reward them for saying soothing things. Do not thank them and end the conversation early, and do not become agreeable just to be polite.
- Never give away what a "correct" answer would look like, and never coach the candidate on how to respond.

Reply with ONLY the message text, nothing else — ${language === "ar" ? "in Arabic" : "in English"}.`;

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
