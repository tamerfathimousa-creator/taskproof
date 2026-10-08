// Jev (by TypeSafe) — a judgment/decision model, not a chat model. Used here
// for FINAL evaluation scoring: given the scenario + the full candidate
// exchange, it returns a calibrated score (with a confidence/probability
// spread) per rubric criterion. Reached through OpenRouter's decisions API —
// one API key, no SDK, same plain-fetch pattern as lib/ai.js and lib/whisper.js.
//
// Important difference from the old Gemini-based scorer: Jev produces no
// free-text reasoning, only typed answers. So "justification" here is
// synthesized from the model's own score + confidence numbers, not written
// by the model — which is arguably more defensible to a human reviewer
// ("4/5 at 82% confidence") than a generated sentence, but it does mean no
// prose explanation comes back automatically.

const JEV_MODEL = process.env.JEV_MODEL || "typesafe/jev-1.13";

export async function suggestScoresWithJev({ simulation, criteria, conversationText }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENROUTER_API_KEY is not set on the server.");
    err.code = "NO_KEY";
    throw err;
  }
  if (!criteria.length) {
    throw new Error("This simulation has no evaluation criteria to score against.");
  }

  const state = `Scenario sent to the candidate:
From: ${simulation.senderName} (${simulation.senderRole})
Subject: ${simulation.emailSubject}
Message: ${simulation.emailBody}

Instructions given to the candidate: ${simulation.instructions}

Full exchange with the candidate:
${conversationText && conversationText.trim() ? conversationText : "(no response was submitted)"}`;

  // One typed "score" question per rubric criterion. The legend just labels
  // each integer level "n/max" — Jev doesn't need a prose rubric per level,
  // the instructions field carries the actual grading guidance. The live API
  // requires `criteria` to be an ARRAY, indexed by score level (0 first) —
  // an object map (what an earlier version of this file sent) is rejected
  // with a 400 "expected array, received object".
  const questions = {};
  for (const c of criteria) {
    const legend = [];
    for (let i = 0; i <= c.maxScore; i++) legend.push(`${i} out of ${c.maxScore}`);
    questions[c.id] = {
      type: "score",
      instructions: `Score the candidate's response strictly against this criterion: "${c.name}"${
        c.description ? " — " + c.description : ""
      }. Do not default to generous scores; most real responses have real gaps.`,
      criteria: legend,
    };
  }

  const url = "https://openrouter.ai/api/alpha/decisions";

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    });
  } catch (networkErr) {
    const err = new Error(`Could not reach Jev: ${networkErr.message}`);
    err.code = "NETWORK";
    throw err;
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const err = new Error(`Jev API error ${res.status}: ${bodyText.slice(0, 400)}`);
    err.code = "API_ERROR";
    throw err;
  }

  const data = await res.json();
  const answers = data?.answers;
  if (!answers || typeof answers !== "object") {
    throw new Error("Jev returned no answers.");
  }

  const scores = [];
  for (const c of criteria) {
    const a = answers[c.id];
    if (!a || a.type !== "score" || typeof a.score !== "number") continue;
    const score = Math.round(Math.max(0, Math.min(c.maxScore, a.score)));
    const confidence = typeof a.confidence === "number" ? Math.round(a.confidence * 100) : null;
    // Confidence is intentionally left out of this text: it's shown to
    // company reviewers as-is, and Jev's confidence number is admin-only
    // (kept as the separate `confidence` field below, for the DB/admin view
    // only — see actions/company.js generateAiSuggestion and the admin area).
    const justification = `Jev scored this ${score}/${c.maxScore}.`;
    scores.push({ criterionId: c.id, score, confidence, justification });
  }

  if (!scores.length) {
    throw new Error("Jev's response didn't include any recognizable scores.");
  }

  // Jev doesn't generate prose summaries — build a short, honest one from the
  // spread of scores instead of asking the model for something it can't give.
  const byRatio = scores
    .map((s) => ({ ...s, crit: criteria.find((c) => c.id === s.criterionId) }))
    .filter((s) => s.crit)
    .sort((a, b) => a.score / a.crit.maxScore - b.score / b.crit.maxScore);
  const weakest = byRatio[0];
  const strongest = byRatio[byRatio.length - 1];
  const notes =
    weakest && strongest && weakest.criterionId !== strongest.criterionId
      ? `Weakest: ${weakest.crit.name} (${weakest.score}/${weakest.crit.maxScore}). Strongest: ${strongest.crit.name} (${strongest.score}/${strongest.crit.maxScore}).`
      : weakest
        ? `Scored evenly across criteria (e.g. ${weakest.crit.name}: ${weakest.score}/${weakest.crit.maxScore}).`
        : "";

  return { scores, notes, model: `${JEV_MODEL} via OpenRouter (judge model)` };
}
