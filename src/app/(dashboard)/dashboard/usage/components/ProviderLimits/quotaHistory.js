// Quota history + burn-rate forecast.
//
// The primary store is SQLite on the server (`quotaHistory`, written by the
// usage route; see /api/usage/[connectionId]/history). The localStorage
// helpers below are an offline fallback so the sparkline still works when the
// history endpoint is unreachable. Pure helpers are exported separately so
// they can be unit-tested without a DOM.

export const QUOTA_HISTORY_VERSION = 1;
export const QUOTA_HISTORY_LIMIT = 240;
export const QUOTA_SAMPLE_INTERVAL_MS = 60_000;
export const QUOTA_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const STORAGE_PREFIX = `meai.quotaHistory.v${QUOTA_HISTORY_VERSION}:`;
const SERVER_HISTORY_TTL_MS = 30_000;
const serverHistoryCache = new Map();

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanSamples(samples) {
  if (!Array.isArray(samples)) return [];
  return samples.filter(
    (sample) =>
      sample &&
      validNumber(sample.t) &&
      validNumber(sample.used) &&
      validNumber(sample.pct),
  );
}

/**
 * Append one sample unless the previous one is younger than the interval.
 * A drop in `used` means the provider reset the window: start a new series so
 * the old (higher) usage never produces a fake negative burn rate.
 */
export function appendQuotaSample(samples, sample, now = Date.now()) {
  const arr = cleanSamples(samples);
  if (!sample || !validNumber(sample.used) || !validNumber(sample.pct)) return arr;
  const last = arr[arr.length - 1];
  if (last && now - last.t < QUOTA_SAMPLE_INTERVAL_MS) return arr;
  if (last && sample.used < last.used - 0.01) {
    return [{ t: now, used: sample.used, pct: sample.pct }];
  }
  arr.push({ t: now, used: sample.used, pct: sample.pct });
  return arr.slice(-QUOTA_HISTORY_LIMIT);
}

/**
 * Estimate remaining days from the observed usage slope.
 * Returns null until there are two samples spanning at least 12 minutes.
 */
export function forecastQuota(quota, samples, now = Date.now()) {
  if (!quota || !Array.isArray(samples) || samples.length < 2) return null;
  const clean = cleanSamples(samples);
  if (clean.length < 2) return null;
  const first = clean[0];
  const last = clean[clean.length - 1];
  const elapsedHours = (last.t - first.t) / 3_600_000;
  if (!Number.isFinite(elapsedHours) || elapsedHours < 0.2) return null;
  const usedDelta = last.used - first.used;
  if (usedDelta < -0.01) return null; // reset in progress; wait for a fresh baseline

  const total = Number(quota.total) || 0;
  const used = Number(quota.used) || 0;
  const remaining = Math.max(0, total - used);
  const burnPerDay = usedDelta > 0 ? (usedDelta / elapsedHours) * 24 : 0;
  const daysLeft = burnPerDay > 0 ? remaining / burnPerDay : null;
  const resetMs = quota.resetAt ? new Date(quota.resetAt).getTime() : NaN;
  const resetDays = Number.isFinite(resetMs) ? (resetMs - now) / 86_400_000 : null;
  const resetWord = quota.recurring === false ? "expires" : "resets";

  let short = "flat";
  let tone = "text-text-muted";
  if (daysLeft != null) {
    if (resetDays != null && resetDays > 0 && resetDays < daysLeft) {
      short = `${resetWord} ${resetDays < 1 ? "<1d" : `in ${Math.ceil(resetDays)}d`}`;
      tone = "text-text-muted";
    } else if (daysLeft < 1) {
      short = `≈${Math.max(1, Math.round(daysLeft * 24))}h left`;
      tone = "text-red-600 dark:text-red-400";
    } else if (daysLeft < 7) {
      short = `≈${daysLeft.toFixed(1)}d left`;
      tone = "text-amber-600 dark:text-amber-400";
    } else {
      short = `≈${Math.floor(daysLeft)}d left`;
      tone = "text-emerald-600 dark:text-emerald-400";
    }
  }

  return {
    samples: clean.length,
    elapsedHours,
    burnPerDay,
    daysLeft,
    resetDays,
    short,
    tone,
    title:
      `Burn rate: ${burnPerDay.toFixed(2)} ${quota.unit || "units"}/day` +
      (daysLeft != null ? ` · sisa ≈ ${daysLeft.toFixed(1)} hari` : "") +
      ` · ${clean.length} sampel / ${elapsedHours.toFixed(1)} jam (riwayat tersimpan)`,
  };
}

/** SVG polyline points for remaining percentage (0-100), oldest → newest. */
export function sparklinePoints(samples, width = 100, height = 18) {
  const clean = cleanSamples(samples);
  if (clean.length < 2) return "";
  return clean
    .map((sample, index) => {
      const x = (index / (clean.length - 1)) * width;
      const pct = Math.max(0, Math.min(100, sample.pct));
      const y = height - (pct / 100) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function loadQuotaHistory(connectionId) {
  if (typeof window === "undefined" || !connectionId) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + connectionId);
    return raw ? pruneQuotaHistory(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * Fetch the cross-device history stored in SQLite. Cached for 30s so the
 * 5s quota refresh does not create 12 history requests per minute.
 * Throws on network failure; callers fall back to loadQuotaHistory().
 */
export async function fetchQuotaHistory(connectionId, { hours = 24, limit = 240, force = false } = {}) {
  if (typeof window === "undefined" || !connectionId) return {};
  const cached = serverHistoryCache.get(connectionId);
  if (!force && cached && Date.now() - cached.at < SERVER_HISTORY_TTL_MS) {
    return cached.series;
  }

  const query = new URLSearchParams({ hours: String(hours), limit: String(limit) });
  const response = await fetch(
    `/api/usage/${encodeURIComponent(connectionId)}/history?${query.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Quota history HTTP ${response.status}`);
  const payload = await response.json();
  const series = payload?.series && typeof payload.series === "object" ? payload.series : {};
  serverHistoryCache.set(connectionId, { at: Date.now(), series });
  return series;
}

export function invalidateQuotaHistoryCache(connectionId) {
  if (connectionId) serverHistoryCache.delete(connectionId);
  else serverHistoryCache.clear();
}

/**
 * Merge server history with the local offline fallback. Server rows win when
 * the minute bucket is identical; local rows fill gaps from before the
 * SQLite history existed. Keeps newest `QUOTA_HISTORY_LIMIT` samples.
 */
export function mergeQuotaHistory(serverHistory, localHistory) {
  const out = {};
  const names = new Set([
    ...Object.keys(serverHistory || {}),
    ...Object.keys(localHistory || {}),
  ]);
  for (const name of names) {
    const byTime = new Map();
    for (const sample of cleanSamples(localHistory?.[name])) byTime.set(sample.t, sample);
    for (const sample of cleanSamples(serverHistory?.[name])) byTime.set(sample.t, sample);
    const merged = [...byTime.values()].sort((a, b) => a.t - b.t);
    if (merged.length > 0) out[name] = merged.slice(-QUOTA_HISTORY_LIMIT);
  }
  return out;
}

/**
 * Record current quota rows and return the updated history map.
 * Call on every quota fetch; the interval guard keeps writes cheap.
 */
export function recordQuotaHistory(connectionId, quotas, now = Date.now()) {
  if (typeof window === "undefined" || !connectionId || !Array.isArray(quotas)) {
    return {};
  }
  const previous = loadQuotaHistory(connectionId);
  const next = {};
  for (const quota of quotas) {
    if (!quota?.name || !(Number(quota.total) > 0)) continue;
    if (quota.unlimited === true || quota.isCreditBalance === true) continue;
    const used = Number(quota.used) || 0;
    const total = Number(quota.total) || 0;
    const pct = total > 0 ? Math.max(0, Math.min(100, ((total - used) / total) * 100)) : 0;
    const series = appendQuotaSample(previous[quota.name], { used, pct }, now);
    next[quota.name] = series;
  }
  try {
    window.localStorage.setItem(STORAGE_PREFIX + connectionId, JSON.stringify(next));
  } catch {
    // Quota must never fail because localStorage is full/blocked.
  }
  return next;
}

export function pruneQuotaHistory(history, now = Date.now()) {
  if (!history || typeof history !== "object") return {};
  const out = {};
  for (const [name, samples] of Object.entries(history)) {
    const fresh = cleanSamples(samples).filter(
      (sample) => now - sample.t <= QUOTA_HISTORY_MAX_AGE_MS,
    );
    if (fresh.length > 0) out[name] = fresh;
  }
  return out;
}
