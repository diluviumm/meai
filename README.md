# MeAI — Mael Stack

**MeAI** adalah fork pribadi dari [meai](https://github.com/decolua/9router) (v0.5.86) — satu gateway lokal yang menerjemahkan satu endpoint OpenAI/Anthropic-compatible menjadi puluhan provider AI. Fork ini sudah dibersihkan dari elemen promosi upstream, diganti merek menjadi **MeAI**, dan diintegrasikan penuh ke sistem setup Hermes (portal, tunnel Cloudflare, backup otomatis).

> Nama CLI/intern tetap `meai` (perintah, direktori `~/.meai`, header API `x-9r-*`, port `20128`) agar kompatibilitas config tidak rusak — hanya merek tampilan yang berubah menjadi MeAI.

## Ringkasan Angka

| Komponen | Jumlah |
|---|---|
| Provider registry | **373** (124 upstream + 249 dari katalog OmniRoute) |
| CLI Tools / Coding Agents | **32** (26 upstream + 6 baru dari OmniRoute) |
| Model di katalog | 4.686 (catalog-sync otomatis) |
| Combo aktif | `mael-mimo` — 6 model (3 opencode-go + 3 xiaomi-mimo) |
| Alias model | `mimo`, `mimo-pro`, `mimo-ultra` |
| Halaman dashboard | 26 (iklan/9Remote/9English/Skills/Proxy Pools/Media dihapus) |

## Endpoint

| URL | Isi |
|---|---|
| `https://meai.ishmly.space` | Dashboard **MeAI** (alias branding) |
| `https://meai.ishmly.space` | Dashboard meai (jalur lama, tetap jalan) |
| `https://*.ishmly.space` | Portal Hermes (monitoring lintas service) |
| `http://127.0.0.1:20128` | Proxy utama (localhost) |
| `GET /api/healthz` · `GET /api/health` | Status sehat gateway |

Akses publik dilindungi **Cloudflare Access** (tidak ada login ganda di aplikasi).

## Fitur

### Proxy & Routing
- **Endpoint OpenAI-compatible**: `POST /v1/chat/completions` (base URL `http://127.0.0.1:20128/v1`).
- **Endpoint Anthropic-compatible**: `ANTHROPIC_BASE_URL=http://127.0.0.1:20128` untuk klien Claude-Code-style.
- **373 provider** dengan metadata (website, URL API key, model list, penanda free-tier

### Free-tier & ranking provider
Katalog **free-tier** (pools, kuota, hitungan token/bulan) dan **ranking provider** diadaptasi dari OmniRoute ke [`docs/FREE_TIERS.md`](docs/FREE_TIERS.md) — 489 entri free-tier di 35 pool berulang, ringkasan headline ~1.62B token/bulan (angka sumber OmniRoute, diaudit upstream tiap 2 minggu). Fork menyediakan **penanda free-tier per provider** (373 provider di katalog).
).
- **Combos**: gabungan beberapa provider/satu provider multi-model dengan fallback lintas-provider — combo `mael-mimo` memuat `opencode-go:mimo-v2.6-{flash,pro,ultraspeed}` + `xiaomi-mimo:mimo-v2.6-{flash,pro,pro-ultraspeed}`.
- **Alias model**: `mimo` → xiaomi-mimo v2.6-flash, `mimo-pro` → mimo-v2.6-pro, `mimo-ultra` → mimo-v2.6-pro-ultraspeed.
- **Quota Tracker** & **Usage** (grafik 24 jam, rincian per provider/hari, ekspor JSON). Quota **MiMo Token Plan** (`xiaomi-tokenplan`): self-track otomatis dari `usageHistory` + opsional console-cookie / limit paket untuk bar presisi.
- **Combo & Vision Adapter**, **Endpoint & Key**.
- **Token Saver dihapus total (Ronde-40)** — RTK, Headroom, PXPIPE, Caveman, Ponytail dibersihkan dari halaman, API, pipeline chat, settings, dan CLI.

### CLI Tools (32)
`claude` · `codex` · `cline` · `copilot` · `cursor` · `continue` · `kilo` · `roo` · `amp` · `qwen` · `opencode` · `openclaw` · `droid` · `hermes` · `cowork` · `devin` · `crush` · `forge` · `smelt` · `codewhale` · `jcode` · `pi` · `omp` · `opendesign` · `antigravity`(MITM) · `kiro`(MITM) + **baru**: `aider` · `goose` · `zoo-code` · `open-interpreter` · `warp-ai` · `deyin-ai`.
Setiap tool punya halaman detail: panduan konfigurasi (guide), deteksi status terpasang, dan (untuk tool ber-route) tombol simpan/ hapus config otomatis.

### Keamanan & Hardening (fork)
- **Login aplikasi dihapus** — mengandalkan Cloudflare Access saja.
- **Telepon-balik ke 9router.com diputus, updater & telemetri dimatikan.**
- **8 rute reset-password/OIDC/SAML dibalas 501** (SSO dihentikan; pakai Cloudflare Access).
- **Donations & pemilih bahasa dihapus** dari header.
- **Atribusi**: `PLAN-FITUR.md` (DoD 6/6), `NOTICE.txt` (pengingat kontribusi upstream).

### Integrasi Hermes (otomatis, zero-touch)
- **Portal** `ishmly.space` (port 9080): pill status meai (healthz tiap 90 dtk), pill usage (data 15 menit dari cron), **banner availability koneksi** (cron per jam), modal rincian usage & sistem.
- **Backup DB** (`~/.meai/db/data.sqlite`) → lokal (rotasi 7 hari) + GDrive `Seagate Backup/meai/` — cron harian 03:25.
- **Catalog-sync** (4.686 model) & **upstream-check** (fork vs decolua) — cron harian 03:25.
- **Ingress tunnel** Cloudflare (YAML objek tervalidasi): `meai.` dan `router.` → 20128.

## Pakai

```bash
# OpenAI-compatible
export OPENAI_BASE_URL=http://127.0.0.1:20128/v1
export OPENAI_API_KEY=<API key MeAI>

# Anthropic-compatible
export ANTHROPIC_BASE_URL=http://127.0.0.1:20128
```

Jalankan dashboard: `meai` (port 20128), lalu buka `https://meai.ishmly.space`.

## Rollback

Tarball upstream bersih: `~/me/forks/rollback/meai-0.5.86.tgz`. Semua patch fork punya backup `.bak-*` lokal dan tercatat di git (cabang `mael/fork`).

## Update dari Upstream (Web — tanpa cron)

Cek & update fork **langsung dari dashboard** (ronde-26):

1. Sidebar menampilkan status upstream otomatis saat dibuka (`N commit upstream` / `fork up-to-date`).
2. Klik banner → modal daftar commit → tombol **Update & Build**.
3. Proses jalan di unit `meai-fork-update` (`systemd-run --user`, terpisah dari server — aman walau app restart):
   **cherry-pick commit aman** → **`npm run build`** → **restart `meai.service`** → healthz check.
4. Selesai → klik **Muat ulang**.

- API: `GET`/`POST /api/upstream` (wajib login — `ALWAYS_PROTECTED` di `dashboardGuard.js`).
- Phase + log: `~/.hermes/state/meai-fork-update.txt` / `.log`.
- Dry-run manual: `~/.hermes/scripts/meai-upstream-apply.sh` (tanpa `--apply`).
- Detail seleksi & konflik: [`docs/UPSTREAM-SYNC.md`](docs/UPSTREAM-SYNC.md).
- Cron check harian (03:25) **dihapus** — cek kini on-demand dari web.

## Kredit

- Upstream: [decolua/9router](https://github.com/decolua/9router) (MIT) — struktur dasar, proxy, dashboard.
- Katalog provider & daftar CLI tool mengacu ke [diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute) (data, bukan kode).
- Fork & integrasi: Mael.
