# MeAI — Panduan Pengguna

Dokumen ini menjelaskan setiap fitur dashboard MeAI, cara memakainya, dan
perilaku yang sering disalahpahami. Versi ringkasnya juga tersedia di dalam
aplikasi: **Dashboard → Panduan**.

---

## 1. Quick start (3 langkah)

1. **Sambungkan provider**
   `Providers` → pilih provider → `Add Connection`.
   - Provider OAuth: klik `Connect with OAuth`, selesaikan login di browser.
   - Provider API key: tempel key provider, beri nama, lalu `Test`.
2. **Buat API key MeAI**
   `Endpoint & Key` → buat key. Client memakai **key MeAI**, bukan key provider.
3. **Arahkan client**
   Base URL: `http://<host>:20128/v1`
   Model: `<prefix-provider>/<model>`, mis. `cbcn/deepseek-v4.1-flash`.

> Prefix model bisa dilihat di `Endpoint & Key` atau `GET /v1/models`.
> Tanpa prefix, model dicari di provider default dan bisa berakhir
> `404 No active credentials`.

---

## 2. Provider & Connections

Satu provider boleh punya **banyak koneksi** (akun/key). Semua koneksi aktif
diurutkan berdasarkan prioritas; koneksi teratas dicoba lebih dulu.

| Aksi | Efek |
|---|---|
| `Add Connection` | Menambah akun/key baru |
| Panah prioritas | Mengubah urutan percobaan |
| Toggle aktif | Menonaktifkan koneksi tanpa menghapus kredensial |
| `Test` | Uji kredensial ke provider |
| `Refresh` | Ambil ulang quota (bypass cache 5 detik) |

Koneksi yang gagal **tidak dihapus**. MeAI memberi cooldown per model
(`modelLock_<model>`) lalu mencoba lagi setelah cooldown berakhir.

---

## 3. Banyak API key: fallback otomatis

Perilaku **"key 1 limit → key 2"** sudah aktif secara bawaan dan **tidak**
memerlukan Round Robin.

Alurnya:

1. Request masuk → MeAI memilih koneksi sesuai prioritas (default `fill-first`).
2. Key 1 membalas `429` (limit), `401` (token mati), atau `5xx`.
3. MeAI menandai key 1 cooldown **untuk model tersebut**.
4. Request di-retry otomatis ke key 2.
5. Setelah cooldown habis, key 1 kembali dipakai.

Fallback bersifat **per model**: key bisa limit di satu model tetapi tetap
dipakai untuk model lain. Semua strategi (`fill-first`, `round-robin`)
memakai mekanisme fallback yang sama.

---

## 4. Round Robin & Sticky

`Round Robin` = membagi request **bergiliran** ke semua koneksi aktif.
`Sticky` = jumlah request berturut-turut yang tetap dilayani koneksi yang sama
sebelum pindah.

- Sticky `1` → pindah setiap request.
- Sticky `3` → tiga request per key, lalu pindah.

**Round Robin bukan fallback.** Ia hanya mengatur pembagian beban saat semua
key sehat. Fallback tetap berjalan otomatis saat ada key yang gagal.

Kapan dipakai?

- Ingin menyebar beban/kuota ke banyak key → nyalakan Round Robin, Sticky kecil.
- Ingin memakai key 1 sampai limit lalu pindah key 2 → biarkan `fill-first`
  (Round Robin mati), cukup atur prioritas.

---

## 5. Combo & Vision Adapter

Combo adalah rantai model cadangan. Jika model pertama gagal, MeAI mencoba
model berikutnya. Combo juga dipakai untuk vision adapter.

1. `Combo & Vision Adapter` → `New Combo`.
2. Tambahkan model dengan urutan fallback.
3. Model picker mendukung pencarian:
   - substring biasa: `claude`
   - exclusion: `claude -haiku` atau `claude !embed`
   - regex: `/^gpt-5/` atau `/sonnet|opus/i`
   - **Select All (N)** / **Deselect All (N)** bekerja pada hasil filter,
     bukan seluruh katalog.
4. Pilih strategi `fallback` atau `round-robin`.
5. Panggil combo sebagai nama model di `/v1`.

> Combo mengirim SSE walau `stream:false`. Untuk client non-stream yang ketat
> (Hindsight, SDK pihak ketiga), panggil **model langsung**, bukan nama combo.

---

## 6. Usage & biaya

`Usage` menampilkan request, token, biaya, latency, dan breakdown per
provider/model.

- Pilih periode `Today` / `7D` / `30D`.
- Delta dibanding periode sebelumnya dihitung paralel.
- `Request Details` menampilkan request individual + biaya.

Catatan angka:

- `prompt_tokens` di respons klien sengaja ditambah buffer 2000 token
  (`addBufferToUsage`) agar client tidak kena context error.
- Biaya di DB memakai token **asli**, jadi angka biaya tetap benar.
- Model tanpa harga di pricing registry tampil `$0` (bukan gratis).

---

## 7. Quota Tracker

`Quota Tracker` menampilkan sisa kuota per koneksi. Auto-refresh default aktif;
tombol `Refresh` memaksa bypass cache.

### 7.1 CodeBuddy CN / Intl

Payload Tencent berisi beberapa jenis paket:

| Paket | Arti | Field yang dipakai |
|---|---|---|
| `Monthly` / `Weekly` / `Daily` | Allowance berulang (subscription) | `Capacity*` (atau `Cycle*` hanya untuk paket multi-cycle) |
| `Bonus Pack N` | Kredit sekali pakai | `Capacity*`, expiry = `ExpiredTime` (fallback `CycleEndTime`) |

- Semua paket ditampilkan (aktif lebih dulu); paket expired diberi badge dan
  tidak dihitung dalam rata-rata sisa. Tombol `hide N expired` hanya
  menyembunyikan riwayat, bukan menghapus data.
- Panel **Check-in** menampilkan `streak_days`, `daily_credit`, `today_checked_in`,
  dan `week_progress` dari `/checkin-activity-status`.

**Bonus harian (API key vs OAuth):** CodeBuddy memberi 100 kredit/hari (1000 pada
hari ke-7) lewat `POST /billing/meter/daily-checkin`. Endpoint klaim ini
**menolak API key** dengan `403 API key not allowed for this path or method`;
hanya access token OAuth/client resmi yang bisa klaim. Yang bisa dilakukan
dengan API key adalah **membaca status** check-in (endpoint
`/checkin-activity-status` mengizinkan API key), dan MeAI menampilkannya di
kartu quota. Jadi bonus tidak bertambah karena gateway memang memblokir klaim,
bukan karena tracker tidak refresh.

**Perbaikan 22 Okt 2026:** paket subscription baru bisa tampil `500/500`
padahal belum dipakai. Penyebabnya handler lama selalu membaca
`CycleCapacityUsed` (yang berisi placeholder `500`) untuk paket refill.
Sekarang handler memilih pasangan field yang konsisten dan memvalidasi
`used + remain == total`. Paket baru tampil `0/500`.

### 7.2 OpenCode Zen

Endpoint `/zen/v1/usage` sempat membalas `404`. Handler sekarang mencoba
`/zen/v1/usage` lalu fallback ke `/zen/go/v1/usage` (endpoint yang sama-sama
menerima key Zen dan mengembalikan rolling/weekly/monthly).

### 7.3 Xiaomi Token Plan

Key `tp-` tidak bisa membaca quota sendiri. Handler memakai dua jalur:

1. **Console cookie** (`mimoConsoleCookie`) → quota resmi Xiaomi.
2. **Self-tracked** → token yang lewat MeAI bulan ini.

Cookie console berumur ~24 jam. Saat kedaluwarsa, kartu **tetap menampilkan
self-tracked** dengan hint, bukan kosong/error.

### 7.4 Status stale

Jika provider membalas error sementara (mis. 505 setelah tab lama), MeAI
menampilkan data terakhir yang masih segar (≤5 menit) dengan flag `stale`,
alih-alih mengosongkan kartu.

### 7.5 Sparkline & burn-rate forecast

- Sampel quota disimpan di **SQLite server** tabel `quotaHistory`
  (`connectionId`, `quotaName`, `sampledAt`, `used`, `total`, `pct`), sehingga
  riwayat yang sama terlihat di semua device yang membuka dashboard.
- Satu sampel per quota per **60 detik** (primary key mencegah duplikat);
  retensi **7 hari**. Endpoint: `GET /api/usage/<connectionId>/history?hours=24&limit=240`.
- Sparkline butuh ≥2 sampel. Forecast `≈Nd left` butuh rentang ≥12 menit dan
  memakai slope `used` sejak sampel pertama; jika `used` turun (window reset),
  seri lama dibuang agar tidak menghasilkan burn-rate negatif.
- Jika endpoint riwayat gagal, browser memakai riwayat lokal
  (`localStorage`, ±4 jam) sebagai fallback; bukan sumber utama.
- Jika `resetAt` lebih dekat daripada hasil forecast, label menampilkan
  `resets in Nd` — reset provider lebih otoritatif daripada ekstrapolasi.
- Forecast adalah estimasi pemakaian, bukan janji provider; hover label untuk
  melihat burn/day, jumlah sampel, dan rentang jam.
- **Usage → Top Models** kini menampilkan **burn/day** dan proyeksi **30 hari**
  per model, baik dalam mode **Tokens** maupun **Cost**. Angka memakai periode
  yang sedang dipilih di halaman Usage; ganti periode untuk melihat laju berbeda.

### 7.6 Riwayat quota, purge, dan budget per koneksi

- Buka **Quota → Riwayat** (`/dashboard/quota/history`). Pilih koneksi utama,
  koneksi pembanding, rentang **1 jam / 24 jam / 7 hari**, dan nama kuota.
  Grafik menampilkan **% sisa**; hover titik untuk waktu, sisa %, dan used/total.
- Forecast kini menyertakan **confidence** `low`/`medium`/`high` (jumlah sampel +
  rentang) dan **binding**: `resets`/`expires` jika window provider lebih dulu,
  atau `≈Nd left` jika proyeksi habis lebih dulu.
- **Purge** pada kartu koneksi menghapus baris `quotaHistory` koneksi itu saja;
  kuota provider tidak berubah. Retensi bisa diatur lewat environment
  `MEAI_QUOTA_HISTORY_RETENTION_DAYS` (1–90, default 7).
- **Budget per koneksi** menyimpan ambang USD/hari di
  `settings.costBudgetByConnection`. Timer budget membandingkan
  `/api/usage/stats?period=today` dan mengirim satu alert per level
  (`mendekati` 80%, `lewat` 100%) per koneksi per hari. Budget adalah peringatan,
  bukan pemutus request.
- **Sampler latar belakang** bersifat opt-in. Buat marker
  `~/.hermes/state/meai-quota-sampler.enabled`; timer 15 menit memanggil
  `/api/usage/<id>?force=1` untuk semua koneksi aktif, dengan jeda 2 detik antar
  provider. Tanpa marker, timer hanya mencatat `disabled` dan tidak memanggil
  provider.

### 7.7 Model picker dan urutan combo

- Preset picker: **Free** (`free`), **No embed** (`!embed`), **Claude -haiku**
  (`claude -haiku`). Preset hanya mengisi query pencarian.
- Tekan `/` untuk fokus pencarian, `Escape` untuk mengosongkan query.
  **Shift+click** memilih rentang model yang terlihat; **+ all** di header
  provider menambahkan semua model provider yang belum terpilih.
- Di editor combo, drag handle `drag_indicator` atau tombol ↑/↓ mengubah urutan
  fallback; urutan disimpan saat combo disimpan. Wildcard literal `provider/*`
  tidak dipakai — resolver combo memakai nama model eksplisit.

### 7.8 Insights & Health

- Buka **Insights & Health** di sidebar (`/dashboard/insights`).
- **Health score** 0–100 menggabungkan success rate, rasio 429, dan p95
  latency per koneksi; nilainya advisory, bukan pemutus request.
- **Leaderboard** menampilkan request, success, p95, cost per 1k token, dan
  cache hit per model. **Rate-limit heatmap** menampilkan 429 per key per jam.
- **Burn anomaly** membandingkan biaya satu jam terakhir dengan rata-rata enam
  jam sebelumnya; status `flagged` berarti lonjakan >1.8×.
- **Combo simulator** menjalankan dry-run urutan fallback, health score, dan
  compatibility tanpa mengirim request ke provider.
- **Automation status** membaca state nyata: quota compaction, restore drill,
  catalog diff, dan WCAG audit. Tombol **Compact now** menjalankan kompaksi
  quota secara manual.
- **Quiet hours** menyimpan `settings.alertQuietHours`; timer budget tidak
  mengirim notifikasi di dalam jendela tersebut.
- **Forecast & SLO** menampilkan spend hari ini, projected akhir hari, SLO p95,
  fairness score, ukuran DB, jumlah provider, dan notifikasi aktif.
- **Quota expiry forecast** memproyeksikan pemakaian dari dua sampel terakhir;
  entri ≤3 hari ditandai merah.
- **Per-key burn anomaly**, **pricing audit**, **notification center**, dan
  **provider matrix** membantu menemukan biaya/koneksi yang menyimpang.
- **Export JSON** mengunduh snapshot seluruh payload; **Ctrl/⌘ K** membuka
  command palette untuk navigasi cepat.
- Endpoint baru: `GET /api/events/stream` (SSE heartbeat 15 detik) dan
  `GET /api/openapi`; endpoint analytics seperti di atas.
- OpenAPI schema: `GET /api/openapi`; endpoint analytics:
  `GET /api/insights?hours=24`, `POST /api/combos/simulate`,
  `POST /api/maintenance/quota-compaction`.

### 7.9 Otomasi baru

| Timer | Jadwal | Fungsi |
|---|---|---|
| `meai-quota-history-sample.timer` | 15 menit | sampler quota lintas device (marker opt-in) |
| `meai-budget.timer` | 30 menit | alert budget global/koneksi, menghormati quiet hours |
| `meai-db-housekeeping.timer` | Minggu 04:20 | WAL checkpoint + `PRAGMA optimize` |
| `meai-restore-drill.timer` | tanggal 1 04:40 | backup SQLite + integrity + baca `quotaHistory` |
| `meai-catalog-watch.timer` | harian 06:00 | snapshot `/v1/models` + diff added/removed |

### 7.10 Optimizer & UX

- **Periode** Insights: 1 jam / 24 jam / 7 hari; semua metrik mengikuti periode.
- **Auto 30s** dapat dimatikan; refresh manual terjadi saat periode/filter berubah.
- **Leaderboard** bisa dicari, diurutkan (cost/req/p95/success), dan diexport CSV.
- **Optimizer** menampilkan completion share, cache share, average cost/1k,
  saran optimasi, usage timeline 24 jam, quota reset calendar, serta umur API key.
- **Alert history** disimpan lokal di browser (maksimal 30 entri, dedup per teks);
  **Simpan view** menyimpan kombinasi periode/filter/sort di browser.
- **Mobile bottom nav** muncul di layar kecil (<lg) untuk Overview, Insights,
  Usage, Quota, dan Panduan; konten diberi padding bawah agar tidak tertutup.
- **Export JSON** = snapshot penuh; **Export CSV** = leaderboard terfilter.

### 7.11 Governance & Safety

Buka `/dashboard/governance` untuk 12 pemeriksaan operasional:

1. **Fork self-check** — versi, API/DB, jumlah usage/quota/connection.
2. **Backup inventory** — file `data*.sqlite`/`.bak` di `~/.meai/db` beserta ukuran.
3. **Config drift** — bandingkan settings aktif dengan snapshot; tombol **Snapshot config** membuat baseline.
4. **Combo inventory** — jumlah combo dan waktu update terakhir.
5. **Circuit/cooldown** — koneksi dengan 429 atau `rateLimitedUntil`.
6. **Rate-limit advice** — saran dari 429 dan p95.
7. **Deprecation radar** — membaca `~/.meai/model-deprecations.json` bila tersedia.
8. **Capability coverage** — score per provider dari Insights.
9. **Budget confidence** — proyeksi rendah/tinggi dari variance biaya per jam.
10. **Cost allocation** — biaya dan request per API key.
11. **Webhook readiness** — status `alertWebhookUrl` dan host-nya.
12. **Performance & storage** — ukuran DB, jumlah usage/quota, bucket timeline.

Snapshot config tidak mengubah settings; ia hanya menulis `~/.meai/settings-snapshot.json` sebagai baseline drift.

---

## 8. CodeBuddy Intl: 11128 vs 11140

### 8.1 `400/11128 request illegal` (channel verification)

Gejala:

```
HTTP 400 {"code":11128,"msg":"request illegal", ...}
"channel verification, possibly because it was not sent from an official client"
```

Sejak 16 Okt 2026 gateway `www.codebuddy.ai` meminta **header identitas
percakapan** yang dikirim client resmi:

```
X-Conversation-ID
X-Conversation-Message-ID
X-Conversation-Request-ID
X-Request-ID
X-API-Key
X-User-Id: anonymous
X-Agent-Intent: craft
X-Domain: www.codebuddy.ai
```

`X-Conversation-ID` diturunkan dari pesan user pertama dan stabil per
percakapan; tiga header lain unik per request. Tanpa header ini, gateway
menolak sebelum membaca body. Build ini sudah mengirimnya untuk API key maupun
OAuth. Jika masih `11128`, periksa proxy yang membuang header `X-Conversation-*`
atau `X-API-Key`.

### 8.2 `403/11140 account restricted` (unusual activity)

Gejala:

```
HTTP 403 {"code":11140,"msg":"request illegal",
 "displayMsg":{"en":"Your account has been restricted due to unusual activity"}}
```

Ini **pembatasan akun di sisi provider**, bukan masalah header, bukan masalah
OAuth-vs-API-key. API key tetap bisa membaca quota/billing; hanya chat yang
diblokir. Tidak ada header atau flag di MeAI yang bisa membuka pembatasan ini.
Yang bisa dilakukan:

1. Tunggu masa review provider (biasanya sementara), lalu coba lagi.
2. Ajukan appeal lewat `SUBMIT_FEEDBACK` di official client CodeBuddy.
3. Selama menunggu, pakai `cbcn/<model>` untuk model yang sama (DeepSeek, GLM,
   Kimi, MiniMax, Hy3) — koneksi CN tidak terkena pembatasan intl.

> Catatan: `codebuddy.ai` (intl) dan `copilot.tencent.com` (CN) adalah region
> berbeda. Key CN tidak berlaku di intl, dan sebaliknya.

### 8.3 Check-in harian: kenapa API key tidak bisa

Endpoint `POST /billing/meter/daily-checkin` menolak API key dengan:

```
HTTP 403 {"code":403,"msg":"API key not allowed for this path or method"}
```

Klaim check-in adalah aksi **client resmi**. Client resmi mengirim
`X-Device-Token` yang dihasilkan security SDK aplikasi; token ini tidak
diturunkan dari API key dan tidak tersedia lewat OAuth token biasa. Proyek
open-source yang menangani WorkBuddy/CodeBuddy (mis. `yetone/magpie`) membaca
kasus ini sebagai `own-app`: akun valid, quota terbaca, tetapi check-in hanya
bisa dilakukan di app resmi. Karena itu MeAI **tidak** mencoba mengakali
endpoint ini; yang ditampilkan hanya status read-only
(`/checkin-activity-status`) dan pengingat bahwa bonus baru datang dari klaim
di app resmi/kampanye provider.

Cookie console, API key, atau header `X-API-Key` tidak membuka klaim ini. Jangan
memberikan cookie/device token ke layanan pihak ketiga.

### 8.4 Apakah 11140 bisa diakali?

Tidak. `11140` adalah account-level restriction; open-source gateway lain
(mis. Hanawa) menandainya sebagai **hard disable** dan meminta re-login, bukan
soft cooldown. Tidak ada header, proxy, atau urutan request yang membatalkan
restriction. Jalur pemulihan: appeal di official client, tunggu review, atau
gunakan akun/key lain yang tidak terkena. Ini batasan provider, bukan bug MeAI.

---

## 9. CLI Tools

`CLI Tools` menulis konfigurasi tool (Claude Code, Codex, Cursor, Cline,
OpenCode, dll) agar request lewat MeAI.

1. Pilih tool → `Connect`.
2. Restart tool bila diperlukan.
3. Cek indikator status di kartu tool.

Konfigurasi yang ditulis memakai key MeAI yang aktif. Jangan menampilkan isi
file config mentah di log/laporan karena memuat kredensial.

---

## 10. Endpoint & API key

- `Base URL` default: `http://127.0.0.1:20128/v1`
- Format yang didukung: OpenAI (`/v1/chat/completions`), Claude
  (`/v1/messages`), dan format lain sesuai registry.
- Tunnel publik hanya untuk akses dari luar mesin; jangan dipakai untuk
  trafik lokal.
- Setiap client sebaiknya punya API key sendiri agar bisa dicabut terpisah.

---

## 11. Keamanan

- Ganti password default (`123456`) sebelum expose ke jaringan.
- Dashboard memakai cookie `auth_token`, bukan localStorage.
- API key provider disimpan di DB; jangan membagikan DB/backup mentah.
- `custom-server.js` menolak `X-Forwarded-For` dari non-loopback; jangan
  mengubah perilaku ini saat menambah reverse proxy.

---

## 12. Troubleshooting cepat

| Gejala | Penyebab | Solusi |
|---|---|---|
| `400/11128` CodeBuddy Intl | Header official-client hilang/dibuang proxy | Pastikan build terbaru; cek proxy yang memodifikasi header |
| `403/11140` CodeBuddy Intl | Akun dibatasi provider (unusual activity) | Tunggu review / appeal official client; pakai `cbcn/<model>` sementara |
| Check-in CodeBuddy 403 | API key tidak diizinkan klaim | Status tetap terbaca; klaim hanya lewat official client (X-Device-Token) |
| `404 No active credentials` | Prefix model salah / provider belum connected | Cek `GET /v1/models`, tambah koneksi |
| `429` | Key/model kena limit | MeAI pindah key otomatis; cek Quota Tracker |
| `401` | Token/key expired | Reconnect / update key |
| Quota tidak berubah | Cache 5 detik / provider error | Klik `Refresh` (force), cek Console Log |
| `505` saat idle | Keep-alive proxy | Transien; data stale tetap ditampilkan |
| Kartu quota kosong | Provider error total | Cek Console Log, coba Refresh |

Untuk masalah yang menetap, salin `requestId` dari Console Log saat melapor.

---

## 13. Update upstream: rebuild ≠ update

- Tombol **Rebuild saja** hanya menjalankan `npm run build` + restart service
  dari kode yang **sudah ada**. Itu tidak mengambil commit upstream; badge
  “N patch upstream” akan tetap muncul.
- Tombol **Update & Build** menjalankan `meai-upstream-apply.sh`: fetch
  upstream, cherry-pick patch yang aman, build, restart, lalu health check.
  Patch yang menyentuh file kustom fork ditandai review-manual dan tidak
  dipaksa.
- Status `done: applied=0` berarti **tidak ada commit yang diterapkan** —
  biasanya karena yang ditekan adalah Rebuild, bukan Update.
- Jika badge tetap muncul setelah Update, buka Console Log / status; patch
  yang gagal akan tampil sebagai `review` atau `conflict`, bukan diterapkan
  diam-diam.
- Setelah semua patch diterapkan/di-whitelist dengan alasan, `/api/upstream`
  mengembalikan `behind: 0` dan badge berubah menjadi “fork up-to-date”.

---

## 14. Checklist verifikasi rilis

- [ ] `bash ~/.hermes/tests/meai/gate-eslint.sh` → 0 error baru
- [ ] `bash ~/.hermes/tests/meai/gate-unit.sh` → 0 regresi baru
- [ ] `bash ~/.hermes/tests/meai/gate-baseline.sh` → provider/alias/OAuth snapshot cocok
- [ ] Build produksi sukses + `systemctl --user restart meai.service`
- [ ] `/api/healthz` → `ok:true`
- [ ] Halaman baru `/dashboard/guide` render di 360/414/768/1280 px
- [ ] Quota CodeBuddy CN menampilkan `Monthly 0/500` (bukan 500/500)
- [ ] Quota OpenCode Zen menampilkan Rolling/Weekly/Monthly
- [ ] Xiaomi Token Plan menampilkan self-tracked saat cookie expired
