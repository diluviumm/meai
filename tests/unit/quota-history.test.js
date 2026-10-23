import { describe, expect, it } from "vitest";
import {
  appendQuotaSample,
  forecastQuota,
  mergeQuotaHistory,
  sparklinePoints,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaHistory.js";

const HOUR = 3_600_000;

describe("quota history + burn-rate forecast", () => {
  it("records at most one sample per minute and keeps newest last", () => {
    let series = appendQuotaSample([], { used: 0, pct: 100 }, 0);
    series = appendQuotaSample(series, { used: 5, pct: 95 }, 30_000);
    expect(series).toHaveLength(1);
    series = appendQuotaSample(series, { used: 5, pct: 95 }, 61_000);
    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({ used: 5, pct: 95 });
  });

  it("starts a new series when usage drops (quota window reset)", () => {
    const old = [
      { t: 0, used: 100, pct: 0 },
      { t: HOUR, used: 120, pct: 0 },
    ];
    const next = appendQuotaSample(old, { used: 2, pct: 98 }, 2 * HOUR);
    expect(next).toEqual([{ t: 2 * HOUR, used: 2, pct: 98 }]);
  });

  it("forecasts days left from the observed burn rate", () => {
    const now = 10 * HOUR;
    const samples = [
      { t: 0, used: 0, pct: 100 },
      { t: 2 * HOUR, used: 100, pct: 80 },
    ];
    const forecast = forecastQuota(
      { used: 100, total: 500, resetAt: new Date(now + 30 * 24 * HOUR).toISOString() },
      samples,
      now,
    );
    expect(forecast).not.toBeNull();
    expect(forecast.burnPerDay).toBe(1200);
    expect(forecast.daysLeft).toBeCloseTo(1 / 3, 5);
    expect(forecast.short).toContain("h left");
    expect(forecast.binding).toBe("exhaustion");
    expect(["low", "medium", "high"]).toContain(forecast.confidence);
    expect(forecast.renewalAware.exhaustInDays).toBeCloseTo(1 / 3, 5);
  });

  it("prefers the reset countdown when reset happens before the forecast limit", () => {
    const now = 10 * HOUR;
    const samples = [
      { t: 0, used: 0, pct: 100 },
      { t: 2 * HOUR, used: 10, pct: 90 },
    ];
    const forecast = forecastQuota(
      { used: 10, total: 500, resetAt: new Date(now + 24 * HOUR).toISOString() },
      samples,
      now,
    );
    expect(forecast.daysLeft).toBeGreaterThan(1);
    expect(forecast.short).toContain("resets");
    expect(forecast.binding).toBe("reset");
  });

  it("uses 'expires' for a non-recurring pack", () => {
    const now = 10 * HOUR;
    const forecast = forecastQuota(
      {
        used: 10,
        total: 500,
        recurring: false,
        resetAt: new Date(now + 24 * HOUR).toISOString(),
      },
      [
        { t: 0, used: 0, pct: 100 },
        { t: 2 * HOUR, used: 10, pct: 90 },
      ],
      now,
    );
    expect(forecast.short).toContain("expires");
  });

  it("returns no forecast until there are two samples spanning 12 minutes", () => {
    expect(forecastQuota({ used: 1, total: 10 }, [], 0)).toBeNull();
    expect(forecastQuota({ used: 1, total: 10 }, [{ t: 0, used: 0, pct: 100 }], 0)).toBeNull();
    expect(
      forecastQuota(
        { used: 1, total: 10 },
        [
          { t: 0, used: 0, pct: 100 },
          { t: 60_000, used: 1, pct: 90 },
        ],
        60_000,
      ),
    ).toBeNull();
  });

  it("raises forecast confidence when enough samples span a useful window", () => {
    const now = 10 * HOUR;
    const samples = Array.from({ length: 11 }, (_, index) => ({
      t: index * 12 * 60_000,
      used: index * 5,
      pct: 100 - index * 0.5,
    }));
    const forecast = forecastQuota(
      { used: 50, total: 500, resetAt: new Date(now + 30 * 24 * HOUR).toISOString() },
      samples,
      now,
    );
    expect(forecast.confidence).toBe("high");
    expect(forecast.samples).toBe(11);
    expect(forecast.title).toContain("keyakinan high");
  });

  it("produces an SVG polyline for the sparkline", () => {
    const points = sparklinePoints([
      { t: 0, used: 0, pct: 100 },
      { t: HOUR, used: 10, pct: 90 },
      { t: 2 * HOUR, used: 20, pct: 80 },
    ]);
    expect(points.split(" ")).toHaveLength(3);
    expect(points).toContain(",");
  });

  it("merges server rows with the local fallback, newest last", () => {
    const merged = mergeQuotaHistory(
      { Monthly: [{ t: 2 * HOUR, used: 20, pct: 80 }] },
      {
        Monthly: [
          { t: HOUR, used: 10, pct: 90 },
          { t: 2 * HOUR, used: 99, pct: 1 },
        ],
      },
    );
    expect(merged.Monthly.map((s) => s.t)).toEqual([HOUR, 2 * HOUR]);
    expect(merged.Monthly[1].used).toBe(20); // server wins on the same bucket
  });
});
