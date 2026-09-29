/**
 * backfill-cost.mjs — Fork MeAI (r35)
 *
 * Masalah: `cost` dihitung saat request disimpan (`saveRequestUsage`), jadi baris
 * yang tercatat SEBELUM provider/pattern pricing ditambahkan selamanya bernilai 0
 * (5.096 baris: opencode-go mimo-v2.5 / mimo-v2.6-flash / nemotron / muse).
 *
 * Skrip ini (satu kali, idempoten):
 *   1. backup DB dulu (SQLite backup API, aman walau service masih jalan)
 *   2. hitung ulang `cost` tiap baris usageHistory yang cost=0 tapi punya token
 *   3. bangun ulang usageDaily dari usageHistory (sumber kebenaran yang sama;
 *      sebelumnya jumlah request = 6282 = jumlah baris history, jadi tidak ada
 *      data yang hilang)
 *
 * Pakai: node scripts/backfill-cost.mjs [--dry-run]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const DB_PATH = path.join(os.homedir(), ".meai/db/data.sqlite");
const DRY = process.argv.includes("--dry-run");

const { getPricingForModel, calculateCostFromTokens } = await import(
  new URL("../open-sse/providers/pricing.js", import.meta.url).href
);

function costOf(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  const pricing = getPricingForModel(provider, model);
  if (!pricing) return 0;
  return calculateCostFromTokens(tokens, pricing);
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  try {
    const j = JSON.parse(v);
    return j == null ? fallback : j;
  } catch {
    return fallback;
  }
}

const db = new Database(DB_PATH, { readonly: DRY });
db.pragma("journal_mode = WAL");

if (!DRY) {
  const dir = path.dirname(DB_PATH);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `data-pre-backfill-${stamp}.sqlite`);
  await db.backup(dest);
  console.log(`backup -> ${dest} (${fs.statSync(dest).size} bytes)`);
}

const rows = db
  .prepare(
    `SELECT id, timestamp, provider, model, promptTokens, completionTokens, cost, tokens
       FROM usageHistory`
  )
  .all();

let updated = 0;
let stillZero = 0;
let delta = 0;
const dayMap = new Map(); // dateKey -> day object

function emptyDay() {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    byApiKey: ({}),
    byEndpoint: {},
  };
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
}

const stmts = DRY
  ? {}
  : {
      upd: db.prepare(`UPDATE usageHistory SET cost = ? WHERE id = ?`),
      delDaily: db.prepare(`DELETE FROM usageDaily`),
      putDaily: db.prepare(
        `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)
           ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`
      ),
    };

const run = db.transaction(() => {
  for (const r of rows) {
    const tokens = parseJson(r.tokens, {}) || {};
    let cost = r.cost || 0;

    if (!cost && (r.promptTokens > 0 || r.completionTokens > 0)) {
      cost = costOf(r.provider, r.model, tokens);
      if (cost > 0) {
        updated += 1;
        delta += cost;
        if (!DRY) stmts.upd.run(cost, r.id);
      } else {
        stillZero += 1;
      }
    }

    // rebuild harian dari baris yang (sudah) punya nilai cost final
    const d = r.timestamp ? new Date(r.timestamp) : new Date();
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let day = dayMap.get(dateKey);
    if (!day) {
      day = emptyDay();
      dayMap.set(dateKey, day);
    }

    const cached = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const vals = {
      requests: 1,
      promptTokens: r.promptTokens || 0,
      completionTokens: r.completionTokens || 0,
      cachedTokens: cached,
      cost,
    };
    day.requests += 1;
    day.promptTokens += vals.promptTokens;
    day.completionTokens += vals.completionTokens;
    day.cost += vals.cost;

    const provider = r.provider || "";
    addToCounter(day.byProvider, provider, vals);

    const rawModel = r.model || "unknown";
    const mkey = `${rawModel}|${provider}`;
    if (!day.byModel[mkey]) {
      day.byModel[mkey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider };
    }
    addToCounter(day.byModel, mkey, vals);

    if (r.connectionId) {
      const akey = `${rawModel}|${provider}|${r.connectionId}`;
      if (!day.byAccount[akey]) day.byAccount[akey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, connectionId: r.connectionId };
      addToCounter(day.byAccount, akey, vals);
    }

    const kkey = `${r.apiKey || "local-no-key"}|${rawModel}|${provider || "unknown"}`;
    if (!day.byApiKey[kkey]) day.byApiKey[kkey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
    addToCounter(day.byApiKey, kkey, vals);

    const ekey = `${r.endpoint || "Unknown"}|${rawModel}|${provider || "unknown"}`;
    if (!day.byEndpoint[ekey]) day.byEndpoint[ekey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
    addToCounter(day.byEndpoint, ekey, vals);
  }

  if (!DRY) {
    stmts.delDaily.run();
    for (const [dateKey, day] of dayMap) stmts.putDaily.run(dateKey, JSON.stringify(day));
  }
});

run();

console.log(
  JSON.stringify(
    {
      dryRun: DRY,
      historyRows: rows.length,
      costRowsRecomputed: updated,
      rowsStillZero: stillZero,
      costAddedUSD: Number(delta.toFixed(6)),
      dailyRows: dayMap.size,
      dailyRequests: [...dayMap.values()].reduce((s, d) => s + d.requests, 0),
      dailyCost: Number([...dayMap.values()].reduce((s, d) => s + d.cost, 0).toFixed(6)),
    },
    null,
    2
  )
);
db.close();
