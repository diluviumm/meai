import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { getPricing } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const pricing = await getPricing();
    const prices = {};
    for (const [provider, models] of Object.entries(pricing || {})) {
      if (!models || typeof models !== "object") continue;
      for (const [model, price] of Object.entries(models)) {
        if (price && typeof price === "object") prices[`${provider}/${model}`] = { input: price.input, output: price.output, cached: price.cached };
      }
    }
    const file = path.join(os.homedir(), ".meai", "pricing-snapshot.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ts: Date.now(), prices }, null, 2));
    return NextResponse.json({ ok: true, count: Object.keys(prices).length });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Pricing snapshot gagal" }, { status: 500 });
  }
}
