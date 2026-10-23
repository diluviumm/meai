import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../driver.js";
import { parseJson } from "../helpers/jsonCol.js";
import { getProviderConnections } from "./connectionsRepo.js";
import { getApiKeys } from "./apiKeysRepo.js";
import { getSettings } from "./settingsRepo.js";
import { getUsageStats } from "./usageRepo.js";
import { getPricingForModel } from "./pricingRepo.js";

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

export async function getInsights({ hours = WINDOW_HOURS, apiKey = null } = {}) {
  const windowHours = Math.max(1, Math.min(168, Number(hours) || WINDOW_HOURS));
  const db = await getAdapter();
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const keyClause = apiKey ? " AND apiKey = ?" : "";
  const keyArgs = apiKey ? [apiKey] : [];
  const rows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, status, cost, promptTokens, completionTokens, tokens, meta
     FROM usageHistory WHERE timestamp >= ?${keyClause} ORDER BY timestamp DESC`,
    [since, ...keyArgs],
  );
  const longRows = db.all(
    `SELECT timestamp, provider, model, connectionId, apiKey, status, cost, promptTokens, completionTokens, tokens, meta
     FROM usageHistory WHERE timestamp >= ?${keyClause} ORDER BY timestamp DESC`,
    [new Date(Date.now() - 28 * 86_400_000).toISOString(), ...keyArgs],
  );

  const connections = await getProviderConnections();
  const connectionNames = Object.fromEntries(connections.map((c) => [c.id, c.name || c.provider || c.id.slice(0, 8)]));
  const apiKeys = await getApiKeys();
  const keyNames = Object.fromEntries(apiKeys.map((k) => [k.key, k.name || MASK(k.key)]));

  const byConnection = {};
  const byModel = {};
  const byKey = {};
  const byKeyHour = {};
  const byKeyHourly = {};
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
    if (!byKeyHourly[keyLabel]) byKeyHourly[keyLabel] = {};
    byKeyHourly[keyLabel][hourKey] = (byKeyHourly[keyLabel][hourKey] || 0) + cost;
  }

  const connectionRows = Object.entries(byConnection)
    .map(([id, bucket]) => {
      const connection = connections.find((c) => c.id === id);
      return { id, name: connectionNames[id] || `Account ${id.slice(0, 8)}`, provider: connection?.provider || "unknown", ...finishBucket(bucket) };
    })
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

  const settings = await getSettings();
  const today = await getUsageStats("today").catch(() => null);
  const now = new Date();
  const elapsedFraction = Math.max(0.01, (now.getHours() * 60 + now.getMinutes()) / 1440);
  const dailyBudget = Number(settings.costBudgetDaily) || 0;
  const pacing = {
    spendToday: Number(today?.totalCost || 0),
    budget: dailyBudget,
    elapsedFraction: Number(elapsedFraction.toFixed(3)),
    projectedEndOfDay: Number(((today?.totalCost || 0) / elapsedFraction).toFixed(4)),
    status: !dailyBudget ? "no-budget" : (today?.totalCost || 0) > dailyBudget ? "over" : ((today?.totalCost || 0) / elapsedFraction) > dailyBudget ? "pacing-over" : "ok",
  };

  const fairnessValues = connectionRows.map((row) => row.requests).filter((n) => n > 0);
  const mean = fairnessValues.length ? fairnessValues.reduce((a, b) => a + b, 0) / fairnessValues.length : 0;
  const variance = fairnessValues.length ? fairnessValues.reduce((a, b) => a + (b - mean) ** 2, 0) / fairnessValues.length : 0;
  const fairness = {
    score: mean ? Math.round(Math.max(0, 100 - (Math.sqrt(variance) / mean) * 100)) : null,
    spread: mean ? Number((Math.sqrt(variance) / mean).toFixed(2)) : null,
    connections: connectionRows.map((row) => ({ id: row.id, name: row.name, requests: row.requests })),
  };

  const quotaRows = db.all(
    `SELECT connectionId, quotaName, sampledAt, used, total, pct
       FROM quotaHistory ORDER BY sampledAt DESC LIMIT 4000`,
  );
  const quotaSeries = {};
  for (const row of quotaRows) {
    const key = `${row.connectionId}|${row.quotaName}`;
    if (!quotaSeries[key]) quotaSeries[key] = [];
    if (quotaSeries[key].length < 2 && !quotaSeries[key].some((r) => r.sampledAt === row.sampledAt)) quotaSeries[key].push(row);
  }
  const expiry = Object.values(quotaSeries).map((series) => {
    const [latest, previous] = series;
    if (!latest || latest.total <= 0 || latest.pct <= 0) return null;
    const hours = previous ? (latest.sampledAt - previous.sampledAt) / 3_600_000 : 0;
    const usedPerHour = previous && hours > 0 ? (latest.used - previous.used) / hours : 0;
    const daysLeft = usedPerHour > 0 ? (latest.total - latest.used) / usedPerHour / 24 : null;
    if (daysLeft == null || daysLeft > 30) return null;
    return {
      connectionId: latest.connectionId,
      name: connectionNames[latest.connectionId] || `Account ${latest.connectionId.slice(0, 8)}`,
      quotaName: latest.quotaName,
      pct: Number(latest.pct.toFixed(1)),
      daysLeft: Number(daysLeft.toFixed(1)),
      flagged: daysLeft <= 3,
    };
  }).filter(Boolean).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 8);

  const perKeyAnomaly = Object.entries(byKeyHourly).map(([name, buckets]) => {
    const current = buckets[nowHour] || 0;
    const previous = Object.entries(buckets).filter(([h]) => Number(h) < nowHour && Number(h) >= nowHour - 6).map(([, v]) => v);
    const base = previous.length ? previous.reduce((a, b) => a + b, 0) / previous.length : 0;
    return { name, current, baseline: Number(base.toFixed(6)), ratio: base > 0 ? Number((current / base).toFixed(2)) : null, flagged: base > 0 && current > base * 1.8 };
  }).filter((row) => row.flagged || row.ratio >= 1.5).sort((a, b) => (b.ratio || 0) - (a.ratio || 0)).slice(0, 8);

  const timeline = Array.from({ length: 24 }, () => ({ requests: 0, success: 0, cost: 0, latency: [] }));
  for (const row of rows) {
    const hour = new Date(row.timestamp).getHours();
    const item = timeline[hour];
    item.requests += 1;
    if (readStatus(row.status) >= 200 && readStatus(row.status) < 400) item.success += 1;
    item.cost += Number(row.cost || 0);
    const latency = latencyOf(row.meta);
    if (latency != null) item.latency.push(latency);
  }
  const timelineRows = timeline.map((item, hour) => ({ hour, requests: item.requests, successRate: item.requests ? Number((item.success / item.requests).toFixed(3)) : null, cost: Number(item.cost.toFixed(6)), p95: percentile(item.latency, 95) }));

  const weekdayBuckets = Array.from({ length: 7 }, () => ({ cost: 0, requests: 0, days: new Set() }));
  for (const row of longRows) {
    const day = new Date(row.timestamp).getDay();
    weekdayBuckets[day].cost += Number(row.cost || 0);
    weekdayBuckets[day].requests += 1;
    weekdayBuckets[day].days.add(new Date(row.timestamp).toISOString().slice(0, 10));
  }
  const weekdayForecast = weekdayBuckets.map((bucket, day) => ({
    day,
    avgCost: bucket.days.size ? Number((bucket.cost / bucket.days.size).toFixed(4)) : null,
    avgRequests: bucket.days.size ? Math.round(bucket.requests / bucket.days.size) : 0,
    days: bucket.days.size,
  }));

  const cacheByModel = {};
  for (const row of rows) {
    const key = `${row.model || "unknown"} (${row.provider || "unknown"})`;
    const tokens = parseJson(row.tokens, {});
    const cached = Number(tokens?.cached_tokens || 0) || 0;
    const prompt = Number(row.promptTokens || 0);
    if (!cacheByModel[key]) cacheByModel[key] = { prompt: 0, cached: 0, requests: 0 };
    cacheByModel[key].prompt += prompt;
    cacheByModel[key].cached += cached;
    cacheByModel[key].requests += 1;
  }
  const cacheHygiene = Object.entries(cacheByModel).map(([model, item]) => ({
    model,
    requests: item.requests,
    cacheRate: item.prompt ? Number((item.cached / item.prompt).toFixed(3)) : null,
    promptTokens: item.prompt,
    advice: !item.prompt ? "tanpa prompt token" : item.cached / item.prompt < 0.2 ? "prefix tidak stabil / cache dingin" : "cache sehat",
  })).sort((a, b) => (a.cacheRate ?? 1) - (b.cacheRate ?? 1)).slice(0, 8);

  const latencyGroups = {};
  for (const row of rows) {
    const key = `${row.model || "unknown"} · ${row.connectionId || "unknown"}`;
    if (!latencyGroups[key]) latencyGroups[key] = Array.from({ length: 24 }, () => ({ requests: 0, latency: [], rate429: 0 }));
    const hour = new Date(row.timestamp).getHours();
    const cell = latencyGroups[key][hour];
    cell.requests += 1;
    if (readStatus(row.status) === 429) cell.rate429 += 1;
    const latency = latencyOf(row.meta);
    if (latency != null) cell.latency.push(latency);
  }
  const latencyHeatmap = Object.entries(latencyGroups).map(([key, cells]) => ({
    key,
    cells: cells.map((cell) => ({ requests: cell.requests, p95: percentile(cell.latency, 95), rate429: cell.rate429 })),
  })).sort((a, b) => b.cells.reduce((sum, cell) => sum + cell.requests, 0) - a.cells.reduce((sum, cell) => sum + cell.requests, 0)).slice(0, 6);

  const providerTimelineMap = {};
  for (const row of rows) {
    const provider = row.provider || "unknown";
    if (!providerTimelineMap[provider]) providerTimelineMap[provider] = Array.from({ length: 24 }, () => ({ requests: 0, cost: 0, rate429: 0 }));
    const cell = providerTimelineMap[provider][new Date(row.timestamp).getHours()];
    cell.requests += 1;
    cell.cost += Number(row.cost || 0);
    if (readStatus(row.status) === 429) cell.rate429 += 1;
  }
  const providerTimeline = Object.entries(providerTimelineMap).map(([provider, cells]) => ({ provider, cells })).sort((a, b) => b.cells.reduce((sum, cell) => sum + cell.requests, 0) - a.cells.reduce((sum, cell) => sum + cell.requests, 0)).slice(0, 8);

  const sloP95 = Number(settings.sloP95Ms) || 30_000;
  const sloSuccess = Number(settings.sloSuccessRate) || 0.99;
  const sloIncidents = [];
  let incident = null;
  for (const row of timelineRows) {
    const breach = (row.p95 != null && row.p95 > sloP95) || (row.successRate != null && row.successRate < sloSuccess);
    if (breach && !incident) incident = { startHour: row.hour, endHour: row.hour, maxP95: row.p95 || 0, requests: row.requests };
    if (breach && incident) { incident.endHour = row.hour; incident.maxP95 = Math.max(incident.maxP95, row.p95 || 0); incident.requests += row.requests; }
    if (!breach && incident) { sloIncidents.push(incident); incident = null; }
  }
  if (incident) sloIncidents.push(incident);
  const sloIncidentSummary = sloIncidents.slice(-5).map((item) => ({ ...item, durationHours: item.endHour - item.startHour + 1 }));


  const resetSeries = {};
  for (const row of quotaRows) {
    const key = `${row.connectionId}|${row.quotaName}`;
    if (!resetSeries[key]) resetSeries[key] = [];
    resetSeries[key].push(row);
  }
  const resetCalendar = Object.entries(resetSeries).map(([key, series]) => {
    const ordered = [...series].sort((a, b) => a.sampledAt - b.sampledAt);
    const resets = [];
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].used < ordered[i - 1].used) resets.push(ordered[i].sampledAt);
    }
    if (resets.length < 2) return null;
    const intervals = resets.slice(1).map((ts, index) => (ts - resets[index]) / 86_400_000).filter((days) => days > 0);
    const intervalDays = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
    if (!intervalDays) return null;
    const [connectionId, quotaName] = key.split("|");
    return {
      connectionId,
      name: connectionNames[connectionId] || `Account ${connectionId.slice(0, 8)}`,
      quotaName,
      lastReset: resets[resets.length - 1],
      intervalDays: Number(intervalDays.toFixed(1)),
      nextResetAt: Math.round(resets[resets.length - 1] + intervalDays * 86_400_000),
      daysUntil: Number(((resets[resets.length - 1] + intervalDays * 86_400_000 - Date.now()) / 86_400_000).toFixed(1)),
    };
  }).filter(Boolean).sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 8);

  const keyAges = apiKeys.map((key) => {
    const created = new Date(key.createdAt).getTime();
    const days = Number.isFinite(created) ? Math.floor((Date.now() - created) / 86_400_000) : null;
    return { id: key.id, name: key.name || MASK(key.key), active: Boolean(key.isActive), createdAt: key.createdAt, days, stale: days != null && days > 90 };
  }).sort((a, b) => (b.days || 0) - (a.days || 0));

  const sloP95Ms = Number(settings.sloP95Ms) || 30_000;
  const sloSuccessRate = Number(settings.sloSuccessRate) || 0.99;
  const slo = {
    p95Ms: sloP95Ms,
    successRate: sloSuccessRate,
    breaches: connectionRows.filter((row) => (row.p95 != null && row.p95 > sloP95Ms) || row.successRate < sloSuccessRate).map((row) => ({ id: row.id, name: row.name, p95: row.p95, successRate: row.successRate })),
  };

  const pricingAudit = [];
  for (const row of leaderboard.slice(0, 8)) {
    const match = row.model.match(/^(.*?)\s+\(([^)]*)\)$/);
    if (!match) continue;
    const [, rawModel, provider] = match;
    const pricing = await getPricingForModel(provider, rawModel).catch(() => null);
    if (!pricing) continue;
    const expected = (row.promptTokens / 1e6) * (Number(pricing.input) || 0) + (row.completionTokens / 1e6) * (Number(pricing.output) || 0);
    if (expected <= 0) continue;
    const deltaPct = ((row.cost - expected) / expected) * 100;
    if (Math.abs(deltaPct) >= 20) pricingAudit.push({ model: row.model, provider, actual: row.cost, expected: Number(expected.toFixed(6)), deltaPct: Number(deltaPct.toFixed(1)) });
  }

  let dbBytes = null;
  try {
    const pages = db.get(`PRAGMA page_count`);
    const pageSize = db.get(`PRAGMA page_size`);
    dbBytes = (Number(pages?.page_count) || 0) * (Number(pageSize?.page_size) || 0);
  } catch { /* adapter may not expose PRAGMA rows */ }

  const readStatusFile = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".meai", name), "utf8")); } catch { return null; }
  };

  const notifications = [];
  if (anomaly.flagged) notifications.push({ level: "warning", text: `Burn ${anomaly.ratio}× baseline` });
  for (const row of expiry.filter((r) => r.flagged)) notifications.push({ level: "warning", text: `${row.name} ${row.quotaName}: ${row.daysLeft}d left` });
  const a11y = readStatusFile("a11y-report.json");
  if (a11y?.critical > 0) notifications.push({ level: "error", text: `${a11y.critical} WCAG critical` });
  const restore = readStatusFile("restore-drill.json");
  if (restore && !restore.ok) notifications.push({ level: "error", text: "Restore drill failed" });
  const catalog = readStatusFile("catalog-diff.json");
  if (catalog && (catalog.added?.length || catalog.removed?.length)) notifications.push({ level: "info", text: `Catalog +${catalog.added?.length || 0}/−${catalog.removed?.length || 0}` });

  const cacheTtlAdvisor = leaderboard
    .filter((row) => row.requests >= 10)
    .map((row) => {
      const rate = row.cacheHitRate;
      const recommendation = rate == null
        ? "Belum ada token prompt untuk dinilai"
        : rate < 0.2
          ? "Naikkan cache TTL / stabilkan prefix prompt"
          : rate < 0.5
            ? "Evaluasi urutan pesan; pertahankan prefix yang sama"
            : "Pertahankan TTL saat ini";
      return { model: row.model, requests: row.requests, cacheHitRate: rate, recommendation };
    })
    .sort((a, b) => (a.cacheHitRate ?? 1) - (b.cacheHitRate ?? 1))
    .slice(0, 8);

  const quotaStats = db.get(
    `SELECT COUNT(*) AS rows, MIN(sampledAt) AS oldest, MAX(sampledAt) AS newest FROM quotaHistory`,
  ) || {};

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
    pacing,
    fairness,
    expiry,
    perKeyAnomaly,
    slo,
    pricingAudit,
    notifications,
    db: { bytes: dbBytes },
    providerMatrix: connectionRows.map((row) => ({ provider: row.provider, name: row.name, score: row.score, requests: row.requests, rate429: row.rate429, p95: row.p95 })),
    timeline: timelineRows,
    weekdayForecast,
    cacheHygiene,
    cacheTtlAdvisor,
    latencyHeatmap,
    providerTimeline,
    sloIncidents: sloIncidentSummary,
    resetCalendar,
    keyAges,
    quotaHistory: { rows: quotaStats.rows || 0, oldest: quotaStats.oldest || null, newest: quotaStats.newest || null },
    ops: {
      compaction: readStatusFile("quota-compaction.json"),
      restoreDrill: readStatusFile("restore-drill.json"),
      catalogDiff: readStatusFile("catalog-diff.json"),
      a11y: readStatusFile("a11y-report.json"),
    },
    settings: {
      quietHours: settings.alertQuietHours || null,
    },
  };
}
