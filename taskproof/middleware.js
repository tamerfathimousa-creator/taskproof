import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "taskproof_session";
const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-me");

async function readSession(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

function dashboardFor(role) {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "COMPANY") return "/company/dashboard";
  return "/candidate/dashboard";
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const isCompanyArea = pathname.startsWith("/company");
  const isCandidateArea = pathname.startsWith("/candidate");
  const isAdminArea = pathname.startsWith("/admin");

  if (!isCompanyArea && !isCandidateArea && !isAdminArea) return NextResponse.next();

  const session = await readSession(req);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Admin is a separate, backend-only role (seeded from env vars, no public
  // signup) that can read across every company's and candidate's data — it
  // never gets company or candidate area access, and nobody else gets
  // admin area access.
  if (isAdminArea && session.role !== "ADMIN") {
    const url = req.nextUrl.clone();
    url.pathname = dashboardFor(session.role);
    return NextResponse.redirect(url);
  }

  if (isCompanyArea && session.role !== "COMPANY") {
    const url = req.nextUrl.clone();
    url.pathname = dashboardFor(session.role);
    return NextResponse.redirect(url);
  }

  if (isCandidateArea && session.role !== "CANDIDATE") {
    const url = req.nextUrl.clone();
    url.pathname = dashboardFor(session.role);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/company/:path*", "/candidate/:path*", "/admin/:path*"],
};
