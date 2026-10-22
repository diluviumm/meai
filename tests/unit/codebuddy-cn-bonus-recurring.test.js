// CodeBuddy CN mixes recurring refill packs with one-shot bonus packs.
// Bonus packs ("Bonus Pack N") must surface recurring:false so the dashboard
// shows "Expires in" instead of implying a monthly refill. The usage handler
// tags the flag and parseQuotaData must forward it.
import { describe, it, expect } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("parseQuotaData codebuddy-cn recurring flag", () => {
  it("forwards recurring:false for bonus packs and true for refill packs", () => {
    const data = {
      plan: "CodeBuddy CN",
      quotas: {
        Monthly: { used: 6.54, total: 500, resetAt: "2026-07-31T00:00:00Z", recurring: true },
        "Bonus Pack 1": { used: 12, total: 100, resetAt: "2026-07-15T00:00:00Z", recurring: false },
      },
    };

    const out = parseQuotaData("codebuddy-cn", data);
    const byName = Object.fromEntries(out.map((q) => [q.name, q]));

    expect(byName["Monthly"].recurring).toBe(true);
    expect(byName["Bonus Pack 1"].recurring).toBe(false);
  });

  it("defaults recurring to true when the flag is absent (back-compat)", () => {
    const data = { quotas: { Monthly: { used: 0, total: 100, resetAt: null } } };
    const out = parseQuotaData("codebuddy-cn", data);
    expect(out[0].recurring).toBe(true);
  });

  it("forwards expired + a clamped remainingPercentage", () => {
    const data = {
      quotas: {
        Monthly: { used: 0, total: 500, resetAt: "2026-10-31T00:00:00Z", recurring: true, expired: false },
        "Bonus Pack 1": { used: 100, total: 100, resetAt: "2026-09-28T00:00:00Z", recurring: false, expired: true },
      },
    };
    const out = parseQuotaData("codebuddy-cn", data);
    const byName = Object.fromEntries(out.map((q) => [q.name, q]));
    expect(byName.Monthly.remainingPercentage).toBe(100);
    expect(byName.Monthly.expired).toBe(false);
    expect(byName["Bonus Pack 1"].remainingPercentage).toBe(0);
    expect(byName["Bonus Pack 1"].expired).toBe(true);
  });
});
