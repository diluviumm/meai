# Panduan Penggunaan Fork MeAI

Panduan operasional semua fitur utama fork `diluviumm/meai` — ditujukan untuk operator
(Mael) dan untuk sesi inspeksi otomatis. Setiap bagian: **fungsi → cara pakai → jika
bermasalah**.

---

## 0. Overview (pusat kendali)

`/dashboard/overview` — menu pertama, tepat di atas Endpoint & Key. Satu layar
berisi seluruh visualisasi gateway, semua otomatis refresh tiap 30 detik:

| Panel | Sumber data | Cara membaca |
|---|---|---|
| KPI strip (Requests · Tokens · Cost · p95 Latency · Providers) | `/api/usage/stats` | nilai + sparkline tren pada periode terpilih; p95 merah bila ≥15 dtk |
| Penggunaan Gateway (area chart) | `/api/usage/chart` | hover untuk token & request per interval; puncak periode ditandai |
| Top Models | `byModel` dari stats | bar proporsional token; request & cost ikut tertulis |
| Provider Health | `/api/providers/client` | titik hijau=available, merah=unavailable, abu=belum diuji; error terakhir tampil |
| Budget Harian (donat) | `settings.costBudgetDaily` vs cost hari ini | kuning >80%, merah bila lewat anggaran |
| Distribusi Latensi | `latency.p50/p95` | ekor distribusi — p95 = yang dirasakan pengguna |
| Aktivitas Terakhir | `recentRequests` | 6 request terakhir (waktu, model, provider, token, cost) |

Semua angka berasal dari gateway (tanpa angka karangan); bila belum ada data
tampil "–" atau empty-state yang jelas. Tombol periode **Today/24h/7D/30D/Custom**
mengubah semua panel sekaligus:

- **Custom** → pilih rentang tanggal (Dari/Sampai) lalu **Terapkan**. Divalidasi
  klien & server: format YYYY-MM-DD, urutan tanggal benar, maksimal 731 hari.
  Tombol Custom lagi menonaktifkan kembali ke preset.
- **Delta "vs sebelumnya"** pada KPI Requests/Tokens/Cost memakai jendela
  periode sebelumnya yang sama panjang (helper `previousPeriodQuery`) — panah
  ▲/▼ + persentase dihitung dari data gateway, bukan perkiraan.
- **Interaksi 3D** (hover kartu) hanya di perangkat pointer halus (mouse) —
  GPU transform, dimatikan otomatis pada sentuhan & `prefers-reduced-motion`.

## 1. Endpoint & Key

**Fungsi:** menampilkan base URL gateway + API key untuk disuntikkan ke tool.

| Kegiatan | Cara |
|---|---|
| OpenAI-compatible | `OPENAI_BASE_URL=http://127.0.0.1:20128/v1` + API key dari halaman |
| Anthropic-compatible | `ANTHROPIC_BASE_URL=http://127.0.0.1:20128` + API key |
| Publik via tunnel | `https://meai.ishmly.space` (dilindungi Cloudflare Access) |

**Sehat?** `curl http://127.0.0.1:20128/api/healthz` → `{"ok":true,...}`.

## 2. Providers

**Fungsi:** 373 registry provider + koneksi (OAuth / API key) dengan fallback.

- Tambah koneksi: **Providers → Add** (pilih provider → ikuti alur OAuth atau tempel key).
- Tes koneksi: tombol **Test** pada kartu koneksi (badge `active` / `error`).
- Nonaktifkan tanpa hapus: **toggle** pada kartu.

**Sehat?** Halaman Providers render tanpa error console; `GET /api/providers/client`
mengembalikan daftar koneksi.

## 3. Usage

**Fungsi:** grafik pemakaian 24 jam/periode, rincian per provider/model/hari, ekspor JSON.

- Ganti periode lewat dropdown rentang.
- Tab **Request Details** menampilkan isi request/response terakhir (data lokal saja).

- **KPI p95 Latency** (kartu ke-6): distribusi latensi request — p95 = ekor yang
  dirasakan pengguna (bukan rata-rata yang menipu). Warna: hijau <5s, kuning <15s,
  merah ≥15s. Caption menampilkan p50 + jumlah sampel. Sumber datanya
  `usageHistory.meta.latency` (lokal, tanpa telemetri outbound); request yang
  tercatat sejak fitur ini aktif akan mengisi kartu otomatis. Bila belum ada
  sampel tampil "–" (bukan angka karangan).

**Sehat?** `GET /api/usage/stats?period=today` mengembalikan JSON angka
(`latency: {p50, p95, samples}` terisi bila sudah ada request tercatat).

## 4. Quota Tracker

**Fungsi:** satu kartu per koneksi menampilkan sisa kuota + hitung mundur reset.

- **Auto-refresh**: interval 5 detik (dapat diubah) + tombol Refresh manual; cache
  server 5 detik agar API provider tidak di-spam.
- Menyembunyikan baris quota: ikon **mata tercoret** pada baris (tersimpan per baris).

### 4a. MiMo Token Plan (`xiaomi-tokenplan`) — khusus

Xiaomi **tidak** menyediakan endpoint kuota untuk key `tp-` (dicek langsung: semua path
404; GitHub XiaomiMiMo/MiMo-Code#2495 masih open). Karena itu kartu ini punya dua jalur:

| Jalur | Cara mengaktifkan | Hasil |
|---|---|---|
| **Self-track (default, otomatis)** | Tak perlu apa pun | Menghitung semua token yang lewat gateway ini pada bulan berjalan |
| **Kuota riil dari console** | Edit koneksi → tempel **Console Cookie** dari `platform.xiaomimimo.com` (DevTools → Network → header `Cookie`; berlaku ~24 jam) | used/limit/percent + akhir periode langsung dari Xiaomi |
| **Bar progres tanpa cookie** | Edit koneksi → isi **Plan total tokens** (angka limit paket) | progress bar presisi dari hitungan lokal |

- Kosongkan input lalu Save → field terhapus (semantik clear).
- Cookie **tidak pernah** dikirim balik ke browser (di-mask `***` di API GET).

**Sehat?** `GET /api/usage/<connectionId>` → `{"plan":"Token Plan","source":"self-tracked",...}`
atau `source:"console"` bila cookie aktif.

## 5. CLI Tools

**Fungsi:** 32 tool (claude, codex, cursor, opencode, dll) — tiap tool punya halaman
detail: panduan konfigurasi, deteksi terpasang, tombol simpan/hapus config otomatis.

**Cara pakai:** buka tool → ikuti guide → klik **Save config** bila tombol aktif.

## 6. Endpoint & Tunnel (halaman dashboard)

- **Cloudflare tunnel**: tombol ON/OFF di halaman Endpoint; URL cepat (*quick tunnel*)
  **berputar tiap restart** — pakai short-link `https://r<shortId>.abc-tunnel.us`
  yang stabil, atau domain sendiri bila sudah daftarkan.
- Ping browser ke URL tunnel lama akan gagal (noise console yang sudah difilter di
  visual-guard) — bukan bug.

## 7. Console Log & Settings

- **Console Log**: log runtime gateway (filter level).
- **Settings**: auth mode, pricing model, backup/restore DB (`~/.meai/db/data.sqlite`).

---

## Otomasi terpasang (harus tetap hijau)

| Timer | Peran | Frekuensi |
|---|---|---|
| `meai-usage` | ringkasan pemakaian → notifikasi | 15 menit |
| `meai-budget` | pantau budget harian | 30 menit |
| `meai-availability` | cek availability provider | 1 jam |
| `meai-daily` | ringkasan harian | harian 03:25 |
| `meai-visual-guard` | audit visual 6 route × 2 tema (Playwright) | harian 05:15 |
| `meai-audit` | audit fork | mingguan |
| `meai-upstream` | sinkron upstream `decolua/9router` | mingguan |

Status: `systemctl --user list-timers | grep meai`.

## Trouboring cepat

| Gejala | Cek |
|---|---|
| Dashboard 401 | session login / Cloudflare Access; CLI pakai header `x-9r-cli-token` |
| Gateway mati | `systemctl --user status meai` → `restart meai` |
| Kuota provider kosong | tombol Refresh kartu; lihat `message` pada kartu |
| Build gagal | `PATH=$HOME/.local/node22/bin:$PATH npm run build` |
| Gate uji | `cd tests && npx vitest run && node __baseline__/verify-no-regression.mjs <hasil.json>` |
