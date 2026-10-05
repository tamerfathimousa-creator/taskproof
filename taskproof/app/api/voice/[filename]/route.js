import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

const STORAGE_DIR = path.join(process.cwd(), "storage", "voice");

export async function GET(req, { params }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "COMPANY") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const filename = params.filename;
  const db = getDb();

  // The recording can belong either to the (legacy) attempt-level audioUrl
  // column, from before multi-step voice existed, or to one step's
  // SimulationTurn row.
  let applicationId = null;
  const attempt = db.prepare("SELECT * FROM SimulationAttempt WHERE audioUrl = ?").get(filename);
  if (attempt) {
    applicationId = attempt.applicationId;
  } else {
    const turn = db
      .prepare(
        `SELECT SimulationAttempt.applicationId as applicationId
         FROM SimulationTurn JOIN SimulationAttempt ON SimulationAttempt.id = SimulationTurn.attemptId
         WHERE SimulationTurn.audioUrl = ?`
      )
      .get(filename);
    if (turn) applicationId = turn.applicationId;
  }
  if (!applicationId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const owns = db
    .prepare(
      `SELECT 1 FROM Application JOIN Job ON Job.id = Application.jobId
       WHERE Application.id = ? AND Job.companyId = ? LIMIT 1`
    )
    .get(applicationId, user.company.id);
  if (!owns) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  try {
    const safeName = path.basename(filename);
    const buf = await fs.readFile(path.join(STORAGE_DIR, safeName));
    const ext = path.extname(safeName).replace(".", "") || "webm";
    return new NextResponse(buf, {
      headers: {
        "Content-Type": `audio/${ext}`,
        "Content-Disposition": `inline; filename="response.${ext}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
