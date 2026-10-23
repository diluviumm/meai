import { NextResponse } from "next/server";
import { getGovernance } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getGovernance(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Governance API]", error);
    return NextResponse.json({ error: error.message || "Failed to build governance payload" }, { status: 500 });
  }
}
