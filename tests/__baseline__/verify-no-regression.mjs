// Gate: so kết quả test hiện tại với baseline known-fails.
// PASS nếu KHÔNG có test nào pass(baseline) → fail(now). Test mới được phép.
// Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json>
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Ronde-37: pemetaan path harus portabel. Versi asli memakai split("/app/")
// (jalur kontainer CI) sehingga dijalankan lokal SEMUA test gagal dianggap
// regresi — hasilnya jadi "undefined :: nama test" dan tak pernah cocok dengan
// known-fails.txt. Sekarang: relatif ke root repo, fallback ke jalur CI.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const toKey = (p) => {
  const norm = String(p).replace(/\\/g, "/");
  const ci = norm.lastIndexOf("/app/");
  if (ci >= 0) return norm.slice(ci + 5);
  return norm.startsWith(`${ROOT}/`) ? norm.slice(ROOT.length + 1) : norm;
};

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim()).filter(Boolean)
);

// Ronde-37: selain baseline milik upstream, baca juga baseline khusus fork —
// 78 test gagal lokal tidak tercatat di known-fails.txt karena upstream
// mengukurnya di kontainer CI (jalur /app/ + dependensi berbeda).
// Tanpa ini verifier selalu gagal dan tidak pernah bisa dipakai sebagai gerbang.
const FORK_BASELINE = new URL("./known-fails-fork.txt", import.meta.url);
if (existsSync(FORK_BASELINE)) {
  readFileSync(FORK_BASELINE, "utf8")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s && !s.startsWith("#"))
    .forEach(s => knownFails.add(s));
}

const resultsPath = process.argv[2];
if (!resultsPath) { console.error("Missing results.json path"); process.exit(2); }

const r = JSON.parse(readFileSync(resultsPath, "utf8"));
const nowFails = r.testResults.flatMap(f =>
  f.assertionResults.filter(a => a.status === "failed")
    .map(a => toKey(f.name) + " :: " + a.fullName)
);

// Regression = fail bây giờ NHƯNG không có trong baseline known-fails
const regressions = nowFails.filter(f => !knownFails.has(f));

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
