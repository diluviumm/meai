import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Ronde-36: SANDBOX. Tanpa ini test menulis ke ~/.meai/db/data.sqlite
    // (providerConnections tercemar 2 -> 435 baris pada 29 Sep 2026).
    env: { DATA_DIR: resolve(__dirname, ".vitest-data") },
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Ronde-41: default 5s terlalu ketat utk import dinamis module besar saat
    // mesin multi-tenant (browser agent + cron embed jalan bersamaan) — import
    // yang biasanya 0.8-2.2s bisa melompat >5s → STACK_TRACE_ERROR/timeout palsu.
    testTimeout: 15000,
    hookTimeout: 15000,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
