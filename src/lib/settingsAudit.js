import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SENSITIVE = /(password|secret|token|api[_-]?key|webhook|credential|cookie)/i;

/**
 * Append a compact settings-change audit record. Never stores values for
 * sensitive keys; only the key name and the value type are persisted.
 */
export function appendSettingsAudit(changes) {
  try {
    const changed = Object.keys(changes || {}).map((key) => ({
      key,
      type: Array.isArray(changes[key]) ? "array" : typeof changes[key],
      redacted: SENSITIVE.test(key),
    }));
    if (!changed.length) return;
    const dir = path.join(os.homedir(), ".meai");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "settings-audit.jsonl"), `${JSON.stringify({ ts: Date.now(), changed })}\n`);
  } catch {
    /* audit failure must never block a settings update */
  }
}

export function readSettingsAudit(limit = 20) {
  try {
    const file = path.join(os.homedir(), ".meai", "settings-audit.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-limit).reverse().map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
