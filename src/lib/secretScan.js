import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOTS = [path.join(os.homedir(), ".meai")];
const SKIP = /(^|\.)(sqlite|db|wal|shm|key|pem|env)$/i;
const MAX_FILES = 120;
const MAX_BYTES = 1_500_000;
const PATTERNS = [
  { type: "openai-key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { type: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { type: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { type: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { type: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._-]{24,}\b/ },
];

function collect(dir, out) {
  if (out.length >= MAX_FILES) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= MAX_FILES || entry.name.startsWith(".") && entry.name !== ".meai") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { collect(full, out); continue; }
    if (SKIP.test(entry.name) || !/\.(json|md|txt|js|mjs|sh|ya?ml|conf)$/i.test(entry.name)) continue;
    try { if (fs.statSync(full).size <= MAX_BYTES) out.push(full); } catch { /* skip */ }
  }
}

/** Read-only scan; never returns matched secret values, only file/line/type. */
export function scanSecrets() {
  const files = [];
  for (const root of ROOTS) collect(root, files);
  const findings = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    text.split("\n").forEach((line, index) => {
      for (const pattern of PATTERNS) {
        if (pattern.re.test(line)) findings.push({ file: path.relative(os.homedir(), file), line: index + 1, type: pattern.type });
      }
    });
  }
  return { scanned: files.length, findings: findings.slice(0, 50), clean: findings.length === 0 };
}
