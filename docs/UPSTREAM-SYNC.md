# Upstream Sync — Panduan Update Selective dari decolua/9router

> Fork ini (`diluviumm/meai`) menjaga **identitas MeAI** (rebrand, token savers, tema Noctalia,
> keep-list provider) di atas basis upstream `decolua/9router`.
> Update harus **selective** — bukan merge besar-besaran — supaya identitas fork tidak tertimpa
> dan konflik bisa dihitung.

## 1. Mekanisme update (ronde-26: dari WEB, tanpa cron)

| Komponen | Kapan | Fungsi |
|---|---|---|
| Banner sidebar (fork) | saat dashboard dibuka | auto-`GET /api/upstream` → tampil "N commit upstream" / "fork up-to-date" |
| `POST /api/upstream {action:"apply"}` | saat tombol **Update & Build** diklik | menjalankan unit `meai-fork-update` via `systemd-run --user` (TERPISAH dari server → aman walau app restart) |
| `~/.hermes/scripts/meai-web-update.sh` | oleh unit tersebut | phase: **apply** (cherry-pick aman, lihat §3) → **build** → **restart** → healthz check; log/phase di `~/.hermes/state/meai-fork-update.{log,txt}` |
| `~/.hermes/scripts/meai-upstream-apply.sh` | dipanggil web-update | **SELECTIVE APPLY**: cherry-pick commit upstream yang aman (lihat §3); dry-run bila tanpa `--apply` |
| `~/.hermes/scripts/meai-upstream.sh` | manual / fallback | check-only on-demand (dulu via cron 03:25 — **cron check dihapus ronde-26**) |

Check **tidak pernah mengubah repo** — hanya melapor. Apply selalu terpisah dan terkontrol
(ditolak otomatis bila masih berjalan → 409; semua route `/api/upstream` wajib login ALWAYS_PROTECTED).


## 2. Kenapa selective (bukan `git pull upstream master`)

1. Fork sudah mengubah banyak file (rebrand `9router→MeAI`, `globals.css` tema Noctalia,
   `ConnectionsCard`, availability API, provider keep-list, `README`, dll).
2. `git pull` upstream = merge penuh → konflik di file-file identitas → risiko identitas fork tertimpa.
3. Selective = **perubahan upstream diambil satu-satu**, dan kita TAHU setiap file apa yang masuk.

## 3. Cara kerja `meai-upstream-apply.sh` (selective, aman)

```
bash ~/.hermes/scripts/meai-upstream-apply.sh           # DRY-RUN: rencana saja, tanpa menyentuh repo
bash ~/.hermes/scripts/meai-upstream-apply.sh --apply   # eksekusi cherry-pick yang aman
```

Algoritma:

1. `git fetch upstream` (decode DPI bila perlu — lihat playbook hermes: pakai API/patch bila HTTPS fetch diblokir).
2. `BASE=$(git merge-base HEAD upstream/master)` → titik gabung terakhir.
3. **Daftar file yang sudah dimodifikasi fork**: `git diff --name-only $BASE..HEAD`.
4. **Daftar commit baru upstream**: `git log $BASE..upstream/master --oneline`.
5. Untuk tiap commit upstream:
   - Ambil daftar file yang disentuh commit (`git show --name-only`).
   - **SKIP (auto-safe)** bila TIDAK ada satu pun file-nya menyentuh file yang dimodifikasi fork.
   - **SKIP (butuh review manual)** bila ada irisan → dicatat dalam daftar "perlu cherry-pick tangan".
   - Yang aman → `git cherry-pick <sha>` (berhenti + `--abort` bila konflik tak terduga).
6. Setelah apply: `npm run build` (wajib hijau) → kalau lolos, `git push origin mael/fork`.
7. Commit upstream yang di-skip dicatat di `~/.hermes/state/meai-upstream-apply.log` —
   jalankan ulang `--dry-run` setelah tiap sync untuk melihat sisa.

## 4. Kalau commit yang di-skip MAU diambil (review manual)

```bash
git fetch upstream
git cherry-pick <sha>            # kalau konflict:
git status                        # lihat file bentrok
#  ...selesaikan manual...
git add <file> && git cherry-pick --continue
# atau batalkan: git cherry-pick --abort
```

Setelah konflik selesai: **periksa ulang identitas MeAI** — `grep -ri "9router" <file>` hanya
boleh menemui URL resmi (`github.com/decolua/9router`, `9router.com`) — selain itu = kembali tertimpa.

## 5. Checklist pasca-update (wajib)

- [ ] `npm run build` hijau (Next.js compile).
- [ ] `curl -s localhost:20128/api/healthz` → `service: meai-mael-stack`.
- [ ] Rebrand: `grep -rn "9router" src --include="*.js" | grep -v "github.com/decolua\|9router.com\|// " ` → 0 non-URL.
- [ ] Keep-list provider utuh: settings `codebuddy-cn:true · opencode-go:false`.
- [ ] Token savers TIDAK dihidupkan lagi: upstream membawa `rtk · caveman · ponytail · headroom` — fork ini menghapusnya (Ronde-40); saat merge, drop kembali komponen saver upstream.
- [ ] Tema Noctalia: `.dark` vars di `globals.css` (`#141318` / `#c8bfff`).
- [ ] Push `origin mael/fork` + gitleaks.

## 6. Conflict resolution policy (fork)

- **Identitas fork menang** untuk: nama (MeAI), tema (Noctalia), keep-list, penghapusan token-saver,
  keamanan (masking key), rate-limit/IP handling.
- **Upstream menang** untuk: perbaikan bug routing/translator, provider registry baru,
  perbaikan performa — asalkan tidak menyentuh identitas.
- Selalu backup: `git stash list` / `git branch backup/pre-sync-<tanggal>`.

## Modifikasi test fork vs `known-fails.txt` upstream (Ronde-45)

Enam file test dimodifikasi fork setelah disinkronkan dengan kontrak kode yang
telah berevolusi (semua test kini LULUS — 49 → 7 gagal). Saat sync berikutnya,
**ambil versi fork** untuk file ini (upstream mencatatnya sebagai known-fail,
bukan sebagai kontrak yang harus dikembalikan):

- `tests/unit/oauth-cursor-auto-import.test.js` — 8 test disinkron (pesan baru,
  key-chain fallback, graceful 200) + diuji dengan file SQLite NYATA (route kini
  `require("better-sqlite3")` native yang tidak terjangkau `vi.mock`).
- `tests/unit/db-concurrent.test.js` — entri paralel dibuat unik (dedup
  by-design `ec096d2a` menganggap timestamp+tokens identik = double-fire).
- `tests/unit/opencode-free-tool-choice.test.js` + `unit/opencode-muse-spark-thinking.test.js`
  — tool cloaking `822aa958` (stub "currently unavailable" menyertai tool asli).
- `tests/unit/windsurf-executor.test.js` — windsurf hidden by design (`8e04fe17`),
  URL codeium, PROVIDERS.windsurf absen disengaja.
- `tests/unit/executor-const-guard.test.js` — `3f9382de` menurunkan 429: 6→3.
- `tests/unit/image-generation.test.js` — CODEX_CLI_VERSION 0.154→0.155.
- `tests/unit/kiro-external-idp.test.js` — migrasi CodeWhisperer → surface q.*.
- `tests/unit/kiro-terminal-integrity.test.js` — integrity retry kini meng-walk
  SEMUA surface (failover 401) → mock 401 per surface, body besar di surface final.
- `tests/unit/cursor-models.test.js` — transport HTTP/2 (mock `node:http2`,
  default export, key "http2"+"node:http2").
- Translator (bugs-toClaude/bug-gemini/thinking-unified/helpers-edge/
  commandcode-to-openai/openai-to-commandcode) — sinkron kebocoran berkas;
  `thinking-unified` gagal mengungkap **bug produksi nyata** yang diperbaiki:
  `MODEL_CAPABILITIES["glm-5.2"]` kehilangan `thinkingEffortSupported` (lookup
  exact menang atas pattern).

## Ronde-46 — Sync 41 commit upstream (v0.5.91 → v0.5.95) + fix akar notifikasi

**Masalah lama:** banner "N commit upstream" tak pernah hilang walau update
dijalankan — dua akar:
1. `GET /api/upstream` memakai `git rev-list --count HEAD..upstream/master`
   (SHA-BASEN) — cherry-pick tidak memasukkan sha upstream ke history fork,
   jadi angkanya selamanya tinggi. Kini memakai **`git cherry HEAD upstream/master`**
   (PATCH-BASEN): `-` = patch sudah ada, `+` = belum; sha yang diterapkan dgn
   resolusi manual tercatat di `~/.hermes/state/meai-synced-upstream-shas.txt`
   (WAJIB ditambah tiap resolusi konflik yang menghasilkan patch-id berbeda).
2. Selective apply menahan ~32 commit ber-irisan (SKIP-REVIEW) — dibereskan
   satu per satu pada ronde-46 (cherry-pick otomatis + resolusi manual).

**Cara resolusi konflik yang terbukti (pakai lagi saat sync berikutnya):**
- Irisan registry index.js → pertahankan versi fork, sisipkan provider baru
  dgn nomor variabel lanjutan (p376, p377) — JANGAN pakai nomor upstream.
- Baseline JSON (providers/alias) → REGENERASI, jangan merge manual:
  `node tests/__baseline__/snapshot-providers.mjs` dan
  `node tests/__baseline__/verify-alias.mjs --snapshot`.
- Kode yang menyentuh token-saver (settingsRepo/chatCore) → HEAD menang mutlak;
  hanya fungsi BARU upstream yang disisipkan (contoh: `providerOverrides`).
- Test golden → update snapshot SETELAH memverifikasi perubahan berasal dari
  patch upstream (mis. Grok CLI UA 1.0.44, versi internal 0.5.95).
- `git checkout --theirs` HANYA untuk file yang seluruhnya boleh tertimpa;
  file identitas (Sidebar, package.json) WAJIB merge manual/3-way.

**Setelah sync wajib:** restart service (manifest chunk vs disk harus sinkron —
rebuild tanpa restart = 500/MIME-error di semua halaman), lalu gate + verify +
audits seperti biasa. Bukti ronde-46: gate hijau (12 all-known), verify ok:true,
eslint 117 = baseline, text CLEAN, responsive 27/27, visual 18/18, banner behind:0.
