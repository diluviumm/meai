/**
 * Xiaomi MiMo Token Plan usage — quota tracker for the tp- subscription keys.
 *
 * The tp- key CANNOT read its own quota: every path on token-plan-*.xiaomimimo.com
 * answers 404 (verified live 2026-09-30) and Xiaomi has not shipped a key-based
 * usage endpoint yet (XiaomiMiMo/MiMo-Code#2495). The real plan quota only lives
 * behind the console session cookie on platform.xiaomimimo.com (verified live:
 * /api/v1/tokenPlan/usage answers 401 loginUrl without a session).
 *
 * So this fetcher has two paths:
 *   1. Console cookie (providerSpecificData.mimoConsoleCookie or env
 *      XIAOMI_MIMO_CONSOLE_COOKIE) → Xiaomi's own used/limit/percent + period end.
 *   2. No cookie → self-tracked fallback: tokens routed through this gateway in
 *      the current calendar month, from our own usageHistory table (zero-touch,
 *      always accurate for our own traffic). Optional providerSpecificData
 *      .planTotalTokens turns it into a real progress bar.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { getUsageHistory } from "@/lib/usageDb.js";

const CONSOLE_BASE = "https://platform.xiaomimimo.com/api/v1";

/** Read the console cookie from connection data or the environment. */
function resolveConsoleCookie(providerSpecificData) {
  const raw =
    providerSpecificData?.mimoConsoleCookie ||
    (typeof process !== "undefined" ? process.env.XIAOMI_MIMO_CONSOLE_COOKIE : "") ||
    "";
  return String(raw).trim();
}

/** Normalize a pasted `Cookie:` header or bare k=v; k=v pair into a Cookie header. */
function normalizeCookieHeader(raw) {
  let cookie = raw.trim();
  if (/^cookie:\s*/i.test(cookie)) cookie = cookie.replace(/^cookie:\s*/i, "");
  return cookie;
}

/**
 * Pull plan quota out of the console `tokenPlan/usage` payload.
 * The shape (per live capture, OmniRoute#14543):
 *   { data: { usage: { items: [ { plan_total_token: {used,limit,percent}, ... } ] },
 *             monthUsage: { items: [ { month_total_token: {...} } ] } } }
 * Parser is intentionally defensive — unknown shapes return null so the caller
 * can fall back instead of rendering wrong numbers.
 */
function parseConsoleUsage(payload) {
  const items = payload?.data?.usage?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const row = items[0] || {};
  const plan = row.plan_total_token || row.token_plan || null;
  if (!plan || typeof plan !== "object") return null;

  const used = Number(plan.used);
  const limit = Number(plan.limit);
  if (!Number.isFinite(used)) return null;

  const out = {
    used,
    total: Number.isFinite(limit) && limit > 0 ? limit : null,
    // percent on the console = percent consumed (matches 'used/limit' semantics)
    percent: Number.isFinite(Number(plan.percent)) ? Number(plan.percent) : null,
  };
  if (out.total && out.percent === null) {
    out.percent = Math.min(100, Math.round((used / out.total) * 100));
  }
  return out;
}

/** Parse `tokenPlan/detail` → ISO period end (when the plan renews/resets). */
function parseConsoleDetail(payload) {
  const d = payload?.data || payload || {};
  const end = d.currentPeriodEnd ?? d.periodEnd ?? d.expireTime ?? d.expiresAt;
  if (!end) return null;
  const n = Number(end);
  const ms = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : Date.parse(end);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** First day of the current calendar month (self-track period start, local tz). */
function monthStartIso(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** Next calendar-month boundary — reset hint for the self-tracked bar. */
function nextMonthStartIso(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

/**
 * Sum the tokens THIS gateway has routed for a connection in the current month.
 * Reads only our own usageHistory — no provider round-trip, no rate limit.
 */
async function selfTrackedUsage(connectionId) {
  const rows = await getUsageHistory({ provider: "xiaomi-tokenplan", startDate: monthStartIso() });
  let used = 0;
  let requests = 0;
  for (const r of rows) {
    if (connectionId && r.connectionId && r.connectionId !== connectionId) continue;
    const t = r.tokens || {};
    const total = Number(t.total_tokens) || (Number(t.prompt_tokens) || 0) + (Number(t.completion_tokens) || 0);
    if (Number.isFinite(total)) used += total;
    requests += 1;
  }
  return { used, requests };
}

/**
 * @param {string|null} apiKey - tp- subscription key (cannot read quota itself)
 * @param {object|null} providerSpecificData - { mimoConsoleCookie?, planTotalTokens?, region? }
 * @param {object|null} proxyOptions
 * @param {object|null} connection - full connection row (id used to scope self-tracking)
 * @returns {Promise<object>} usage payload in the standard { plan, quotas, ... } shape
 */
export async function getXiaomiTokenplanUsage(apiKey = null, providerSpecificData = null, proxyOptions = null, connection = null) {
  const connectionId = connection?.id || providerSpecificData?.connectionId || null;
  const planTotal = Number(providerSpecificData?.planTotalTokens) || 0;
  const cookie = normalizeCookieHeader(resolveConsoleCookie(providerSpecificData));

  // ── Path 1: console session cookie → Xiaomi's real quota ────────────────
  if (cookie) {
    try {
      const headers = { Cookie: cookie, Accept: "application/json", "User-Agent": "Mozilla/5.0" };
      const [usageRes, detailRes] = await Promise.all([
        proxyAwareFetch(`${CONSOLE_BASE}/tokenPlan/usage`, { headers, signal: AbortSignal.timeout(10000) }, proxyOptions),
        proxyAwareFetch(`${CONSOLE_BASE}/tokenPlan/detail`, { headers, signal: AbortSignal.timeout(10000) }, proxyOptions).catch(() => null),
      ]);

      if (usageRes.status === 401) {
        return {
          plan: "Token Plan",
          message:
            "Console session expired (cookies last ~24h). Re-copy the Cookie header from platform.xiaomimimo.com/#/console/balance and paste it into the connection's Console Cookie field.",
        };
      }
      if (!usageRes.ok) {
        return { plan: "Token Plan", message: `Xiaomi console responded ${usageRes.status} — falling back to local tracking.` };
      }

      const parsed = parseConsoleUsage(await usageRes.json().catch(() => null));
      if (parsed) {
        let resetAt = null;
        if (detailRes?.ok) resetAt = parseConsoleDetail(await detailRes.json().catch(() => null));

        const total = parsed.total ?? planTotal ?? 0;
        const usedPercent = parsed.percent ?? (total > 0 ? Math.min(100, Math.round((parsed.used / total) * 100)) : 0);
        return {
          plan: "Token Plan",
          source: "console",
          quotas: {
            "Plan quota": {
              used: parsed.used,
              total,
              // The card renders remaining% = (total-used)/total, so hand it a
              // remaining percentage for providers that only report consumed %.
              remainingPercentage: Math.max(0, Math.min(100, 100 - usedPercent)),
              resetAt,
              unlimited: !(total > 0),
              unit: "tokens",
            },
          },
        };
      }
      // Cookie accepted but shape unexpected → do not render wrong numbers; fall
      // through to self-tracking with an explicit note.
      return await selfTracked(connectionId, planTotal, "Console cookie accepted but the quota shape was unrecognized — showing local tracking instead.");
    } catch (e) {
      return await selfTracked(connectionId, planTotal, `Console lookup failed (${e?.message || "network error"}) — showing local tracking instead.`);
    }
  }

  // ── Path 2: zero-touch self-tracking from our own usageHistory ──────────
  return await selfTracked(connectionId, planTotal, null);
}

/** Build the self-tracked quota payload (optionally with an explanatory note). */
async function selfTracked(connectionId, planTotal, note) {
  const { used, requests } = await selfTrackedUsage(connectionId);
  const payload = {
    plan: "Token Plan",
    source: "self-tracked",
    quotas: {
      "Used this month (local)": {
        used,
        total: planTotal > 0 ? planTotal : 0,
        resetAt: planTotal > 0 ? nextMonthStartIso() : null,
        unlimited: !(planTotal > 0),
        unit: "tokens",
      },
    },
    meta: { requests, periodStart: monthStartIso() },
  };
  const hints = [];
  if (note) hints.push(note);
  if (planTotal <= 0) {
    hints.push(
      "Plan limit unknown: Xiaomi does not expose Token Plan quota to tp- keys. Paste the console Cookie (platform.xiaomimimo.com) or set the plan's total tokens on this connection to turn the local counter into a progress bar.",
    );
  }
  if (hints.length) payload.hint = hints.join(" ");
  return payload;
}
