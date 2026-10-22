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
3. Pilih strategi `fallback` atau `round-robin`.
4. Panggil combo sebagai nama model di `/v1`.

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
| `Bonus Pack N` | Kredit sekali pakai | `Capacity*`, expiry = `CycleEndTime` |

- Paket bonus yang sudah expired **tetap dikirim provider**. Dashboard
  menyembunyikannya di balik tombol `show N expired` agar paket aktif dan paket
  mendatang terlihat lebih dulu.
- Baris `expired` diberi badge dan tidak dihitung dalam rata-rata sisa.

**Bonus harian otomatis (OAuth):** CodeBuddy memberi 100 kredit/hari (1000 pada
hari ke-7) lewat `POST /billing/meter/daily-checkin`. MeAI mengklaimnya otomatis
maksimal sekali sehari per koneksi OAuth sebelum membaca quota, jadi paket baru
langsung muncul. Koneksi **API key tidak bisa** check-in — gateway membalas
`403 API key not allowed for this path or method`; itu sebabnya bonus harian
tidak bertambah pada koneksi API key.

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

---

## 8. CodeBuddy Intl dan error 11128

Gejala:

```
HTTP 400 {"code":11128,"msg":"request illegal", ...}
"channel verification, possibly because it was not sent from an official client"
```

Artinya gateway chat `www.codebuddy.ai` menolak request karena kredensial
**API key** tidak punya izin channel chat. Ini bukan bug request body:

- Body sudah memakai `system` pertama, `developer` dinormalisasi, dan
  `tool_choice` string.
- Header resmi (UA, `X-Product`, `X-IDE-*`, `Origin`, `Referer`,
  `x-codebuddy-request`) sudah dicoba — tetap `11128`.
- API key yang sama **berhasil** untuk endpoint billing/quota, dan **gagal**
  juga saat dipakai oleh CLI resmi (`403 request illegal`).

Kesimpulan: API key tersebut valid untuk quota, tetapi **tidak punya izin
chat**. Perbaikan yang dilakukan MeAI:

1. Provider notice + pesan error yang menjelaskan langkah perbaikannya.
2. `parseError` memetakan `11128` menjadi pesan actionable (bukan dump JSON).
3. Urutan auth mode diubah ke **OAuth first**; OAuth adalah kredensial yang
   diterima gateway chat.

**Yang harus dilakukan pengguna:** buat koneksi CodeBuddy Intl baru lewat
`Connect with OAuth` (bukan API key), lalu gunakan koneksi OAuth itu untuk chat.
Koneksi API key boleh tetap ada untuk membaca quota.

> Catatan: `codebuddy.ai` (intl) dan `copilot.tencent.com` (CN) adalah region
> berbeda. Key CN tidak berlaku di intl, dan sebaliknya.

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
| `400/11128` CodeBuddy Intl | API key tidak punya izin chat | Reconnect lewat OAuth |
| `404 No active credentials` | Prefix model salah / provider belum connected | Cek `GET /v1/models`, tambah koneksi |
| `429` | Key/model kena limit | MeAI pindah key otomatis; cek Quota Tracker |
| `401` | Token/key expired | Reconnect / update key |
| Quota tidak berubah | Cache 5 detik / provider error | Klik `Refresh` (force), cek Console Log |
| `505` saat idle | Keep-alive proxy | Transien; data stale tetap ditampilkan |
| Kartu quota kosong | Provider error total | Cek Console Log, coba Refresh |

Untuk masalah yang menetap, salin `requestId` dari Console Log saat melapor.

---

## 13. Checklist verifikasi rilis

- [ ] `bash ~/.hermes/tests/meai/gate-eslint.sh` → 0 error baru
- [ ] `bash ~/.hermes/tests/meai/gate-unit.sh` → 0 regresi baru
- [ ] `bash ~/.hermes/tests/meai/gate-baseline.sh` → provider/alias/OAuth snapshot cocok
- [ ] Build produksi sukses + `systemctl --user restart meai.service`
- [ ] `/api/healthz` → `ok:true`
- [ ] Halaman baru `/dashboard/guide` render di 360/414/768/1280 px
- [ ] Quota CodeBuddy CN menampilkan `Monthly 0/500` (bukan 500/500)
- [ ] Quota OpenCode Zen menampilkan Rolling/Weekly/Monthly
- [ ] Xiaomi Token Plan menampilkan self-tracked saat cookie expired
