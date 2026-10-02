import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb, plain } from "./db";

export const SESSION_COOKIE = "taskproof_session";
const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-me");

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function signSession(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SECRET);
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

// Server-side: read the session cookie and return { id, email, role } or null.
export async function getSessionPayload() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// Full current-user lookup, including the company/candidate profile row.
export async function getCurrentUser() {
  const payload = await getSessionPayload();
  if (!payload) return null;
  const db = getDb();
  const row = db.prepare("SELECT id, email, role, createdAt FROM User WHERE id = ?").get(payload.sub);
  if (!row) return null;
  const user = plain(row);
  if (user.role === "COMPANY") {
    user.company = plain(db.prepare("SELECT * FROM Company WHERE userId = ?").get(user.id)) || null;
  } else {
    user.candidateProfile = plain(db.prepare("SELECT * FROM CandidateProfile WHERE userId = ?").get(user.id)) || null;
  }
  return user;
}
