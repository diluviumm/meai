import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileP = promisify(execFile);
const REPO = path.join(os.homedir(), "me/github/meai");
const STATE = path.join(os.homedir(), ".hermes/state/meai-fork-update.txt");
const LOG = path.join(os.homedir(), ".hermes/state/meai-fork-update.log");

function readState() {
  try {
    return fs.readFileSync(STATE, "utf8").trim();
  } catch {
    return null;
  }
}

function readLogTail(lines = 16) {
  try {
    return fs.readFileSync(LOG, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

async function git(args, timeout = 20000) {
  const { stdout } = await execFileP("git", args, { cwd: REPO, timeout, maxBuffer: 1024 * 1024 });
  return stdout;
}

/** GET /api/upstream?mode=state — hanya baca state (tanpa network).
 *  GET /api/upstream — fetch upstream + hitung behind + daftar commit. */
export async function GET(request) {
  const url = new URL(request.url);
  const state = readState();
  const logTail = readLogTail();
  if (url.searchParams.get("mode") === "state") {
    return NextResponse.json({ state, logTail });
  }
  try {
    await git(["fetch", "upstream", "--quiet"], 45000);
    // Ronde-46: hitungan PATCH-BASEN (git cherry), bukan sha-based rev-list.
    // Fork menerapkan update via cherry-pick + resolusi manual → sha upstream
    // TIDAK pernah masuk history → rev-list HEAD..upstream selamanya menunjukkan
    // "N behind" walau semua patch sudah diterapkan (akar notifikasi tak pernah
    // hilang). git cherry menandai '-' utk patch yang sudah ada; yang dihitung
    // hanya '+' yang belum, dan sha yang sudah diterapkan dgn resolusi berbeda
    // tercatat di ~/.hermes/state/meai-synced-upstream-shas.txt.
    const syncedShas = new Set((() => {
      try {
        return fs
          .readFileSync(path.join(os.homedir(), ".hermes/state/meai-synced-upstream-shas.txt"), "utf8")
          .split("\n")
          .map((l) => l.trim().split(/\s+/)[0])
          .filter((x) => /^[0-9a-f]{40}$/.test(x));
      } catch {
        return [];
      }
    })());
    const cherryRaw = await git(["cherry", "HEAD", "upstream/master"]);
    const cherryLines = cherryRaw.trim() ? cherryRaw.trim().split("\n") : [];
    const isPending = (line) => {
      const [flag, sha] = line.split(/\s+/);
      return flag === "+" && !syncedShas.has(sha);
    };
    const behind = cherryLines.filter(isPending).length;
    // Daftar commit = yang benar2 belum masuk (konsisten dgn angka)
    const pendingShas = cherryLines.filter(isPending).map((l) => l.split(/\s+/)[1]);
    const logRaw = pendingShas.length
      ? await git(["log", "--pretty=format:%h|%ad|%s", "--date=short", ...pendingShas.slice(0, 25)])
      : "";
    const commits = logRaw.trim()
      ? logRaw.trim().split("\n").map((l) => {
          const [sha, date, ...msg] = l.split("|");
          return { sha, date, msg: msg.join("|") };
        })
      : [];
    const statusRaw = await git(["status", "--porcelain"]);
    const dirtyFiles = statusRaw.trim() ? statusRaw.trim().split("\n").length : 0;
    return NextResponse.json({ behind, commits, dirtyFiles, state, logTail, checkedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: String(e?.message || e).slice(0, 300), state, logTail, behind: null },
      { status: 500 }
    );
  }
}

/** POST /api/upstream {action:"apply"} — jalankan update terpisah (systemd-run), 
 *  build + restart; proses independent dari meai.service (survive restart). */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (body.action !== "apply") {
    return NextResponse.json({ error: "action harus 'apply'" }, { status: 400 });
  }
  // tolak bila masih berjalan
  try {
    await execFileP("systemctl", ["--user", "is-active", "--quiet", "meai-fork-update"], { timeout: 8000 });
    return NextResponse.json({ error: "update masih berjalan", state: readState() }, { status: 409 });
  } catch {
    /* tidak aktif = boleh jalan */
  }
  const current = readState() || "";
  if (/^(apply|build|restart|queued)/.test(current) && !/^(failed|done)/.test(current)) {
    return NextResponse.json({ error: "state masih berjalan", state: current }, { status: 409 });
  }
  try {
    fs.writeFileSync(STATE, "queued");
    fs.writeFileSync(LOG, `=== antre ${new Date().toISOString()} ===\n`);
    await execFileP("systemd-run", [
      "--user",
      "--collect",
      "--unit=meai-fork-update",
      "--quiet",
      path.join(os.homedir(), ".hermes/scripts/meai-web-update.sh"),
    ], { timeout: 15000 });
    return NextResponse.json({ started: true, state: "queued" });
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 200);
    try {
      fs.writeFileSync(STATE, "failed: spawn " + msg);
    } catch {}
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
