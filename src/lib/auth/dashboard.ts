import { createHmac, timingSafeEqual } from "node:crypto";

export const DASHBOARD_COOKIE = "gh_dash_session";
export const DASHBOARD_SESSION_SECONDS = 60 * 60 * 12;

function dashboardPassword(): string {
  return process.env.DASHBOARD_PASSWORD ?? "prebel-gh-demo";
}

function signingKey(): string {
  return process.env.DASHBOARD_SESSION_SECRET || `dash:${dashboardPassword()}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkDashboardPassword(password: unknown): boolean {
  return typeof password === "string" && safeEqual(password, dashboardPassword());
}

/** Token format: `<expiresAtEpochSeconds>.<hmac>` */
export function createDashboardToken(): string {
  const exp = String(Math.floor(Date.now() / 1000) + DASHBOARD_SESSION_SECONDS);
  return `${exp}.${sign(exp)}`;
}

export function verifyDashboardToken(token: string | undefined): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now() / 1000;
}
