import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os → homedir mengarah ke temp dir NYATA (utk file SQLite sungguhan);
// catatan: factory di-hoist vitest, binding testHome sudah terisi saat factory
// dievaluasi per import (dipakai lewat closure variabel yang diisi ulang tiap run).
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => testHome) },
  homedir: vi.fn(() => testHome),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// Shared mock db instance
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 sebagai class agar `new Database(...)` jalan.
// Route kini memakai `require("better-sqlite3")` (a6c764d7, CJS) — jadi class
// juga membawa `.default` dirinya sendiri: shape {default} (ESM import) DAN
// shape class-langsung (require) sama-sama menghasilkan class yang bisa di-new.
const MockDatabaseClass = class MockDatabase {
  constructor() {
    if (mockDbInstance.__throwOnConstruct) {
      throw new Error("SQLITE_CANTOPEN");
    }
    return mockDbInstance;
  }
};
MockDatabaseClass.default = MockDatabaseClass;
vi.mock("better-sqlite3", () => MockDatabaseClass);

// ── Ronde-45: home NYATA utk temp dir + util tulis state.vscdb sungguhan ──
// Route memakai require("better-sqlite3") yang di vitest ter-resolve sebagai
// native require lexikal — vi.mock tidak menang. Uji end-to-end dengan file
// SQLite asli (node:sqlite) lebih kuat daripada mock module.
// Hindari import("node:os") — terkena vi.mock("os") di bawah; pakai env TMPDIR
// (Linux/container selalu menyediakannya; fallback /tmp).
const fsNode = await import("node:fs");
const testHome = fsNode.mkdtempSync(
  (process.env.TMPDIR || "/tmp").replace(/\/$/, "") + "/meai-cursor-",
);
const { mkdirSync, writeFileSync, rmSync } = fsNode;
const cursorDbPath =
  testHome + "/Library/Application Support/Cursor/User/globalStorage/state.vscdb";

// Tulis state.vscdb NYATA berisi baris itemTable (atau file rusak utk kasus gagal).
async function writeCursorDb(rows, { corrupt = false } = {}) {
  mkdirSync(testHome + "/Library/Application Support/Cursor/User/globalStorage", {
    recursive: true,
  });
  if (corrupt) {
    writeFileSync(cursorDbPath, "NOT A SQLITE DATABASE - GARBAGE");
    return;
  }
  rmSync(cursorDbPath, { force: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(cursorDbPath);
  db.exec("CREATE TABLE IF NOT EXISTS itemTable (key TEXT PRIMARY KEY, value TEXT)");
  const ins = db.prepare("INSERT OR REPLACE INTO itemTable(key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(rows)) ins.run(k, v);
  db.close();
}

// We need to dynamically import after mocks are registered
let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Route memakai `require("better-sqlite3")` (CJS dinamis, a6c764d7). Dalam
    // runtime ESM vitest `require` bebas tak terdefinisi (ReferenceError) sehingga
    // strategi 1 tak pernah dijalankan — sediakan shim yang mendelegasikan ke mock.
    mockDbInstance.__throwOnConstruct = false;
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  afterAll(() => {
    try {
      rmSync(testHome, { recursive: true, force: true });
    } catch { /* temp bisa saja sudah dibersihkan */ }
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    // kontrak baru (route a6c764d7): daftar lokasi yang dicek ikut disertakan
    expect(response.body.error).toContain("Cursor database not found. Checked locations");
  });

  it("falls back to manual-paste when macOS db exists but cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    await writeCursorDb({}, { corrupt: true }); // file rusak → Database() throw

    const response = await GET();

    // kontrak baru (a6c764d7 #411): gagal buka db → senyap lanjut ke
    // strategi CLI, dan bila semuanya gagal tawarkan paste manual (200, tanpa error).
    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  // ── Token extraction ──────────────────────────────────────────────────
  // Route kini membaca per-kunci via db.prepare(...).get(key) (a6c764d7),
  // jadi mock disiapkan sebagai map key → value.
  const mockRows = (rows) => {
    mockDbInstance.prepare.mockReturnValue({
      get: (key) => (key in rows ? { value: rows[key] } : undefined),
      all: vi.fn().mockReturnValue([]),
    });
  };

  it("extracts tokens using exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    await writeCursorDb({
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    // mockDbInstance.close tak lagi relevan — route membaca via better-sqlite3
    // native pada file SQLite nyata (penutupan terjadi pada handle DB asli).
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    await writeCursorDb({
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  // ── Fuzzy fallback (macOS only) ───────────────────────────────────────

  // ── Key-chain fallback (macOS only) ────────────────────────────────────
  // Fuzzy LIKE sudah dihapus upstream (a6c764d7); kini fallback = kunci
  // kedua dalam ACCESS_TOKEN_KEYS / MACHINE_ID_KEYS dicoba berurutan.

  it("falls back to the alternate key when the primary key is missing", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    await writeCursorDb({
      "cursorAuth/token": "fallback-token", // kunci utama kosong → kunci cadangan
      "storage.machineId": "fallback-machine",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  it("offers manual paste when tokens are missing even after fallback", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    await writeCursorDb({}); // file valid, tanpa baris token

    const response = await GET();

    // kontrak baru: tanpa token → arahkan user paste manual (bukan pesan error)
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  // ── Backwards-compatible: linux/win32 keep original single-path logic ─

  // ── Linux: kini ikut multi-path probing (8312af79 menambah GATE instalasi,
  //    bukan menghapus probing — dua path ~/.config/Cursor dicek lebih dulu) ──

  it("linux probes its candidate paths and reports the checked locations", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations");
    // linux TIDAK lagi single-path — kedua kandidat diprobe
    expect(fsPromises.access.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("unknown platform falls back to default paths with 200 (graceful)", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    // kontrak baru (a6c764d7): tanpa 400 — pakai path default ~/.config/Cursor,
    // gagal probing pun tetap 200 dgn jalur paste-manual.
    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
  });
});
