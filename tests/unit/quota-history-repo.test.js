import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meai-quota-history-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("quotaHistory SQLite repo", () => {
  it("records one row per quota per minute and reads it back", async () => {
    const { recordQuotaSnapshot, getQuotaHistory } = await import(
      "@/lib/db/repos/quotaHistoryRepo.js"
    );
    const now = Math.floor(Date.now() / 60_000) * 60_000 + 1_000;
    const quotas = {
      Monthly: { used: 10, total: 100 },
      "Bonus Pack 1": { used: 0, total: 50 },
      Unlimited: { used: 0, total: 0, unlimited: true },
      Credit: { used: 0, total: 0, isCreditBalance: true },
    };

    expect(await recordQuotaSnapshot("conn-1", quotas, now)).toBe(2);
    // Same minute: primary key makes the second write idempotent.
    expect(await recordQuotaSnapshot("conn-1", quotas, now + 30_000)).toBe(0);

    const history = await getQuotaHistory("conn-1", { hours: 1, limit: 240 });
    expect(Object.keys(history).sort()).toEqual(["Bonus Pack 1", "Monthly"]);
    expect(history.Monthly).toHaveLength(1);
    expect(history.Monthly[0]).toMatchObject({ used: 10, total: 100, pct: 90 });
    expect(history["Bonus Pack 1"][0].pct).toBe(100);
  });

  it("downsamples long series and clears only the requested connection", async () => {
    const { recordQuotaSnapshot, getQuotaHistory, clearQuotaHistory } = await import(
      "@/lib/db/repos/quotaHistoryRepo.js"
    );
    const now = Date.now();
    for (let i = 9; i >= 0; i -= 1) {
      await recordQuotaSnapshot(
        "conn-a",
        { Monthly: { used: 10 - i, total: 100 } },
        now - i * 60_000,
      );
    }
    await recordQuotaSnapshot("conn-b", { Monthly: { used: 1, total: 10 } }, now);

    const history = await getQuotaHistory("conn-a", { hours: 1, limit: 3 });
    expect(history.Monthly).toHaveLength(3);
    expect(history.Monthly[0].t).toBeLessThan(history.Monthly[2].t);

    expect(await clearQuotaHistory("conn-a")).toBe(10);
    expect(await getQuotaHistory("conn-a", { hours: 1 })).toEqual({});
    expect((await getQuotaHistory("conn-b", { hours: 1 })).Monthly).toHaveLength(1);
  });

  it("ignores malformed rows without failing the caller", async () => {
    const { normalizeQuotaRows } = await import("@/lib/db/repos/quotaHistoryRepo.js");
    expect(normalizeQuotaRows({ Bad: { used: "x", total: 10 }, Zero: { used: 1, total: 0 } })).toEqual([]);
  });
});
