import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ── Registrasi: provider harus masuk USAGE_SUPPORTED + USAGE_APIKEY ────────
describe("xiaomi-tokenplan quota registration", () => {
  it("registry exposes usage + usageApikey flags", async () => {
    const src = fs.readFileSync(
      path.join(ROOT, "open-sse/providers/registry/xiaomi-tokenplan.js"),
      "utf-8",
    );
    expect(src).toContain("features:");
    expect(src).toMatch(/usage:\s*true/);
    expect(src).toMatch(/usageApikey:\s*true/);
  });

  it("usage dispatcher wires a handler for xiaomi-tokenplan", async () => {
    const { getUsageForProvider } = await import("open-sse/services/usage.js");
    const usage = await getUsageForProvider({
      provider: "xiaomi-tokenplan",
      apiKey: "***",
      providerSpecificData: { region: "sgp" },
    });
    // No cookie → self-tracked path; must never answer "not implemented"
    expect(usage).toBeTruthy();
    expect(JSON.stringify(usage)).not.toContain("not implemented");
    expect(usage.plan).toBe("Token Plan");
    expect(usage.source).toBe("self-tracked");
    expect(usage.quotas).toBeTruthy();
    expect(typeof usage.quotas["Used this month (local)"].used).toBe("number");
  });
});

// ── Self-tracking: angka dari usageHistory lokal ───────────────────────────
describe("xiaomi-tokenplan self-tracking", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("aggregates only this gateway's current-month tokens for the connection", async () => {
    const history = [
      { connectionId: "c1", tokens: { total_tokens: 100 } },
      { connectionId: "c1", tokens: { prompt_tokens: 50, completion_tokens: 25 } },
      { connectionId: "other", tokens: { total_tokens: 999999 } },
    ];
    vi.doMock("@/lib/usageDb.js", () => ({
      getUsageHistory: vi.fn(async () => history),
    }));
    const { getXiaomiTokenplanUsage } = await import(
      "open-sse/services/usage/xiaomi-tokenplan.js"
    );
    const out = await getXiaomiTokenplanUsage("tp-x", { planTotalTokens: 1000 }, null, { id: "c1" });
    const row = out.quotas["Used this month (local)"];
    expect(row.used).toBe(175); // other-connection traffic excluded
    expect(row.total).toBe(1000);
    expect(row.unit).toBe("tokens");
    expect(row.unlimited).toBe(false);
    vi.doUnmock("@/lib/usageDb.js");
  });

  it("marks the bar unlimited when no plan limit is configured, and hints why", async () => {
    vi.doMock("@/lib/usageDb.js", () => ({
      getUsageHistory: vi.fn(async () => []),
    }));
    const { getXiaomiTokenplanUsage } = await import(
      "open-sse/services/usage/xiaomi-tokenplan.js"
    );
    const out = await getXiaomiTokenplanUsage("tp-x", {}, null, { id: "c1" });
    const row = out.quotas["Used this month (local)"];
    expect(row.unlimited).toBe(true);
    expect(row.total).toBe(0);
    expect(out.hint).toBeTruthy();
    expect(out.hint).toContain("tp- keys");
    vi.doUnmock("@/lib/usageDb.js");
  });
});

// ── UI: parseQuotaData case ────────────────────────────────────────────────
describe("parseQuotaData xiaomi-tokenplan", () => {
  it("forwards used/total/unlimited/remainingPercentage/resetAt/unit", async () => {
    const { parseQuotaData } = await import(
      "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
    );
    const rows = parseQuotaData("xiaomi-tokenplan", {
      plan: "Token Plan",
      quotas: {
        "Plan quota": {
          used: 2500000,
          total: 11000000000,
          remainingPercentage: 99,
          resetAt: "2026-10-15T00:00:00.000Z",
          unit: "tokens",
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Plan quota");
    expect(rows[0].used).toBe(2500000);
    expect(rows[0].total).toBe(11000000000);
    expect(rows[0].remainingPercentage).toBe(99);
    expect(rows[0].unit).toBe("tokens");
    expect(rows[0].unlimited).toBe(false);
    expect(rows[0].resetAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("flags unlimited rows when the plan total is unknown (total 0)", async () => {
    const { parseQuotaData } = await import(
      "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
    );
    const rows = parseQuotaData("xiaomi-tokenplan", {
      quotas: { "Used this month (local)": { used: 12345, total: 0, unit: "tokens" } },
    });
    expect(rows[0].unlimited).toBe(true);
    expect(rows[0].used).toBe(12345);
  });
});
