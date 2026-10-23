import { NextResponse } from "next/server";
import { compactQuotaHistory } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const summary = await compactQuotaHistory();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[Quota compaction]", error);
    return NextResponse.json({ error: error.message || "Compaction gagal" }, { status: 500 });
  }
}
