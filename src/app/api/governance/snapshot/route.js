import { NextResponse } from "next/server";
import { snapshotSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await snapshotSettings());
  } catch (error) {
    console.error("[Governance snapshot]", error);
    return NextResponse.json({ error: error.message || "Snapshot gagal" }, { status: 500 });
  }
}
