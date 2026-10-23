import { NextResponse } from "next/server";
import { getInsights } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/insights?hours=24 — health score, leaderboard, anomaly, heatmap. */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Number(searchParams.get("hours") || 24);
    return NextResponse.json(await getInsights({ hours }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[Insights API]", error);
    return NextResponse.json({ error: error.message || "Failed to build insights" }, { status: 500 });
  }
}
