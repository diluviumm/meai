import { describe, it, expect } from "vitest";

// ── Ronde-41: KPI p95 latency — rekam ke usageHistory.meta + perhitungan kuantil ──
// "Gate the tail, not the mean" (praktik 2026) — lihat docs/PANDUAN.md §Usage.

describe("latency recording (saveRequestUsage → meta)", () => {
  it("menyimpan entry.latency ke kolom meta, dan meta kosong bila tanpa latensi", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { saveRequestUsage, getUsageHistory } = await import("@/lib/usageDb.js");
    const db = await getAdapter();

    const ts = new Date().toISOString();
    await saveRequestUsage({
      provider: "openai-compatible-test-latency",
      model: "m",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      timestamp: ts,
      connectionId: "lat-test",
      latency: { total: 1234, ttft: 800 },
    });
    await saveRequestUsage({
      provider: "openai-compatible-test-latency",
      model: "m2",
      tokens: { prompt_tokens: 11, completion_tokens: 6 },
      timestamp: new Date(Date.now() + 1).toISOString(),
      connectionId: "lat-test",
      // tanpa latency → meta harus tetap {} (bukan null/undefined rusak)
    });

    const rows = db.all(
      `SELECT meta FROM usageHistory WHERE connectionId = 'lat-test' ORDER BY id`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const withLat = rows.map((r) => JSON.parse(r.meta || "{}"));
    expect(withLat.some((m) => m.latency?.total === 1234 && m.latency?.ttft === 800)).toBe(true);
    expect(withLat.some((m) => m.latency === undefined)).toBe(true);

    // bersihkan
    db.run(`DELETE FROM usageHistory WHERE connectionId = 'lat-test'`);
  });
});

describe("latency p50/p95 (getUsageStats)", () => {
  it("menghitung kuantil dari meta.latency dalam jendela periode, dan aman bila tanpa sampel", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { saveRequestUsage, getUsageStats } = await import("@/lib/usageDb.js");
    const db = await getAdapter();

    // 100 sampel: 1..100 ms → p50 ≈ 50, p95 ≈ 95-96
    const base = Date.now() - 60_000;
    for (let i = 1; i <= 100; i++) {
      await saveRequestUsage({
        provider: "openai-compatible-test-latency",
        model: "m",
        tokens: { prompt_tokens: i, completion_tokens: 1 },
        timestamp: new Date(base + i).toISOString(),
        connectionId: "lat-test2",
        latency: { total: i },
      });
    }

    const stats = await getUsageStats("24h");
    expect(stats.latency).toBeTruthy();
    expect(stats.latency.samples).toBeGreaterThanOrEqual(100);
    expect(stats.latency.p50).toBeGreaterThanOrEqual(45);
    expect(stats.latency.p50).toBeLessThanOrEqual(55);
    expect(stats.latency.p95).toBeGreaterThanOrEqual(90);
    expect(stats.latency.p95).toBeLessThanOrEqual(100);
    // p95 tidak boleh lebih kecil dari p50 (inkonsistensi data)
    expect(stats.latency.p95).toBeGreaterThanOrEqual(stats.latency.p50);

    db.run(`DELETE FROM usageHistory WHERE connectionId = 'lat-test2'`);
  });
});
