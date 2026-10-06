import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

const STORAGE_DIR = path.join(process.cwd(), "storage", "cvs");

export async function GET(req, { params }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "COMPANY") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const filename = params.filename;
  const db = getDb();
  const candidate = db.prepare("SELECT * FROM CandidateProfile WHERE cvUrl = ?").get(filename);
  if (!candidate) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const owns = db
    .prepare(
      `SELECT 1 FROM Application JOIN Job ON Job.id = Application.jobId
       WHERE Application.candidateId = ? AND Job.companyId = ? LIMIT 1`
    )
    .get(candidate.id, user.company.id);
  if (!owns) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  try {
    const safeName = path.basename(filename);
    const buf = await fs.readFile(path.join(STORAGE_DIR, safeName));
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${candidate.cvName || "cv"}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
