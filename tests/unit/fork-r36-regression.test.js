import { describe, it, expect } from "vitest";
import { parseCustomRange, MAX_CUSTOM_RANGE_DAYS } from "@/lib/usageRange.js";
import { getPricingForModel, calculateCostFromTokens } from "open-sse/providers/pricing.js";

/**
 * Ronde-36 — regresi untuk fitur fork yang sebelumnya TIDAK punya test sama sekali:
 *   1. rentang hari kustom di page usage (item 4 permintaan Mael)
 *   2. tarif opencode-go supaya kolom Cost tidak pernah $0 lagi (item 3)
 * Tanpa file ini, perubahan di usageRange.js / pricing.js lolos tanpa pagar.
 */
describe("usageRange.parseCustomRange", () => {
  const q = (s) => new URLSearchParams(s);

  it("periode non-custom diteruskan apa adanya (tanpa from/to)", () => {
    expect(parseCustomRange(q("period=7d"))).toEqual({
      period: "7d", ok: true, from: null, to: null, days: 0,
    });
  });

  it("default period saat parameter kosong adalah 7d", () => {
    expect(parseCustomRange(q("")).period).toBe("7d");
  });

  it("rentang valid dihitung hari-nya inklusif", () => {
    const r = parseCustomRange(q("period=custom&from=2026-09-01&to=2026-09-29"));
    expect(r.ok).toBe(true);
    expect(r.from).toBe("2026-09-01");
    expect(r.to).toBe("2026-09-29");
    expect(r.days).toBe(29);
  });

  it("menolak format tanggal yang bukan YYYY-MM-DD", () => {
    expect(parseCustomRange(q("period=custom&from=01/09/2026&to=2026-09-29")).ok).toBe(false);
    expect(parseCustomRange(q("period=custom&from=&to=2026-09-29")).ok).toBe(false);
  });

  it("menolak tanggal yang tidak nyata", () => {
    expect(parseCustomRange(q("period=custom&from=2026-02-30&to=2026-03-01")).ok).toBe(false);
  });

  it("menolak from lebih besar dari to", () => {
    const r = parseCustomRange(q("period=custom&from=2026-09-29&to=2026-09-01"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/after/);
  });

  it("menolak rentang melebihi batas maksimal", () => {
    const big = parseCustomRange(q(`period=custom&from=2020-01-01&to=2030-01-01`));
    expect(big.ok).toBe(false);
    expect(big.error).toContain(String(MAX_CUSTOM_RANGE_DAYS));
  });

  it("batas tepat di MAX_CUSTOM_RANGE_DAYS masih diterima", () => {
    // 2024-01-01 → 2025-12-31 = 730 hari jarak = 731 hari inklusif (2048 lompat)
    const r = parseCustomRange(q("period=custom&from=2024-01-01&to=2025-12-31"));
    expect(r.ok).toBe(true);
    expect(r.days).toBe(MAX_CUSTOM_RANGE_DAYS);
  });

  it("menolak 1 hari di atas batas", () => {
    const r = parseCustomRange(q("period=custom&from=2024-01-01&to=2026-01-01"));
    expect(r.ok).toBe(false);
    expect(r.days).toBeUndefined();
  });
});

describe("pricing opencode-go (regresi item-3: Cost tidak boleh $0)", () => {
  it("mimo-v2.6-flash punya tarif lengkap", () => {
    const p = getPricingForModel("opencode-go", "mimo-v2.6-flash");
    expect(p).toBeTruthy();
    expect(p.input).toBeGreaterThan(0);
    expect(p.output).toBeGreaterThan(0);
    expect(p.cached).toBeGreaterThanOrEqual(0);
  });

  it("deepseek-v4.1-flash punya tarif lengkap", () => {
    const p = getPricingForModel("opencode-go", "deepseek-v4.1-flash");
    expect(p).toBeTruthy();
    expect(p.input).toBeGreaterThan(0);
    expect(p.output).toBeGreaterThan(0);
  });

  it("tarif ikut provider (codebuddy-cn punya tarif sendiri)", () => {
    expect(getPricingForModel("codebuddy-cn", "deepseek-v4.1-flash")).toBeTruthy();
  });

  it("model tak dikenal tetap null (cost memang $0, bukan diarang-arang)", () => {
    expect(getPricingForModel("opencode-go", "model-yang-tidak-ada-9x")).toBeNull();
  });

  it("hitung cost nyata > 0 dari token asli", () => {
    const pricing = getPricingForModel("opencode-go", "mimo-v2.6-flash");
    const cost = calculateCostFromTokens(
      { prompt_tokens: 771, completion_tokens: 16, cached_tokens: 0, reasoning_tokens: 17 },
      pricing,
    );
    expect(cost).toBeGreaterThan(0);
    // diukur ulang dari tarif: 771*0.4 + 16*2 + 17*2 (per 1M token)
    expect(cost).toBeCloseTo((771 * 0.4 + 16 * 2 + 17 * 2) / 1_000_000, 6);
  });

  it("token ter-cache dihitung dengan tarif cached, bukan tarif input", () => {
    const pricing = { input: 1, output: 1, cached: 0.1 };
    const withCache = calculateCostFromTokens(
      { prompt_tokens: 1000, completion_tokens: 0, cached_tokens: 1000 },
      pricing,
    );
    expect(withCache).toBeCloseTo((1000 * 0.1) / 1_000_000, 9);
  });
});
