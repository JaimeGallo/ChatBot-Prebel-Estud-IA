import { NextRequest, NextResponse } from "next/server";
import {
  DASHBOARD_COOKIE,
  DASHBOARD_SESSION_SECONDS,
  checkDashboardPassword,
  createDashboardToken,
} from "@/lib/auth/dashboard";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));

  if (!checkDashboardPassword(password)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(DASHBOARD_COOKIE, createDashboardToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: DASHBOARD_SESSION_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DASHBOARD_COOKIE);
  return res;
}
