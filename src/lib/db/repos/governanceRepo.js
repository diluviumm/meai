import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../driver.js";
import { getSettings } from "./settingsRepo.js";
import { getCombos } from "./combosRepo.js";
import { getInsights } from "./insightsRepo.js";
import { getPricing } from "./pricingRepo.js";
import { readSettingsAudit } from "../../../lib/settingsAudit.js";

const MEAI_DIR = path.join(os.homedir(), ".meai");
const DB_DIR = path.join(MEAI_DIR, "db");

function readJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(MEAI_DIR, name), "utf8")); } catch { return null; }
}

function flatten(value, prefix = "") {
  return Object.entries(value || {}).reduce((acc, [key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) Object.assign(acc, flatten(item, name));
    else acc[name] = item;
    return acc;
  }, {});
}

export async function getGovernance() {
  const [insights, settings, combos, connectionRows, db] = await Promise.all([
    getInsights({ hours: 24 }),
    getSettings(),
    getCombos(),
    getAdapter().then((adapter) => adapter.all(`SELECT id, provider, name, data FROM providerConnections`)),
    getAdapter(),
  ]);

  let version = "0.5.109";
  try { version = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version || version; } catch { /* fallback */ }

  const dbFiles = fs.existsSync(DB_DIR) ? fs.readdirSync(DB_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^data.*\.(sqlite|bak)/.test(entry.name))
    .map((entry) => {
      const file = path.join(DB_DIR, entry.name);
      const stat = fs.statSync(file);
      return { name: entry.name, bytes: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 8) : [];

  const snapshot = readJson("settings-snapshot.json");
  const currentFlat = flatten(settings);
  const snapshotFlat = snapshot ? flatten(snapshot.settings || snapshot) : null;
  const changedKeys = snapshotFlat ? Object.keys({ ...currentFlat, ...snapshotFlat }).filter((key) => JSON.stringify(currentFlat[key]) !== JSON.stringify(snapshotFlat[key])) : null;

  const circuit = (connectionRows || []).map((row) => {
    const health = insights.connections.find((item) => item.id === row.id);
    let data = {};
    try { data = JSON.parse(row.data || "{}"); } catch { data = {}; }
    return {
      id: row.id, name: row.name || health?.name || row.provider, provider: row.provider,
      rate429: health?.rate429 || 0, p95: health?.p95 || null,
      rateLimitedUntil: data.rateLimitedUntil || null, backoffLevel: data.backoffLevel || 0,
      state: data.rateLimitedUntil && new Date(data.rateLimitedUntil).getTime() > Date.now() ? "cooldown" : "closed",
    };
  }).filter((row) => row.rate429 > 0 || row.state === "cooldown");

  const rateAdvice = insights.connections
    .filter((row) => row.rate429 > 0 || row.p95 > 30_000)
    .map((row) => ({ name: row.name, rate429: row.rate429, p95: row.p95, advice: row.rate429 ? "Kurangi concurrency / tambah fallback" : "Turunkan timeout atau pilih provider lain" }));

  const timeoutAdvisor = insights.connections.map((row) => {
    const recommended = row.p95 == null ? 60_000 : Math.round(Math.max(15_000, Math.min(120_000, row.p95 * 1.5)));
    return { name: row.name, p95: row.p95, recommendedMs: recommended, reason: row.p95 == null ? "belum ada latency" : "p95 × 1.5, clamp 15–120s" };
  });

  const timeline = insights.timeline || [];
  const costs = timeline.map((row) => row.cost).filter((value) => value >= 0);
  const mean = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
  const variance = costs.length ? costs.reduce((a, b) => a + (b - mean) ** 2, 0) / costs.length : 0;
  const sd = Math.sqrt(variance);
  const confidence = costs.length < 4 ? "low" : sd / Math.max(mean, 0.000001) > 0.8 ? "medium" : "high";

  const usageCount = db.get(`SELECT COUNT(*) AS rows FROM usageHistory`)?.rows || 0;
  const quotaCount = db.get(`SELECT COUNT(*) AS rows FROM quotaHistory`)?.rows || 0;

  const pricing = await getPricing().catch(() => ({}));
  const flatPricing = {};
  for (const [provider, models] of Object.entries(pricing || {})) {
    if (!models || typeof models !== "object") continue;
    for (const [model, price] of Object.entries(models)) {
      if (price && typeof price === "object") flatPricing[`${provider}/${model}`] = { input: price.input, output: price.output, cached: price.cached };
    }
  }
  const pricingSnapshot = readJson("pricing-snapshot.json");
  const previousPricing = pricingSnapshot?.prices || null;
  const priceDiff = previousPricing ? {
    available: true,
    count: Object.keys(flatPricing).length,
    added: Object.keys(flatPricing).filter((key) => !previousPricing[key]),
    removed: Object.keys(previousPricing).filter((key) => !flatPricing[key]),
    changed: Object.keys(flatPricing).filter((key) => previousPricing[key] && JSON.stringify(flatPricing[key]) !== JSON.stringify(previousPricing[key])),
  } : { available: false, count: Object.keys(flatPricing).length, added: [], removed: [], changed: [] };


  return {
    generatedAt: new Date().toISOString(),
    selfCheck: {
      version,
      ok: Boolean(insights && settings),
      db: dbFiles.length > 0,
      usageRows: usageCount,
      quotaRows: quotaCount,
      connections: connectionRows.length,
    },
    backups: dbFiles,
    configDrift: {
      available: Boolean(snapshot),
      changedKeys,
      checkedAt: snapshot?.ts || null,
    },
    settingsAudit: readSettingsAudit(20),
    comboInventory: {
      count: combos.length,
      latestUpdatedAt: combos.reduce((latest, combo) => Math.max(latest, new Date(combo.updatedAt || 0).getTime()), 0) || null,
      names: combos.map((combo) => combo.name),
    },
    circuit,
    healthRouting: readJson("health-routing.json"),
    rateAdvice,
    timeoutAdvisor,
    deprecations: readJson("model-deprecations.json"),
    priceDiff,
    capabilityCoverage: (insights.providerMatrix || []).map((row) => ({ provider: row.provider, connections: 1, score: row.score })),
    budgetConfidence: {
      confidence,
      meanHourlyCost: Number(mean.toFixed(6)),
      standardDeviation: Number(sd.toFixed(6)),
      projectedLow: Number(Math.max(0, insights.pacing.projectedEndOfDay - sd * 24).toFixed(4)),
      projectedHigh: Number((insights.pacing.projectedEndOfDay + sd * 24).toFixed(4)),
      pacing: insights.pacing,
    },
    costAllocation: (insights.keys || []).map((row) => ({ name: row.name, cost: row.cost, requests: row.requests })),
    webhook: {
      configured: Boolean(settings.alertWebhookUrl || settings.alertWebhook),
      urlHost: (() => { try { return new URL(settings.alertWebhookUrl || settings.alertWebhook).host; } catch { return null; } })(),
    },
    performance: {
      dbBytes: insights.db?.bytes || null,
      quotaRows: quotaCount,
      usageRows: usageCount,
      timelineBuckets: timeline.length,
    },
  };
}

export async function snapshotSettings() {
  const settings = await getSettings();
  fs.mkdirSync(MEAI_DIR, { recursive: true });
  const payload = { ts: Date.now(), settings };
  fs.writeFileSync(path.join(MEAI_DIR, "settings-snapshot.json"), JSON.stringify(payload, null, 2));
  return { ok: true, keys: Object.keys(settings).length, ts: payload.ts };
}
