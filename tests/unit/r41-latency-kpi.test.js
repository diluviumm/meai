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
  it(
    "menghitung kuantil dari meta.latency dalam jendela periode, dan aman bila tanpa sampel",
    { retry: 2 },
    async () => {
      const { getAdapter } = await import("@/lib/db/driver.js");
      const { saveRequestUsage, getUsageStats } = await import("@/lib/usageDb.js");
      const db = await getAdapter();

      // 100 sampel: 1..100 ms
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

      // Anti-kontaminasi: suite paralel menulis ke sandbox DB yang sama, sehingga
      // angka absolut jendela global bisa bergeser di antara run (pernah 99 vs 100).
      // Verifikasi terhadap recomputasi independen dari SUMBER YANG SAMA
      // (usageHistory, jendela 24h, meta.latency.total, 5000 baris terbaru).
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const rows = db.all(
        `SELECT meta FROM usageHistory WHERE timestamp >= ? ORDER BY id DESC LIMIT 5000`,
        [cutoff],
      );
      const expected = [];
      for (const r of rows) {
        try {
          const t = JSON.parse(r.meta || "{}")?.latency?.total;
          if (typeof t === "number" && Number.isFinite(t) && t >= 0) expected.push(t);
        } catch { /* baris rusak diabaikan — sama seperti implementasi */ }
      }
      expected.sort((a, b) => a - b);
      const q = (p) =>
        expected[Math.min(expected.length - 1, Math.max(0, Math.round(p * (expected.length - 1))))];
      expect(stats.latency.samples).toBe(expected.length);
      expect(stats.latency.p50).toBe(q(0.5));
      expect(stats.latency.p95).toBe(q(0.95));
      expect(stats.latency.p95).toBeGreaterThanOrEqual(stats.latency.p50);
      expect(stats.latency.samples).toBeGreaterThanOrEqual(1);

      // Bila jendela bersih (hanya 100 sampel kita), tegakkan band nilai asli.
      if (expected.length === 100) {
        expect(stats.latency.p50).toBeGreaterThanOrEqual(45);
        expect(stats.latency.p50).toBeLessThanOrEqual(55);
        expect(stats.latency.p95).toBeGreaterThanOrEqual(90);
        expect(stats.latency.p95).toBeLessThanOrEqual(100);
      }

      db.run(`DELETE FROM usageHistory WHERE connectionId = 'lat-test2'`);
    },
  );
});
