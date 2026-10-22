/**
 * CodeBuddy CN usage handler
 *
 * Scoped to the "codebuddy-cn" provider specifically — a future "codebuddy-intl"
 * variant would get its own handler/endpoint, so keep this CN-only.
 *
 * Quota lives behind a Tencent billing endpoint (POST, payload wrapped twice
 * under data.Response.Data). It mixes two credit types that must NOT be merged:
 *
 *  - Refill / base ("基础体验包"): a recurring allowance whose cycle resets long
 *    before the resource itself expires (CycleEndTime << DeductionEndTime). The
 *    live numbers live in the *Cycle* fields (e.g. CycleCapacityUsed 6.54 / 500)
 *    and resetAt is the next monthly refresh.
 *  - Bonus ("活动赠送包"): one-shot credits that run a single cycle and then
 *    expire for good (CycleEndTime == DeductionEndTime). Numbers live in the
 *    plain Capacity fields.
 *
 * We surface one quota row per package — a cadence label (Monthly/Weekly/Daily)
 * for refill packs, "Bonus Pack N" for bonus packs (soonest-expiring first).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDERS } from "../../providers/index.js";
import { U, parseResetTime } from "./shared.js";

const PROVIDER_ID = "codebuddy-cn";

const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;

/** Number coercion that treats "", null and undefined as "missing". */
function toNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Label a refill pack by its cycle length (Monthly is the common CodeBuddy case).
function refillCadence(acc) {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

/**
 * Bonus vs refill. Prefer the product code (explicit and stable), fall back to
 * the date-gap heuristic used by the original implementation.
 */
function isBonusPack(acc) {
  const sub = String(acc.SubProductCode || "").toLowerCase();
  if (sub.includes("bonus")) return true;
  // sp_tcaca_codebuddy_ide / sp_tcaca_codebuddyide = base subscription.
  if (sub.includes("codebuddy_ide") || sub.includes("codebuddyide")) return false;

  const cycleEnd = parseResetTime(acc.CycleEndTime);
  let deductionEnd = toNumber(acc.DeductionEndTime);
  if (deductionEnd !== null && deductionEnd < 1e12) deductionEnd *= 1000;
  if (!cycleEnd || deductionEnd === null) return false;
  return deductionEnd - new Date(cycleEnd).getTime() <= REFILL_GAP_MS;
}

/**
 * Read one coherent used/total pair.
 *
 * Multi-cycle refills use CycleCapacity*; base/bonus packs use Capacity*.
 * When the chosen pair disagrees with its Remain field (used > total, or
 * total - used != remain), trust `remain` and recompute used. That fixes the
 * "fresh 500-credit plan shows 500 used" regression without hiding genuinely
 * exhausted packs (used == total == size, remain == 0 stays coherent).
 */
function readBalance(acc, isBonus) {
  const totalCycles = toNumber(acc.TotalCycles) || 0;
  const remainCycles = toNumber(acc.RemainCycles) || 0;
  const useCycle = !isBonus && (totalCycles > 1 || remainCycles > 0);

  const used = useCycle
    ? toNumber(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed)
    : toNumber(acc.CapacityUsedPrecise, acc.CapacityUsed);
  const total = useCycle
    ? toNumber(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize)
    : toNumber(acc.CapacitySizePrecise, acc.CapacitySize);
  const remain = useCycle
    ? toNumber(acc.CycleCapacityRemainPrecise, acc.CycleCapacityRemain)
    : toNumber(acc.CapacityRemainPrecise, acc.CapacityRemain);

  const totalOut = Math.max(0, total ?? 0);
  let usedOut = Math.max(0, used ?? 0);

  if (totalOut > 0 && remain !== null && remain >= 0 && remain <= totalOut) {
    const coherentDelta = Math.abs(totalOut - usedOut - remain);
    if (usedOut > totalOut || coherentDelta > 0.01) {
      usedOut = totalOut - remain;
    }
  }
  usedOut = clamp(usedOut, 0, totalOut > 0 ? totalOut : Number.MAX_SAFE_INTEGER);

  return { used: usedOut, total: totalOut, remaining: totalOut > 0 ? Math.max(0, totalOut - usedOut) : 0 };
}

function isExpiredPack(acc, resetAt, isBonus) {
  if (toNumber(acc.Status) === 3) return true;
  const now = Date.now();
  const hardExpiry = parseResetTime(acc.ExpiredTime);
  if (hardExpiry && new Date(hardExpiry).getTime() <= now) return true;
  // Bonus packs are one-shot: CycleEndTime is their hard expiry.
  if (isBonus && resetAt && new Date(resetAt).getTime() <= now) return true;
  return false;
}

// ── Daily bonus claim (OAuth only) ─────────────────────────────────────────
// CodeBuddy grants 100 credits/day via POST /billing/meter/daily-checkin
// (1000 on day 7). The gateway rejects API keys on this path ("API key not
// allowed for this path or method"), so only OAuth access tokens may claim.
// One attempt per token per day per process: code 10001 = already claimed.
const lastCheckInDay = new Map();
const checkInStatusCache = new Map();
const CHECKIN_STATUS_TTL_MS = 5 * 60 * 1000;

/**
 * Read-only check-in activity status. This path accepts API keys on CN
 * (verified 2026-10-22) even though the claim path does not. It answers the
 * question the quota card could not: "is a check-in available today, and how
 * long is the streak?" A failed read is non-fatal and never blocks quota.
 */
async function fetchCheckInStatus(providerId, token, proxyOptions) {
  const cacheKey = `${providerId}:${String(token).slice(-12)}`;
  const cached = checkInStatusCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CHECKIN_STATUS_TTL_MS) {
    return cached.value;
  }

  const urls = U(providerId).checkInStatusUrls || [];
  for (const url of urls) {
    try {
      const response = await proxyAwareFetch(url, {
        method: "POST",
        headers: {
          ...(PROVIDERS[providerId]?.headers || {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(8000),
      }, proxyOptions);

      // 404/405 = this deployment uses the other path variant.
      if (response.status === 404 || response.status === 405) continue;
      if (!response.ok) break;

      const json = await response.json().catch(() => null);
      if (json?.code !== 0 || !json?.data) break;
      const d = json.data;
      const value = {
        active: d.active === true,
        todayCheckedIn: d.today_checked_in === true,
        streakDays: toNumber(d.streak_days) ?? 0,
        dailyCredit: toNumber(d.daily_credit) ?? 0,
        todayCredit: toNumber(d.today_credit) ?? 0,
        totalCredits: toNumber(d.total_credits) ?? 0,
        weekProgress: Array.isArray(d.week_progress) ? d.week_progress.map(Boolean) : [],
        activityName: d.activity_name || d.theme_name || "",
        endAt: parseResetTime(d.end_time),
      };
      checkInStatusCache.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch {
      break;
    }
  }

  // Cache failures too: a dead endpoint must not be retried on every 5s refresh.
  checkInStatusCache.set(cacheKey, { at: Date.now(), value: null });
  return null;
}

function checkInDayKey(providerId, token) {
  return `${providerId}:${String(token).slice(-12)}:${new Date().toISOString().slice(0, 10)}`;
}

async function maybeClaimDailyBonus(providerId, accessToken, proxyOptions) {
  if (!accessToken) return;
  const key = checkInDayKey(providerId, accessToken);
  if (lastCheckInDay.has(key)) return;

  const urls = U(providerId).checkInUrls || [];
  for (const url of urls) {
    try {
      const response = await proxyAwareFetch(url, {
        method: "POST",
        headers: {
          ...(PROVIDERS[providerId]?.headers || {}),
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(12000),
      }, proxyOptions);

      // 404/405 = this deployment uses the other path variant.
      if (response.status === 404 || response.status === 405) continue;

      const json = await response.json().catch(() => null);
      // code 0 = claimed, code 10001 = already claimed today (idempotent).
      // Any terminal answer also marks the day so a broken check-in cannot be
      // retried on every 5s quota refresh.
      const claimed = (response.ok || response.status === 400)
        && (json?.code === 0 || json?.code === 10001);
      lastCheckInDay.set(key, claimed);
      return;
    } catch {
      // Fail-open: a check-in failure must never block quota rendering.
      return;
    }
  }
}

async function getCodeBuddyUsage(providerId, accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  const token = accessToken || apiKey;
  if (!token) {
    return { message: `CodeBuddy (${providerId}) credential not available.` };
  }

  try {
    // Claim today's bonus before reading the balance so a fresh pack shows up
    // in the same response. API-key connections skip this (gateway 403).
    if (accessToken) await maybeClaimDailyBonus(providerId, accessToken, proxyOptions);

    // Read-only status is safe for API keys and runs in parallel with quota.
    const checkInPromise = fetchCheckInStatus(providerId, token, proxyOptions);

    const response = await proxyAwareFetch(U(providerId).url, {
      method: "POST",
      headers: {
        ...(PROVIDERS[providerId]?.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "CodeBuddy CN credential invalid or expired." };
    }
    if (!response.ok) {
      return { message: `CodeBuddy CN quota API error (${response.status}).` };
    }

    const json = await response.json();
    if (json?.code !== 0) {
      return { message: `CodeBuddy CN quota error: ${json?.msg || "unknown"}` };
    }

    const data = json?.data?.Response?.Data || {};
    const accounts = Array.isArray(data.Accounts) ? data.Accounts : [];
    if (accounts.length === 0) {
      return { message: "CodeBuddy CN connected. No credit package found." };
    }

    const packs = accounts.map((acc) => {
      const bonus = isBonusPack(acc);
      const balance = readBalance(acc, bonus);
      const resetAt = parseResetTime(acc.CycleEndTime);
      return {
        acc,
        bonus,
        ...balance,
        resetAt,
        resetMs: resetAt ? new Date(resetAt).getTime() : Number.POSITIVE_INFINITY,
        expired: isExpiredPack(acc, resetAt, bonus),
      };
    });

    const byExpiry = (a, b) => a.resetMs - b.resetMs;
    const refills = packs.filter((p) => !p.bonus).sort(byExpiry);
    // Active bonus packs first (soonest expiry), dead packs at the tail.
    const bonuses = packs
      .filter((p) => p.bonus)
      .sort((a, b) => Number(a.expired) - Number(b.expired) || byExpiry(a, b));

    const quotas = {};
    // Refill packs first: cadence-labelled, resetting at the next refresh.
    const seenRefill = {};
    refills.forEach(({ acc, used, total, resetAt }) => {
      const base = refillCadence(acc);
      seenRefill[base] = (seenRefill[base] || 0) + 1;
      const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
      quotas[name] = {
        used,
        total,
        resetAt,
        unlimited: false,
        // Recurring allowance: the CycleEndTime is the next refresh, not the
        // final expiry. The UI must show "Resets in", not "Expires in".
        recurring: true,
        expired: false,
      };
    });
    // Bonus packs: one-shot credits, resetAt is a hard expiry. Keep the flag so
    // the dashboard can collapse dead packs instead of crowding out live ones.
    bonuses.forEach(({ used, total, resetAt, expired }, i) => {
      quotas[`Bonus Pack ${i + 1}`] = {
        used,
        total,
        resetAt,
        unlimited: false,
        recurring: false,
        expired,
      };
    });

    const basePkg = refills[0]?.acc || accounts[0] || {};
    const plan = basePkg.PackageName || basePkg.SubProductName || "CodeBuddy";
    const checkIn = await checkInPromise;

    return { plan, quotas, ...(checkIn ? { checkIn } : {}) };
  } catch (error) {
    return { message: `CodeBuddy (${providerId}) error: ${error.message}` };
  }
}

export async function getCodeBuddyCnUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  return getCodeBuddyUsage(PROVIDER_ID, accessToken, apiKey, providerSpecificData, proxyOptions);
}

export async function getCodeBuddyIntlUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  return getCodeBuddyUsage("codebuddy-intl", accessToken, apiKey, providerSpecificData, proxyOptions);
}
