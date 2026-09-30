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
