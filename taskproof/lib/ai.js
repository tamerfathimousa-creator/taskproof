// Google Gemini integration for AI-suggested evaluation scores.
// Plain REST calls via global fetch — no SDK dependency, nothing to install.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function suggestScoresWithGemini({ simulation, criteria, responseText }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not set on the server.");
    err.code = "NO_KEY";
    throw err;
  }

  const criteriaList = criteria
    .map((c) => `- id="${c.id}" name="${c.name}" maxScore=${c.maxScore} — ${c.description || ""}`)
    .join("\n");

  const prompt = `You are a strict, no-nonsense HR evaluator scoring a candidate's response to a workplace simulation. Do not default to generous scores — most real responses have real gaps.

Scenario sent to the candidate:
From: ${simulation.senderName} (${simulation.senderRole})
Subject: ${simulation.emailSubject}
Message: ${simulation.emailBody}

Instructions given to the candidate: ${simulation.instructions}

Candidate's response:
"""
${responseText && responseText.trim() ? responseText : "(no response was submitted)"}
"""

Score the response against EACH of these criteria, using the exact "id" given:
${criteriaList}

Return ONLY JSON, no commentary, no markdown fences, in exactly this shape:
{
  "scores": [
    { "criterionId": "<id>", "score": <integer from 0 to that criterion's maxScore>, "justification": "<one short, specific sentence>" }
  ],
  "notes": "<2-3 sentence overall summary for a human reviewer, naming the main strength and the main gap>"
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
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
  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini blocked the request: ${blockReason}` : "Gemini returned no content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini did not return valid JSON.");
  }

  if (!parsed || !Array.isArray(parsed.scores)) {
    throw new Error("Gemini response was missing a 'scores' array.");
  }

  return { scores: parsed.scores, notes: parsed.notes || "", model: GEMINI_MODEL };
}
