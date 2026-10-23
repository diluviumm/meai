import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function POST() {
  const settings = await getSettings();
  const url = settings.alertWebhookUrl || settings.alertWebhook;
  if (!url) return NextResponse.json({ error: "alertWebhookUrl belum diset" }, { status: 400 });
  let parsed;
  try { parsed = new URL(url); } catch { return NextResponse.json({ error: "URL webhook tidak valid" }, { status: 400 }); }
  if (parsed.protocol !== "https:") return NextResponse.json({ error: "Webhook harus HTTPS" }, { status: 400 });
  try {
    const response = await fetch(parsed.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meai.test", ts: Date.now(), source: "governance" }),
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json({ ok: response.ok, status: response.status, host: parsed.host });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || "Webhook gagal" }, { status: 502 });
  }
}
