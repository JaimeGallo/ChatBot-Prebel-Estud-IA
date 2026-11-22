import { NextRequest, NextResponse } from "next/server";
import { getDashboardMetrics } from "@/lib/telemetry";
import { DASHBOARD_COOKIE, verifyDashboardToken } from "@/lib/auth/dashboard";

export async function GET(req: NextRequest) {
  if (!verifyDashboardToken(req.cookies.get(DASHBOARD_COOKIE)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const days = Number(req.nextUrl.searchParams.get("days") ?? "30");
    const metrics = await getDashboardMetrics(days);
    return NextResponse.json(metrics);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error" },
      { status: 500 }
    );
  }
}
