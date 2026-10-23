import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DB_DIR = path.join(os.homedir(), ".meai", "db");

function backups() {
  if (!fs.existsSync(DB_DIR)) return [];
  return fs.readdirSync(DB_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^data.*\.(sqlite|bak)/.test(entry.name))
    .map((entry) => {
      const file = path.join(DB_DIR, entry.name);
      const stat = fs.statSync(file);
      return { name: entry.name, bytes: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function GET() {
  return NextResponse.json({ backups: backups() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  try {
    const { name } = await request.json();
    const safeName = path.basename(String(name || ""));
    if (!/^data.*\.(sqlite|bak)$/.test(safeName) || safeName !== name) {
      return NextResponse.json({ error: "Nama backup tidak valid" }, { status: 400 });
    }
    const file = path.join(DB_DIR, safeName);
    if (!fs.existsSync(file)) return NextResponse.json({ error: "Backup tidak ditemukan" }, { status: 404 });
    const integrity = execFileSync("sqlite3", [file, "PRAGMA integrity_check;"], { encoding: "utf8", timeout: 20_000 }).trim();
    const tables = Number(execFileSync("sqlite3", [file, "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"], { encoding: "utf8", timeout: 20_000 }).trim()) || 0;
    let quotaRows = null;
    try { quotaRows = Number(execFileSync("sqlite3", [file, "SELECT COUNT(*) FROM quotaHistory;"], { encoding: "utf8", timeout: 20_000 }).trim()); } catch { /* optional table */ }
    return NextResponse.json({ name: safeName, integrity, tables, quotaRows, ok: integrity === "ok" });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Pemeriksaan backup gagal" }, { status: 500 });
  }
}
