import { getApiKeys } from "./db/repos/apiKeysRepo.js";
import { getApiKeyCostToday } from "./db/repos/budgetRepo.js";

/**
 * Evaluate per-key hard budget for an incoming API-key request.
 * Admin/cookie requests (no key) bypass. Returns blocked + fallback model.
 */
export async function checkApiKeyBudget(apiKey, settings) {
  if (!apiKey || settings?.budgetHardStop === false) return { blocked: false };
  const budgets = settings?.costBudgetByKey;
  if (!budgets || typeof budgets !== "object") return { blocked: false };

  let keyName = null;
  try {
    const keys = await getApiKeys();
    keyName = keys.find((item) => item.key === apiKey)?.name || null;
  } catch { /* key lookup is advisory */ }
  if (!keyName) return { blocked: false };

  // Never let a test budget lock the operator's primary keys. These are the
  // keys Hermes/agent tooling uses; add more via settings.budgetExemptKeys.
  const exempt = new Set(["me", "mael-terminal", ...(Array.isArray(settings?.budgetExemptKeys) ? settings.budgetExemptKeys : [])]);
  if (exempt.has(keyName)) return { blocked: false, keyName, exempt: true };

  const budget = Number(budgets[keyName] || budgets[apiKey] || 0);
  if (!Number.isFinite(budget) || budget <= 0) return { blocked: false };
  const spend = await getApiKeyCostToday(apiKey);
  if (!spend || spend.cost < budget) {
    return { blocked: false, keyName, budget, cost: spend?.cost || 0, percent: spend ? spend.cost / budget : 0 };
  }

  const fallbackByKey = settings?.budgetFallbackByKey?.[keyName];
  const fallbackModel = fallbackByKey || settings?.budgetFallbackModel || null;
  return {
    blocked: true,
    keyName,
    budget,
    cost: spend.cost,
    percent: spend.cost / budget,
    fallbackModel,
  };
}
