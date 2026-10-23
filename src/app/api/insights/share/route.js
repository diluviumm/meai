import { NextResponse } from "next/server";
import { signShareToken } from "@/lib/shareToken";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token, expiresAt } = signShareToken(body.hours, body.ttlMinutes);
    const url = new URL(`/api/insights/shared?token=${encodeURIComponent(token)}`, request.url).toString();
    return NextResponse.json({ url, expiresAt });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Share gagal" }, { status: 500 });
  }
}
