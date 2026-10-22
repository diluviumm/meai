import { getAdapter } from "../driver.js";

export const QUOTA_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const QUOTA_HISTORY_DEFAULT_HOURS = 24;
export const QUOTA_HISTORY_DEFAULT_LIMIT = 240;

let lastPruneAt = 0;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize the two shapes produced by usage handlers:
 *   { "Monthly": { used, total, ... }, ... }  or  [{ name, used, total }]
 * Only rows with a positive total and a finite used value are persisted.
 */
export function normalizeQuotaRows(quotas) {
  const list = Array.isArray(quotas)
    ? quotas
    : Object.entries(quotas || {}).map(([name, quota]) => ({ name, ...(quota || {}) }));

  return list
    .map((quota) => {
      const name = quota?.name;
      const used = finiteNumber(quota?.used);
      const total = finiteNumber(quota?.total);
      if (!name || used == null || total == null || total <= 0) return null;
      if (quota.unlimited === true || quota.isCreditBalance === true) return null;
      return {
        name,
        used: Math.max(0, used),
        total,
        pct: Math.max(0, Math.min(100, ((total - Math.max(0, used)) / total) * 100)),
      };
    })
    .filter(Boolean);
}

function bucketMinute(now) {
  return Math.floor(now / 60_000) * 60_000;
}

/**
 * Persist one sample per quota per minute. The primary key makes repeated
 * dashboard refreshes idempotent; no read-before-write race is possible.
 * Returns the number of rows actually inserted.
 */
export async function recordQuotaSnapshot(connectionId, quotas, now = Date.now()) {
  if (!connectionId) return 0;
  const rows = normalizeQuotaRows(quotas);
  if (rows.length === 0) return 0;

  const db = await getAdapter();
  const sampledAt = bucketMinute(now);
  let inserted = 0;

  db.transaction(() => {
    for (const row of rows) {
      const result = db.run(
        `INSERT OR IGNORE INTO quotaHistory(connectionId, quotaName, sampledAt, used, total, pct)
         VALUES(?, ?, ?, ?, ?, ?)`,
        [connectionId, row.name, sampledAt, row.used, row.total, row.pct],
      );
      if ((result?.changes ?? 0) > 0) inserted += 1;
    }

    // Hourly retention sweep; keeps the table bounded without deleting on every fetch.
    if (now - lastPruneAt >= 60 * 60 * 1000) {
      db.run(`DELETE FROM quotaHistory WHERE sampledAt < ?`, [now - QUOTA_HISTORY_RETENTION_MS]);
      lastPruneAt = now;
    }
  });

  return inserted;
}

function downsample(series, limit) {
  if (series.length <= limit) return series;
  if (limit <= 2) return [series[0], series[series.length - 1]];
  const out = [];
  const step = (series.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i += 1) {
    out.push(series[Math.round(i * step)]);
  }
  return out;
}

/**
 * Return history keyed by quota name, oldest → newest.
 * `hours` is clamped to 1..168 and `limit` to 2..500 per series.
 */
export async function getQuotaHistory(connectionId, { hours = QUOTA_HISTORY_DEFAULT_HOURS, limit = QUOTA_HISTORY_DEFAULT_LIMIT } = {}) {
  if (!connectionId) return {};
  const safeHours = Math.max(1, Math.min(168, Number(hours) || QUOTA_HISTORY_DEFAULT_HOURS));
  const safeLimit = Math.max(2, Math.min(500, Number(limit) || QUOTA_HISTORY_DEFAULT_LIMIT));
  const since = Date.now() - safeHours * 60 * 60 * 1000;
  const db = await getAdapter();
  const rows = db.all(
    `SELECT quotaName, sampledAt, used, total, pct
       FROM quotaHistory
      WHERE connectionId = ? AND sampledAt >= ?
      ORDER BY quotaName ASC, sampledAt ASC`,
    [connectionId, since],
  );

  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.quotaName]) grouped[row.quotaName] = [];
    grouped[row.quotaName].push({
      t: row.sampledAt,
      used: row.used,
      total: row.total,
      pct: row.pct,
    });
  }

  for (const [name, series] of Object.entries(grouped)) {
    grouped[name] = downsample(series, safeLimit);
  }
  return grouped;
}

export async function clearQuotaHistory(connectionId) {
  if (!connectionId) return 0;
  const db = await getAdapter();
  const result = db.run(`DELETE FROM quotaHistory WHERE connectionId = ?`, [connectionId]);
  return result?.changes ?? 0;
}
