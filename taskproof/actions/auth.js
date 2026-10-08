"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb, newId } from "@/lib/db";
import { hashPassword, verifyPassword, signSession, SESSION_COOKIE } from "@/lib/auth";

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

async function setSessionCookie(user) {
  const token = await signSession({ sub: user.id, role: user.role, email: user.email });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function registerCompany(prevState, formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const companyName = String(formData.get("companyName") || "").trim();

  if (!validEmail(email)) return { error: "Please enter a valid email address." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  if (!companyName) return { error: "Company name is required." };

  const db = getDb();
  const existing = db.prepare("SELECT id FROM User WHERE email = ?").get(email);
  if (existing) return { error: "An account with this email already exists." };

  const userId = newId();
  const passwordHash = await hashPassword(password);
  db.prepare("INSERT INTO User (id, email, passwordHash, role) VALUES (?, ?, ?, 'COMPANY')").run(
    userId,
    email,
    passwordHash
  );
  db.prepare("INSERT INTO Company (id, userId, name) VALUES (?, ?, ?)").run(newId(), userId, companyName);

  await setSessionCookie({ id: userId, role: "COMPANY", email });
  redirect("/company/dashboard");
}

export async function registerCandidate(prevState, formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const fullName = String(formData.get("fullName") || "").trim();

  if (!validEmail(email)) return { error: "Please enter a valid email address." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  if (!fullName) return { error: "Full name is required." };

  const db = getDb();
  const existing = db.prepare("SELECT id FROM User WHERE email = ?").get(email);
  if (existing) return { error: "An account with this email already exists." };

  const userId = newId();
  const passwordHash = await hashPassword(password);
  db.prepare("INSERT INTO User (id, email, passwordHash, role) VALUES (?, ?, ?, 'CANDIDATE')").run(
    userId,
    email,
    passwordHash
  );
  db.prepare("INSERT INTO CandidateProfile (id, userId, fullName) VALUES (?, ?, ?)").run(newId(), userId, fullName);

  await setSessionCookie({ id: userId, role: "CANDIDATE", email });
  redirect("/candidate/dashboard");
}

export async function login(prevState, formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  const db = getDb();
  const user = db.prepare("SELECT * FROM User WHERE email = ?").get(email);
  if (!user) return { error: "Incorrect email or password." };

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { error: "Incorrect email or password." };

  await setSessionCookie(user);
  redirect(
    user.role === "ADMIN" ? "/admin/dashboard" : user.role === "COMPANY" ? "/company/dashboard" : "/candidate/dashboard"
  );
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/");
}
