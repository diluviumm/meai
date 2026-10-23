import { NextResponse } from "next/server";
import { signShareToken } from "@/lib/shareToken";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token, expiresAt } = signShareToken(body.hours, body.ttlMinutes);
    const requestUrl = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || requestUrl.host;
    const proto = request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
    const base = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;
    const url = new URL(`/api/insights/shared?token=${encodeURIComponent(token)}`, base).toString();
    return NextResponse.json({ url, expiresAt });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Share gagal" }, { status: 500 });
  }
}
