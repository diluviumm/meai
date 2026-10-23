import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { appendSettingsAudit } from "@/lib/settingsAudit";

export const dynamic = "force-dynamic";

const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ labels: settings.costLabels || {} });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body?.name || "").slice(0, 80);
    const label = String(body?.label || "").trim().slice(0, 40);
    if (!name || BLOCKED.has(name)) {
      return NextResponse.json({ error: "Nama key tidak valid" }, { status: 400 });
    }
    const settings = await getSettings();
    const labels = { ...(settings.costLabels || {}) };
    if (label) labels[name] = label;
    else delete labels[name];
    await updateSettings({ costLabels: labels });
    appendSettingsAudit({ costLabels: { name, label: label || null } });
    return NextResponse.json({ ok: true, labels });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Gagal menyimpan label" }, { status: 500 });
  }
}
