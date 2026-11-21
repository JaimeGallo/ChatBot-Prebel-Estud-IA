import { NextRequest, NextResponse } from "next/server";
import { getDashboardMetrics } from "@/lib/telemetry";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("x-dashboard-password");
  const expected = process.env.DASHBOARD_PASSWORD ?? "prebel-gh-demo";

  if (auth !== expected) {
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
