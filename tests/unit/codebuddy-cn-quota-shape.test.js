// Regression guard for the 2026-10-22 CodeBuddy quota fix.
//
// Live CN plan subscription reports:
//   CapacityUsed=0 / CapacityRemain=500      (live balance)
//   CycleCapacityUsed=500 / CycleRemain=0    (placeholder garbage, TotalCycles=1)
// The old handler always read Cycle* for refill packs, so a fresh 500-credit
// plan rendered as 500/500 (0% free) and the dashboard marked it depleted.
// The handler must use the coherent Capacity* pair for base/bonus packs and
// only use Cycle* for genuine multi-cycle refills.

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { getCodeBuddyCnUsage, getCodeBuddyIntlUsage } from "open-sse/services/usage/codebuddy-cn.js";

function pack(overrides = {}) {
  return {
    CapacityType: 1,
    PackageName: "CodeBuddy个人体验版",
    SubProductCode: "sp_tcaca_codebuddyide_bonus_pack",
    Status: 0,
    TotalCycles: 1,
    RemainCycles: 0,
    CycleStartTime: "2026-10-20 00:00:00",
    CycleEndTime: "2026-11-20 00:00:00",
    DeductionEndTime: 1795000000000,
    CapacitySizePrecise: "100",
    CapacityUsedPrecise: "0",
    CapacityRemainPrecise: "100",
    CycleCapacitySizePrecise: "100",
    CycleCapacityUsedPrecise: "0",
    CycleCapacityRemainPrecise: "100",
    ExpiredTime: "",
    ...overrides,
  };
}

function reply(accounts) {
  return {
    status: 200,
    ok: true,
    json: async () => ({
      code: 0,
      data: { Response: { Data: { Accounts: accounts } } },
    }),
  };
}

describe("CodeBuddy quota balance extraction", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("renders a fresh CN base plan as 0/500 even when Cycle* says 500/500", async () => {
    fetchMock.mockResolvedValueOnce(
      reply([
        pack({
          CapacityType: 4,
          PackageName: "CodeBuddy个人体验版",
          SubProductCode: "sp_tcaca_codebuddy_ide",
          CapacitySizePrecise: "500",
          CapacityUsedPrecise: "0",
          CapacityRemainPrecise: "500",
          CycleCapacitySizePrecise: "500",
          CycleCapacityUsedPrecise: "500",
          CycleCapacityRemainPrecise: "0",
          CycleStartTime: "2026-10-01 00:00:00",
          CycleEndTime: "2026-10-31 23:59:59",
          DeductionEndTime: 2042168028000,
        }),
        // exhausted one-shot bonus
        pack({
          Status: 3,
          CycleEndTime: "2026-09-28 00:45:45",
          ExpiredTime: "2026-09-28 00:39:01",
          CapacityUsedPrecise: "100",
          CapacityRemainPrecise: "0",
          CycleCapacityUsedPrecise: "100",
          CycleCapacityRemainPrecise: "0",
        }),
        // live bonus
        pack({
          CycleEndTime: "2026-11-07 13:31:02",
          CapacityUsedPrecise: "0",
          CapacityRemainPrecise: "100",
          CycleCapacityUsedPrecise: "0",
          CycleCapacityRemainPrecise: "100",
        }),
      ]),
    );

    const usage = await getCodeBuddyCnUsage(null, "test-key", {}, null);
    expect(usage.quotas.Monthly).toMatchObject({
      used: 0,
      total: 500,
      recurring: true,
      expired: false,
    });
    expect(usage.quotas["Bonus Pack 1"].expired).toBe(false);
    expect(usage.quotas["Bonus Pack 2"].expired).toBe(true);
    // Active pack is listed before the expired one.
    expect(Object.keys(usage.quotas).slice(0, 2)).toEqual(["Monthly", "Bonus Pack 1"]);
  });

  it("keeps a genuinely exhausted bonus pack at used == total", async () => {
    fetchMock.mockResolvedValueOnce(
      reply([
        pack({
          CycleEndTime: "2026-09-28 00:45:45",
          ExpiredTime: "2026-09-28 00:39:01",
          Status: 3,
          CapacityUsedPrecise: "100",
          CapacityRemainPrecise: "0",
          CycleCapacityUsedPrecise: "100",
          CycleCapacityRemainPrecise: "0",
        }),
      ]),
    );

    const usage = await getCodeBuddyCnUsage(null, "test-key", {}, null);
    expect(usage.quotas["Bonus Pack 1"]).toMatchObject({ used: 100, total: 100, expired: true });
  });

  it("uses Cycle* only for real multi-cycle refills", async () => {
    fetchMock.mockResolvedValueOnce(
      reply([
        pack({
          CapacityType: 4,
          SubProductCode: "sp_tcaca_codebuddy_ide",
          TotalCycles: 6,
          RemainCycles: 3,
          CapacityUsedPrecise: "0",
          CapacityRemainPrecise: "100",
          CycleCapacityUsedPrecise: "40",
          CycleCapacityRemainPrecise: "60",
          CycleCapacitySizePrecise: "100",
        }),
      ]),
    );

    const usage = await getCodeBuddyCnUsage(null, "test-key", {}, null);
    expect(usage.quotas.Monthly).toMatchObject({ used: 40, total: 100 });
  });

  it("handles the intl Free Plan shape (DeductionEnd in 2046)", async () => {
    fetchMock.mockResolvedValueOnce(
      reply([
        pack({
          CapacityType: 4,
          PackageName: "Free Plan Subscription",
          SubProductCode: "sp_tcaca_codebuddy_ide",
          CycleStartTime: "2026-10-01 00:00:00",
          CycleEndTime: "2026-10-31 23:59:59",
          DeductionEndTime: 2046564678000,
          CapacitySizePrecise: "100",
          CapacityUsedPrecise: "0",
          CapacityRemainPrecise: "100",
          CycleCapacitySizePrecise: "100",
          CycleCapacityUsedPrecise: "0",
          CycleCapacityRemainPrecise: "100",
        }),
      ]),
    );

    const usage = await getCodeBuddyIntlUsage(null, "test-key", {}, null);
    expect(usage.quotas.Monthly).toMatchObject({ used: 0, total: 100, recurring: true });
  });

  it("claims the daily bonus before reading usage for OAuth connections", async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ code: 0, msg: "OK" }) })
      .mockResolvedValueOnce(
        reply([pack({ SubProductCode: "sp_tcaca_codebuddy_ide", CapacitySizePrecise: "500", CapacityRemainPrecise: "500" })]),
      );

    await getCodeBuddyCnUsage("oauth-token-daily-claim", null, {}, null);
    expect(fetchMock.mock.calls[0][0]).toContain("daily-checkin");
    expect(fetchMock.mock.calls[1][0]).toContain("get-user-resource");
  });

  it("never calls the OAuth-only check-in for API-key connections", async () => {
    fetchMock.mockResolvedValueOnce(reply([pack()]));
    await getCodeBuddyCnUsage(null, "api-key-only-connection", {}, null);
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toContain("get-user-resource");
  });
});
