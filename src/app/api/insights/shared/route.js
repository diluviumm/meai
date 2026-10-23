import { NextResponse } from "next/server";
import { getInsights } from "@/lib/db";
import { verifyShareToken } from "@/lib/shareToken";

export const dynamic = "force-dynamic";

/** Public, signed, expiring read-only snapshot. */
export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token");
  const data = verifyShareToken(token);
  if (!data) return NextResponse.json({ error: "Link tidak valid atau kedaluwarsa" }, { status: 401 });
  return NextResponse.json(await getInsights({ hours: data.hours }), { headers: { "Cache-Control": "no-store" } });
}
