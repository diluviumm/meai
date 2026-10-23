import { NextResponse } from "next/server";
import { getComboByName, getProviderConnections } from "@/lib/localDb";
import { getInsights } from "@/lib/db";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

export const dynamic = "force-dynamic";

function requiredCaps(body = {}) {
  const caps = new Set();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "image_url" || part?.type === "image") caps.add("vision");
      if (part?.type === "input_audio" || part?.type === "audio") caps.add("audioInput");
      if (part?.type === "file" || part?.type === "document") caps.add("pdf");
    }
  }
  if (body.tools?.length || body.functions?.length) caps.add("tools");
  return [...caps];
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "name combo wajib" }, { status: 400 });
    const combo = await getComboByName(name);
    if (!combo) return NextResponse.json({ error: "Combo tidak ditemukan" }, { status: 404 });

    const [connections, insights] = await Promise.all([getProviderConnections(), getInsights({ hours: 24 })]);
    const healthByProvider = {};
    for (const conn of connections) {
      const score = insights.connections.find((row) => row.id === conn.id)?.score;
      if (!healthByProvider[conn.provider]) healthByProvider[conn.provider] = [];
      healthByProvider[conn.provider].push({ connectionId: conn.id, name: conn.name || conn.provider, score });
    }
    const needed = requiredCaps(body);
    const ordered = (combo.models || []).map((model, index) => {
      const [provider] = String(model).split("/");
      const caps = getCapabilitiesForModel(provider, String(model).split("/").slice(1).join("/"));
      const missing = needed.filter((cap) => caps?.[cap] !== true);
      const health = healthByProvider[provider] || [];
      const best = health.reduce((max, row) => Math.max(max, row.score ?? -1), -1);
      return {
        order: index + 1,
        model,
        provider,
        connections: health.length,
        healthScore: best < 0 ? null : best,
        compatible: missing.length === 0,
        missing,
      };
    });

    return NextResponse.json({
      combo: combo.name,
      strategy: combo.kind || combo.strategy || "fallback",
      requiredCaps: needed,
      models: ordered,
      note: "Dry-run: urutan + health score + capability; tidak mengirim request ke provider.",
    });
  } catch (error) {
    console.error("[Combo simulate]", error);
    return NextResponse.json({ error: error.message || "Simulasi gagal" }, { status: 500 });
  }
}
