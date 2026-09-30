import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf-8");

// ── Masking: console cookie (MiMo Token Plan) tidak boleh keluar ke browser ─
describe("mimoConsoleCookie masking (API providers)", () => {
  const listSrc = read("src/app/api/providers/route.js");
  const singleSrc = read("src/app/api/providers/[id]/route.js");

  it("GET list masks providerSpecificData.mimoConsoleCookie", () => {
    expect(listSrc).toContain('mimoConsoleCookie: "***"');
  });

  it("GET single masks the cookie", () => {
    expect(singleSrc).toContain('mimoConsoleCookie: "***"');
  });

  it("PUT keeps the stored cookie when it receives the mask placeholder", () => {
    expect(singleSrc).toMatch(/mimoConsoleCookie === "\*\*\*"/);
    expect(singleSrc).toMatch(/mimoConsoleCookie: \(existing\.providerSpecificData \|\| \{\}\)\.mimoConsoleCookie/);
  });
});

// ── Clear semantics: null = hapus field (modal mengirim null saat input kosong) ─
describe("providerSpecificData clear semantics (API providers)", () => {
  const singleSrc = read("src/app/api/providers/[id]/route.js");

  it("PUT filters null values out of the merged psd", () => {
    expect(singleSrc).toMatch(/\.filter\(\(\[, v\]\) => v !== null\)/);
  });

  it("modal sends explicit null when the quota-tracker inputs are emptied", () => {
    const modal = read("src/shared/components/EditConnectionModal.js");
    expect(modal).toMatch(/base\.mimoConsoleCookie = ck \|\| null/);
    expect(modal).toMatch(/base\.planTotalTokens = n > 0 \? n : null/);
  });
});

// ── Kebersihan: tak ada lagi jejak Token Saver di jalur runtime ─
describe("token saver fully removed", () => {
  const targets = [
    "open-sse/handlers/chatCore.js",
    "src/sse/handlers/chat.js",
    "src/shared/components/Sidebar.js",
  ];
  for (const t of targets) {
    it(`${t} tidak lagi menyebut fitur token saver`, () => {
      const src = read(t);
      expect(src).not.toMatch(/rtkEnabled|headroomEnabled|pxpipeEnabled|cavemanEnabled|ponytailEnabled|TOKEN_SAVER_HEADER/);
    });
  }

  it("settingsRepo hanya menyebut key lama di daftar REMOVE (bukan default aktif)", () => {
    const src = read("src/lib/db/repos/settingsRepo.js");
    // Semua penyebutan wajib berada di dalam REMOVED_TOKEN_SAVER_KEYS / stripRemovedKeys
    const stripped = src
      .replace(/const REMOVED_TOKEN_SAVER_KEYS = \[[\s\S]*?\];/, "")
      .replace(/function stripRemovedKeys[\s\S]*?\n}/, "");
    expect(stripped).not.toMatch(/rtkEnabled|headroomEnabled|pxpipeEnabled|cavemanEnabled|ponytailEnabled/);
  });

  it("direktori/halaman yang dihapus tetap tidak ada", () => {
    for (const p of [
      "src/app/(dashboard)/dashboard/token-saver",
      "src/app/api/headroom",
      "src/app/api/pxpipe",
      "open-sse/rtk",
    ]) {
      expect(fs.existsSync(path.join(ROOT, p))).toBe(false);
    }
  });
});
