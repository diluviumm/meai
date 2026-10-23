import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_FILE = path.join(os.homedir(), ".meai", "health-routing.json");
let cache = { at: 0, state: null };

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function readState() {
  if (Date.now() - cache.at < 30_000) return cache.state;
  try { cache.state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { cache.state = null; }
  cache.at = Date.now();
  return cache.state;
}

export function readHealthRoutingState() {
  return readState();
}

/**
 * Stable, never-dropping health reorder for a canary slice only.
 * `percent` is 0–100; requests outside the slice keep the original order.
 */
export function reorderByHealth(models, scores, percent, canaryKey = "") {
  if (!Array.isArray(models) || models.length <= 1) return models;
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (safePercent <= 0) return models;
  if (safePercent < 100 && hash(String(canaryKey)) % 100 >= safePercent) return models;
  const scoreFor = (model) => {
    const provider = String(model).split("/")[0];
    const score = Number(scores?.[provider]);
    return Number.isFinite(score) ? score : 50;
  };
  return models
    .map((model, index) => ({ model, index, score: scoreFor(model) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.model);
}

export function healthRouteFor(models, canaryKey = "") {
  if (process.env.MEAI_HEALTH_ROUTING === "off") return models;
  const state = readState();
  if (!state || state.disabled) return models;
  return reorderByHealth(models, state.scores || {}, state.percent || 0, canaryKey);
}
