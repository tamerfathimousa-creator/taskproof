// Claude — a second, independent AI suggestion source for company reviewers,
// alongside Jev (see lib/jev.js). Where Jev is a calibrated judgment model
// that returns typed scores with a confidence spread but no prose, Claude is
// asked to actually read the exchange and write out its reasoning per
// criterion — the two are meant to be compared side by side, not merged.
// Reached via a plain `fetch` against the Anthropic Messages API — no SDK,
// same pattern as lib/ai.js (Gemini) and lib/jev.js (Jev/OpenRouter).

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

export async function suggestScoresWithClaude({ simulation, criteria, conversationText }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY is not set on the server.");
    err.code = "NO_KEY";
    throw err;
  }
  if (!criteria.length) {
    throw new Error("This simulation has no evaluation criteria to score against.");
  }

  const criteriaList = criteria
    .map(
      (c, i) =>
        `${i + 1}. id: "${c.id}" — "${c.name}" (score 0-${c.maxScore})${
          c.description ? `: ${c.description}` : ""
        }`
    )
    .join("\n");

  const prompt = `You are grading a job candidate's response to a workplace simulation, as a strict but fair hiring reviewer.

Scenario sent to the candidate:
From: ${simulation.senderName} (${simulation.senderRole})
Subject: ${simulation.emailSubject}
Message: ${simulation.emailBody}

Instructions given to the candidate: ${simulation.instructions}

Full exchange with the candidate:
${conversationText && conversationText.trim() ? conversationText : "(no response was submitted)"}

Score the candidate strictly against each of the following criteria. Do not default to generous scores — most real responses have real gaps, and a 0 or a low score is appropriate when the response doesn't address the criterion at all.

${criteriaList}

Reply with ONLY a single JSON object, no markdown fences, no commentary before or after, in exactly this shape:
{
  "scores": [
    { "criterionId": "<id exactly as given above>", "score": <integer 0-maxScore>, "justification": "<1-2 sentences of genuine reasoning, citing something specific the candidate said or failed to say>" }
  ],
  "notes": "<one short overall sentence naming the candidate's clearest strength and clearest weakness>"
}`;

  const url = "https://api.anthropic.com/v1/messages";

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (networkErr) {
    const err = new Error(`Could not reach Claude: ${networkErr.message}`);
    err.code = "NETWORK";
    throw err;
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const err = new Error(`Claude API error ${res.status}: ${bodyText.slice(0, 400)}`);
    err.code = "API_ERROR";
    throw err;
  }

  const data = await res.json();
  const rawText = (data?.content || [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!rawText) {
    throw new Error("Claude returned no text content.");
  }

  // Claude is asked for bare JSON, but models sometimes wrap it in a fenced
  // code block anyway (or add a stray sentence) despite the instruction —
  // pull out the first {...} object rather than assuming res.text() is
  // already clean JSON.
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch {
    throw new Error("Claude's response wasn't valid JSON.");
  }

  const rawScores = Array.isArray(parsed?.scores) ? parsed.scores : [];
  const scores = [];
  for (const c of criteria) {
    const a = rawScores.find((s) => s?.criterionId === c.id);
    if (!a || typeof a.score !== "number") continue;
    const score = Math.round(Math.max(0, Math.min(c.maxScore, a.score)));
    // Unlike Jev, Claude isn't asked for a calibrated confidence number —
    // asking a generative model to self-report "confidence" produces an
    // uncalibrated, potentially misleading figure, not a real probability
    // like Jev's. Leaving it null reuses the existing UI's
    // "confidence unavailable" handling instead of showing a fake one.
    const justification = typeof a.justification === "string" && a.justification.trim()
      ? a.justification.trim()
      : `Claude scored this ${score}/${c.maxScore}.`;
    scores.push({ criterionId: c.id, score, confidence: null, justification });
  }

  if (!scores.length) {
    throw new Error("Claude's response didn't include any recognizable scores.");
  }

  const notes = typeof parsed?.notes === "string" ? parsed.notes.trim() : "";

  return { scores, notes, model: `${CLAUDE_MODEL} (Anthropic)` };
}
