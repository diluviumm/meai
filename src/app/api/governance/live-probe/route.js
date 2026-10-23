import { NextResponse } from "next/server";
import { createApiKey, deleteApiKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";
let running = false;

/**
 * Manual live probe. Creates a short-lived API key, sends exactly one small
 * request through the gateway, then deletes the key in a finally block. It is
 * never scheduled automatically because providers may charge per request.
 */
export async function POST(request) {
  if (running) return NextResponse.json({ error: "Probe lain sedang berjalan" }, { status: 429 });
  let temp = null;
  running = true;
  try {
    const body = await request.json().catch(() => ({}));
    const model = String(body?.model || "").trim().slice(0, 120);
    if (!model) return NextResponse.json({ error: "Model wajib diisi" }, { status: 400 });
    temp = await createApiKey("live-probe-temp", `probe${Date.now().toString(36)}`);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    let response;
    try {
      response = await fetch(`${process.env.MEAI_INTERNAL_URL || "http://127.0.0.1:20128"}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${temp.key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 8, stream: false }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      model,
      latencyMs: Date.now() - started,
      usage: payload?.usage || null,
      content: payload?.choices?.[0]?.message?.content || null,
      error: response.ok ? null : (payload?.error?.message || payload?.error || raw.slice(0, 300)),
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.name === "AbortError" ? "Probe timeout 25s" : error.message }, { status: 500 });
  } finally {
    if (temp?.id) await deleteApiKey(temp.id).catch(() => {});
    running = false;
  }
}
