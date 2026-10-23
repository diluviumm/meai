import { NextResponse } from "next/server";
import { scanSecrets } from "@/lib/secretScan";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(scanSecrets(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Secret scan gagal" }, { status: 500 });
  }
}
