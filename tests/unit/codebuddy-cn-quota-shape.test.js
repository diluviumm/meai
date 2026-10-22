// Regression guard for the 2026-10-22 CodeBuddy quota fix.
//
// Live CN plan subscription reports:
//   CapacityUsed=0 / CapacityRemain=500      (live balance)
//   CycleCapacityUsed=500 / CycleRemain=0    (placeholder garbage, TotalCycles=1)
// The old handler always read Cycle* for refill packs, so a fresh 500-credit
// plan rendered as 500/500 (0% free) and the dashboard marked it depleted.
// The handler must use the coherent Capacity* pair for base/bonus packs and
// only use Cycle* for genuine multi-cycle refills.
//
// The handler also reads /checkin-activity-status (API-key safe) in parallel
// with quota; every quota mock must answer that path too.

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

function checkInReply(overrides = {}) {
  return {
    status: 200,
    ok: true,
    json: async () => ({
      code: 0,
      msg: "OK",
      data: {
        active: true,
        today_checked_in: false,
        streak_days: 8,
        daily_credit: 100,
        today_credit: 100,
        total_credits: 800,
        week_progress: [false, false, false, false, false, false, false],
        activity_name: "Buddy应用",
        end_time: "2026-11-30 23:59:59",
        ...overrides,
      },
    }),
  };
}

/**
 * Route by URL: quota, read-only check-in status, and the OAuth-only claim.
 * Every test gets a deterministic answer for all three paths.
 */
function mockFetch(accounts, checkIn = {}) {
  fetchMock.mockImplementation((url) => {
    const href = String(url);
    if (href.includes("checkin-activity-status")) {
      if (checkIn === null) return Promise.resolve({ status: 404, ok: false, json: async () => ({}) });
      return Promise.resolve(checkInReply(checkIn));
    }
    if (href.includes("daily-checkin")) {
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ code: 0, msg: "OK" }) });
    }
    return Promise.resolve(reply(accounts));
  });
}

describe("CodeBuddy quota balance extraction", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("renders a fresh CN base plan as 0/500 even when Cycle* says 500/500", async () => {
    mockFetch([
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
    ]);

    const usage = await getCodeBuddyCnUsage(null, "test-key", {}, null);
    expect(usage.quotas.Monthly).toMatchObject({
      used: 0,
      total: 500,
      recurring: true,
      expired: false,
    });
    expect(usage.quotas["Bonus Pack 1"].expired).toBe(false);
    expect(usage.quotas["Bonus Pack 2"].expired).toBe(true);
    expect(usage.quotas["Bonus Pack 2"].exhausted).toBe(true);
    // Active pack is listed before the expired one.
    expect(Object.keys(usage.quotas).slice(0, 2)).toEqual(["Monthly", "Bonus Pack 1"]);
  });

  it("keeps a genuinely exhausted bonus pack at used == total", async () => {
    mockFetch([
      pack({
        CycleEndTime: "2026-09-28 00:45:45",
        ExpiredTime: "2026-09-28 00:39:01",
        Status: 3,
        CapacityUsedPrecise: "100",
        CapacityRemainPrecise: "0",
        CycleCapacityUsedPrecise: "100",
        CycleCapacityRemainPrecise: "0",
      }),
    ]);

    const usage = await getCodeBuddyCnUsage(null, "test-key", {}, null);
    expect(usage.quotas["Bonus Pack 1"]).toMatchObject({ used: 100, total: 100, expired: true, exhausted: true });
  });

  it("uses Cycle* only for real multi-cycle refills", async () => {
    mockFetch([
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
    ]);

    const usage = await getCodeBuddyCnUsage(null, "test-key", {}, null);
    expect(usage.quotas.Monthly).toMatchObject({ used: 40, total: 100 });
  });

  it("handles the intl Free Plan shape (DeductionEnd in 2046)", async () => {
    mockFetch([
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
    ]);

    const usage = await getCodeBuddyIntlUsage(null, "test-key", {}, null);
    expect(usage.quotas.Monthly).toMatchObject({ used: 0, total: 100, recurring: true });
  });

  it("claims the daily bonus before reading usage for OAuth connections", async () => {
    mockFetch([
      pack({ SubProductCode: "sp_tcaca_codebuddy_ide", CapacitySizePrecise: "500", CapacityRemainPrecise: "500" }),
    ]);

    await getCodeBuddyCnUsage("oauth-token-daily-claim", null, {}, null);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("daily-checkin"))).toBe(true);
    expect(urls.some((url) => url.includes("get-user-resource"))).toBe(true);
  });

  it("reads check-in status for API keys but never calls the OAuth-only claim", async () => {
    mockFetch([pack()], { today_checked_in: true, streak_days: 9 });

    const usage = await getCodeBuddyCnUsage(null, "api-key-only-connection", {}, null);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("daily-checkin"))).toBe(false);
    expect(urls.some((url) => url.includes("checkin-activity-status"))).toBe(true);
    expect(usage.checkIn).toMatchObject({
      active: true,
      todayCheckedIn: true,
      streakDays: 9,
      dailyCredit: 100,
    });
  });

  it("omits checkIn when the status endpoint is unavailable", async () => {
    mockFetch([pack()], null);
    const usage = await getCodeBuddyCnUsage(null, "api-key-no-status", {}, null);
    expect(usage.checkIn).toBeUndefined();
    expect(usage.quotas["Bonus Pack 1"]).toBeDefined();
  });
});
