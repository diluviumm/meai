import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../driver.js";
import { parseJson } from "../helpers/jsonCol.js";
import { getProviderConnections } from "./connectionsRepo.js";
import { getApiKeys } from "./apiKeysRepo.js";
import { getSettings } from "./settingsRepo.js";

const WINDOW_HOURS = 24;
const MASK = (value) => {
  const raw = String(value || "");
  if (!raw) return "local";
  if (raw.length <= 8) return `${raw.slice(0, 2)}…`;
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
};

function readStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "ok" || raw === "success") return 200;
  if (raw === "rate_limited" || raw === "ratelimit" || raw === "too_many_requests") return 429;
  if (raw === "error" || raw === "failed" || raw === "failure") return 500;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function latencyOf(meta) {
  const parsed = parseJson(meta, {});
  const raw = parsed?.latency;
  const value = typeof raw === "object" ? raw?.totalMs ?? raw?.total ?? raw?.ms : raw;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function emptyBucket() {
  return { requests: 0, success: 0, errors: 0, rate429: 0, latency: [], cost: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
}

function finishBucket(bucket) {
  const requests = bucket.requests || 0;
  const successRate = requests ? bucket.success / requests : 0;
  const rate429Rate = requests ? bucket.rate429 / requests : 0;
  const p95 = percentile(bucket.latency, 95);
  const latencyScore = p95 == null ? 1 : Math.max(0, 1 - Math.min(p95, 20_000) / 20_000);
  const score = requests
    ? Math.round(Math.max(0, Math.min(100, successRate * 70 + (1 - rate429Rate) * 15 + latencyScore * 15)))
    : null;
  return {
    requests,
    successRate: Number(successRate.toFixed(3)),
    rate429: bucket.rate429,
    errors: bucket.errors,
    p50: percentile(bucket.latency, 50),
    p95,
    cost: Number(bucket.cost.toFixed(6)),
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    cachedTokens: bucket.cachedTokens,
    cacheHitRate: bucket.promptTokens ? Number((bucket.cachedTokens / bucket.promptTokens).toFixed(3)) : null,
    score,
  };
}

function addBucket(map, key) {
  if (!map[key]) map[key] = emptyBucket();
  return map[key];
}

export async function getInsights({ hours = WINDOW_HOURS } = {}) {
  const windowHours = Math.max(1, Math.min(168, Number(hours) || WINDOW_HOURS));
  const db = await getAdapter();
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const rows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, status, cost, promptTokens, completionTokens, tokens, meta
     FROM usageHistory WHERE timestamp >= ? ORDER BY timestamp DESC`,
    [since],
  );

  const connections = await getProviderConnections();
  const connectionNames = Object.fromEntries(connections.map((c) => [c.id, c.name || c.provider || c.id.slice(0, 8)]));
  const apiKeys = await getApiKeys();
  const keyNames = Object.fromEntries(apiKeys.map((k) => [k.key, k.name || MASK(k.key)]));

  const byConnection = {};
  const byModel = {};
  const byKey = {};
  const byKeyHour = {};
  const hourly = {};
  const nowHour = Math.floor(Date.now() / 3_600_000);

  for (const row of rows) {
    const status = readStatus(row.status);
    const ok = status >= 200 && status < 400;
    const is429 = status === 429;
    const latency = latencyOf(row.meta);
    const tokens = parseJson(row.tokens, {});
    const cached = Number(tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0) || 0;
    const prompt = Number(row.promptTokens || 0);
    const completion = Number(row.completionTokens || 0);
    const cost = Number(row.cost || 0);
    const connectionId = row.connectionId || "unknown";
    const connName = connectionNames[connectionId] || `Account ${connectionId.slice(0, 8)}`;
    const modelKey = `${row.model || "unknown"} (${row.provider || "unknown"})`;
    const keyRaw = row.apiKey || "";
    const keyLabel = keyNames[keyRaw] || MASK(keyRaw);

    const c = addBucket(byConnection, connectionId);
    c.requests++; if (ok) c.success++; else c.errors++; if (is429) c.rate429++;
    if (latency != null) c.latency.push(latency);
    c.cost += cost; c.promptTokens += prompt; c.completionTokens += completion; c.cachedTokens += cached;

    const m = addBucket(byModel, modelKey);
    m.requests++; if (ok) m.success++; else m.errors++; if (is429) m.rate429++;
    if (latency != null) m.latency.push(latency);
    m.cost += cost; m.promptTokens += prompt; m.completionTokens += completion; m.cachedTokens += cached;

    const k = addBucket(byKey, keyLabel);
    k.requests++; if (ok) k.success++; else k.errors++; if (is429) k.rate429++;
    if (latency != null) k.latency.push(latency);
    k.cost += cost; k.promptTokens += prompt; k.completionTokens += completion; k.cachedTokens += cached;

    const hour = new Date(row.timestamp).getHours();
    if (!byKeyHour[keyLabel]) byKeyHour[keyLabel] = Array.from({ length: 24 }, () => ({ requests: 0, rate429: 0 }));
    byKeyHour[keyLabel][hour].requests++;
    if (is429) byKeyHour[keyLabel][hour].rate429++;

    const hourKey = Math.floor(new Date(row.timestamp).getTime() / 3_600_000);
    if (!hourly[hourKey]) hourly[hourKey] = 0;
    hourly[hourKey] += cost;
  }

  const connectionRows = Object.entries(byConnection)
    .map(([id, bucket]) => ({ id, name: connectionNames[id] || `Account ${id.slice(0, 8)}`, ...finishBucket(bucket) }))
    .sort((a, b) => (b.requests - a.requests) || (b.cost - a.cost));

  const leaderboard = Object.entries(byModel)
    .map(([model, bucket]) => {
      const stats = finishBucket(bucket);
      const totalTokens = stats.promptTokens + stats.completionTokens;
      return { model, ...stats, costPer1k: totalTokens ? Number(((stats.cost / totalTokens) * 1000).toFixed(6)) : null };
    })
    .sort((a, b) => b.cost - a.cost || b.requests - a.requests)
    .slice(0, 12);

  const currentHour = hourly[nowHour] || 0;
  const previousHours = Object.entries(hourly).filter(([h]) => Number(h) < nowHour && Number(h) >= nowHour - 6).map(([, v]) => v);
  const baseline = previousHours.length ? previousHours.reduce((a, b) => a + b, 0) / previousHours.length : 0;
  const anomaly = {
    currentHourCost: Number(currentHour.toFixed(6)),
    baselineHourlyCost: Number(baseline.toFixed(6)),
    ratio: baseline > 0 ? Number((currentHour / baseline).toFixed(2)) : null,
    flagged: baseline > 0 && currentHour > baseline * 1.8,
  };

  const quotaStats = db.get(
    `SELECT COUNT(*) AS rows, MIN(sampledAt) AS oldest, MAX(sampledAt) AS newest FROM quotaHistory`,
  ) || {};

  const readStatusFile = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".meai", name), "utf8")); } catch { return null; }
  };

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    totals: {
      requests: rows.length,
      successRate: rows.length ? Number((rows.filter((r) => { const s = readStatus(r.status); return s >= 200 && s < 400; }).length / rows.length).toFixed(3)) : 0,
      cacheHitRate: rows.reduce((sum, r) => sum + Number(parseJson(r.tokens, {})?.cached_tokens || 0), 0) /
        Math.max(1, rows.reduce((sum, r) => sum + Number(r.promptTokens || 0), 0)),
    },
    connections: connectionRows,
    leaderboard,
    keys: Object.entries(byKey).map(([name, bucket]) => ({ name, ...finishBucket(bucket) })).sort((a, b) => b.requests - a.requests),
    heatmap: Object.entries(byKeyHour).map(([name, cells]) => ({ name, cells })),
    anomaly,
    quotaHistory: { rows: quotaStats.rows || 0, oldest: quotaStats.oldest || null, newest: quotaStats.newest || null },
    ops: {
      compaction: readStatusFile("quota-compaction.json"),
      restoreDrill: readStatusFile("restore-drill.json"),
      catalogDiff: readStatusFile("catalog-diff.json"),
      a11y: readStatusFile("a11y-report.json"),
    },
    settings: {
      quietHours: (await getSettings()).alertQuietHours || null,
    },
  };
}
