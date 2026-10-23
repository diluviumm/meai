import { getAdapter } from "../driver.js";

/** Sum today's cost for one raw API key, using a WITA (UTC+8) day boundary. */
export async function getApiKeyCostToday(apiKey) {
  if (!apiKey) return null;
  const db = await getAdapter();
  const shifted = new Date(Date.now() + 8 * 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  const start = new Date(shifted.getTime() - 8 * 3_600_000).toISOString();
  const row = db.get(
    `SELECT COALESCE(SUM(cost), 0) AS cost, COUNT(*) AS requests FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
    [apiKey, start],
  );
  return { cost: Number(row?.cost || 0), requests: Number(row?.requests || 0), start };
}
