import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const FILE = path.join(os.homedir(), ".meai", "health-routing.json");

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { percent: 0, scores: {}, disabled: false }; }
}

export async function GET() {
  return NextResponse.json(read(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const percent = Math.max(0, Math.min(100, Number(body.percent) || 0));
  const scores = body.scores && typeof body.scores === "object" ? body.scores : read().scores || {};
  const state = { percent, scores, disabled: Boolean(body.disabled), updatedAt: Date.now() };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  return NextResponse.json({ ok: true, ...state });
}
