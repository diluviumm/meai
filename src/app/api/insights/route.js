import { NextResponse } from "next/server";
import { getInsights } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/insights?hours=24 — cookie admin sees all; a Bearer API key sees
 * only rows attributed to that key. This is the read-side tenant boundary.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Number(searchParams.get("hours") || 24);
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    return NextResponse.json(await getInsights({ hours, apiKey: bearer || null }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[Insights API]", error);
    return NextResponse.json({ error: error.message || "Failed to build insights" }, { status: 500 });
  }
}
