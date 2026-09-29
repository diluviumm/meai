import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { parseCustomRange } from "@/lib/usageRange";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all", "custom"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = parseCustomRange(searchParams);
    const period = parsed.period;

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const data = await getChartData(
      period,
      parsed.from ? { from: parsed.from, to: parsed.to } : {},
    );
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
