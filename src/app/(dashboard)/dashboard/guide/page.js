"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Card from "@/shared/components/Card";

/**
 * In-app feature guide.
 *
 * One searchable place that explains every dashboard surface, how to use it,
 * and the failure modes that used to require reading source code (CodeBuddy
 * 11128, quota packs, round-robin vs fallback, model prefixes, ...).
 */

const CATEGORIES = [
  { id: "all", label: "Semua", icon: "apps" },
  { id: "mulai", label: "Mulai", icon: "rocket_launch" },
  { id: "provider", label: "Provider", icon: "dns" },
  { id: "routing", label: "Routing", icon: "alt_route" },
  { id: "monitor", label: "Monitor", icon: "monitoring" },
  { id: "integrasi", label: "Integrasi", icon: "terminal" },
  { id: "keamanan", label: "Keamanan", icon: "shield" },
];

const FEATURES = [
  {
    id: "quick-start",
    category: "mulai",
    icon: "rocket_launch",
    title: "Quick start — 3 langkah",
    summary:
      "Dari nol sampai request pertama: sambungkan provider, buat API key MeAI, lalu arahkan client ke endpoint.",
    steps: [
      "Buka Providers → pilih provider → Add Connection. API key: tempel key provider, beri nama, lalu Test. OAuth hanya opsi tambahan bila provider memang membutuhkannya.",
      "Buka Endpoint & Key → buat API key MeAI. Key ini yang dipakai client (bukan key provider).",
      "Arahkan client ke Base URL MeAI + /v1, lalu panggil model dengan prefix provider, mis. cbcn/deepseek-v4.1-flash.",
    ],
    tip: "Kalau ragu prefix model, buka Endpoint & Key → daftar model, atau GET /v1/models.",
    href: "/dashboard/endpoint",
  },
  {
    id: "overview",
    category: "monitor",
    icon: "space_dashboard",
    title: "Overview",
    summary:
      "Ringkasan kesehatan gateway: request, token, biaya, provider aktif, dan tren periode berjalan.",
    steps: [
      "Pilih periode (Today / 7D / 30D) untuk melihat tren.",
      "Klik kartu provider untuk masuk ke detail koneksi dan quota.",
      "Gunakan angka delta untuk membandingkan periode sekarang vs periode sebelumnya.",
    ],
    tip: "Angka biaya dihitung dari pricing provider; model tanpa harga tampil sebagai $0, bukan gratis.",
    href: "/dashboard/overview",
  },
  {
    id: "providers",
    category: "provider",
    icon: "dns",
    title: "Providers & Connections",
    summary:
      "Satu provider bisa punya banyak koneksi (akun/key). Urutan prioritas menentukan koneksi mana yang dicoba lebih dulu.",
    steps: [
      "Providers → pilih provider → Add Connection.",
      "OAuth: klik Connect with OAuth. API key: tempel key provider, beri nama, lalu Test.",
      "Tambah beberapa koneksi untuk key cadangan; atur urutan dengan tombol panah prioritas.",
      "Aktifkan/nonaktifkan koneksi tanpa menghapus kredensialnya.",
    ],
    tip: "Koneksi yang error tidak dihapus otomatis; ia diberi cooldown per model lalu dicoba lagi setelah reset.",
    href: "/dashboard/providers",
  },
  {
    id: "multi-key",
    category: "provider",
    icon: "vpn_key",
    title: "Banyak API key: fallback otomatis",
    summary:
      "Perilaku yang Anda inginkan — key 1 limit → key 2 — sudah aktif secara bawaan. Tidak perlu Round Robin.",
    steps: [
      "Tambahkan key 1 dan key 2 sebagai dua Connection pada provider yang sama.",
      "Atur key 1 di prioritas atas (fill-first), key 2 di bawahnya.",
      "Saat key 1 kena 429/401/5xx, MeAI menandai key itu cooldown untuk model tersebut dan langsung retry ke key 2.",
      "Setelah cooldown habis, key 1 otomatis dipakai lagi.",
    ],
    tip: "Fallback bersifat per model: key bisa limit di satu model tetapi tetap dipakai untuk model lain.",
    href: "/dashboard/providers",
  },
  {
    id: "round-robin",
    category: "routing",
    icon: "alt_route",
    title: "Round Robin & Sticky",
    summary:
      "Round Robin membagi request bergiliran ke semua koneksi aktif. Sticky menentukan berapa request berturut-turut per koneksi sebelum pindah.",
    steps: [
      "Nyalakan Round Robin di halaman provider (atau atur global di Profile).",
      "Isi Sticky: 1 = pindah setiap request, 3 = tiga request per key lalu pindah.",
      "Biarkan Sticky kecil untuk penyebaran merata; besarkan bila ingin cache/afinitas per key.",
    ],
    tip: "Round Robin ≠ fallback. Fallback tetap berjalan di strategi mana pun; Round Robin hanya mengatur pembagian beban saat semua key sehat.",
    href: "/dashboard/providers",
  },
  {
    id: "combos",
    category: "routing",
    icon: "layers",
    title: "Combo & Vision Adapter",
    summary:
      "Rantai model cadangan: jika model pertama gagal, MeAI mencoba model berikutnya. Bisa juga dipakai untuk vision adapter.",
    steps: [
      "Buka Combo & Vision Adapter → New Combo.",
      "Tambahkan beberapa model dengan urutan fallback.",
      "Di model picker, cari dengan substring, exclusion (!kata atau -kata), atau regex (/pola/); contoh: claude -haiku.",
      "Gunakan Select All (N) / Deselect All (N) untuk menambah atau membuang semua model hasil filter sekaligus.",
      "Pilih strategi fallback atau round-robin.",
      "Panggil combo lewat /v1 dengan nama combo sebagai model.",
    ],
    tip: "Untuk client non-stream yang ketat (Hindsight, SDK pihak ketiga), panggil model langsung — combo mengirim SSE walau stream:false.",
    href: "/dashboard/combos",
  },
  {
    id: "usage",
    category: "monitor",
    icon: "bar_chart",
    title: "Usage & biaya",
    summary:
      "Statistik request, token, biaya, latency, dan breakdown per provider/model. Delta dibanding periode sebelumnya dihitung paralel.",
    steps: [
      "Pilih periode Today / 7D / 30D.",
      "Lihat kartu total dan grafik tren.",
      "Buka tab Request Details untuk melihat request individual dan biayanya.",
    ],
    tip: "prompt_tokens di respons klien sengaja ditambah buffer 2000 token; angka biaya memakai token asli dari DB.",
    href: "/dashboard/usage",
  },
  {
    id: "quota",
    category: "monitor",
    icon: "data_usage",
    title: "Quota Tracker",
    summary:
      "Memantau sisa kuota provider (CodeBuddy, OpenCode, Xiaomi, Claude, Codex, dll). Auto-refresh default aktif; tombol Refresh memaksa bypass cache.",
    steps: [
      "Buka Quota Tracker. Kartu per koneksi menampilkan bar sisa, used/total, dan waktu reset.",
      "Klik Refresh untuk memaksa ambil data terbaru (cache normal 5 detik).",
      "Untuk CodeBuddy: paket Monthly = allowance berulang; Bonus Pack = kredit sekali pakai yang ditandai expired saat habis.",
      "Semua paket ditampilkan (aktif lebih dulu, expired diberi badge); tombol hide expired hanya menyembunyikan riwayat, bukan menghapus data.",
      "Jika ada baris yang pernah disembunyikan, bagian Hidden punya tombol Show all (N) untuk menampilkan semuanya sekaligus.",
      "Panel Check-in menunjukkan streak, kredit hari ini, dan status klaim — read-only untuk koneksi API key.",
      "Sparkline sisa quota muncul setelah ≥2 sampel (1 sampel/menit, riwayat tersimpan di SQLite server ±7 hari); label ≈Nd left adalah forecast burn-rate setelah ≥12 menit data.",
    ],
    tip: "Bonus pack tidak bertambah otomatis hanya karena halaman dibuka. Paket baru datang dari kampanye provider atau check-in; klaim check-in dibatasi gateway untuk API key (403).",
    href: "/dashboard/quota",
  },
  {
    id: "quota-history",
    category: "monitor",
    icon: "timeline",
    title: "Riwayat quota & burn forecast",
    summary:
      "Halaman Riwayat menampilkan sampel SQLite lintas device, filter koneksi, zoom 1 jam / 24 jam / 7 hari, dan perbandingan dua koneksi.",
    steps: [
      "Buka Quota Tracker → Riwayat (atau /dashboard/quota/history).",
      "Pilih koneksi utama; pilih koneksi kedua untuk membandingkan dua garis.",
      "Pilih rentang dan nama kuota. Arahkan kursor ke titik untuk melihat waktu, sisa %, dan used/total.",
      "Baca label forecast: ≈Nd left = habis, resets/expires = window reset lebih dulu. Keyakinan low/medium/high dihitung dari jumlah sampel dan rentang waktu.",
      "Gunakan Purge pada kartu koneksi untuk menghapus riwayat koneksi itu; retensi default 7 hari dan dapat diubah lewat MEAI_QUOTA_HISTORY_RETENTION_DAYS.",
    ],
    tip: "Sampler latar belakang bersifat opt-in: buat ~/.hermes/state/meai-quota-sampler.enabled agar timer 15 menit mengisi riwayat tanpa dashboard terbuka. Tanpa marker, tidak ada panggilan provider tambahan.",
    href: "/dashboard/quota/history",
  },
  {
    id: "budget",
    category: "monitor",
    icon: "payments",
    title: "Budget per koneksi / API key",
    summary:
      "Setiap koneksi (yang membawa satu API key upstream) bisa punya ambang biaya harian sendiri; alert dikirim saat 80% dan 100%.",
    steps: [
      "Buka Quota → Riwayat → Budget per koneksi.",
      "Isi nominal USD per hari pada koneksi yang ingin dipantau, lalu Simpan.",
      "Alert memakai /api/usage/stats?period=today dan dikirim ke grup WA oleh timer budget; satu alert per level per hari.",
      "Kosongkan input lalu Simpan untuk menghapus ambang.",
    ],
    tip: "Budget global lama (costBudgetDaily) tetap berjalan. Budget koneksi tidak memotong request; ini peringatan, bukan hard limit.",
    href: "/dashboard/quota/history",
  },
  {
    id: "picker",
    category: "integrasi",
    icon: "checklist",
    title: "Model picker: preset, keyboard, rentang",
    summary:
      "Pemilih model punya preset Free / No embed / Claude -haiku, pencarian regex dan negasi, shortcut /, serta Shift+click untuk memilih rentang.",
    steps: [
      "Klik preset untuk mengisi query dengan satu klik; klik lagi query yang sama untuk kembali mengetik manual.",
      "Tekan / di mana pun di modal untuk fokus ke kotak pencarian; Escape mengosongkan query.",
      "Klik model pertama, lalu Shift+click model terakhir untuk memilih semua model di antaranya.",
      "Gunakan + all pada header provider untuk menambahkan semua model provider itu yang belum terpilih.",
    ],
    tip: "Preset hanya mengubah query pencarian; tidak mengubah model yang sudah dipilih. Shift+click memakai urutan model yang terlihat setelah filter.",
    href: "/dashboard/combos",
  },
  {
    id: "combo-reorder",
    category: "integrasi",
    icon: "reorder",
    title: "Reorder combo: drag atau tombol",
    summary:
      "Urutan model dalam combo menentukan fallback. Drag handle di kiri baris, atau pakai tombol naik/turun untuk perubahan satu langkah.",
    steps: [
      "Buka Combos → edit combo.",
      "Tarik ikon drag_indicator ke posisi baru; urutan langsung berubah.",
      "Alternatif presisi: tombol ↑/↓. Urutan disimpan saat combo disimpan.",
    ],
    tip: "Drag tidak menyalin model; ia hanya memindahkan baris. Model duplikat tetap ditolak.",
    href: "/dashboard/combos",
  },

  {
    id: "insights",
    category: "monitor",
    icon: "monitoring",
    title: "Insights & Health",
    summary:
      "Health score, leaderboard latency/biaya/cache, anomaly burn per koneksi & per key, rate-limit heatmap, forecast pacing, quota expiry, SLO, fairness, pricing audit, live SSE, notifikasi, matriks provider, export JSON, dan combo simulator.",
    steps: [
      "Buka Insights & Health dari sidebar.",
      "Baca health score 0–100 (success, 429, p95), leaderboard model, dan heatmap 429 per key/jam.",
      "Pantau Forecast & SLO: spend hari ini vs budget, projected akhir hari, p95 SLO, fairness, DB size.",
      "Pilih periode 1 jam / 24 jam / 7 hari, atur auto-refresh, cari/urutkan leaderboard.",
      "Lihat Quota expiry forecast, per-key burn anomaly, pricing audit, notification center, dan provider matrix.",
      "Buka Optimizer untuk token efficiency, saran optimasi, timeline, reset calendar, umur API key.",
      "Gunakan Export JSON/CSV, Simpan view, badge LIVE, dan command palette Ctrl/⌘ K.",
      "Atur quiet hours; pilih combo lalu Simulasikan untuk dry-run fallback/health/capability.",
    ],
    tip: "Health score bersifat advisory; routing aktual tetap mengikuti urutan combo. Status automation dibaca dari file state nyata (compaction, restore drill, catalog diff, WCAG), bukan dummy. Ctrl/⌘ K membuka command palette.",
    href: "/dashboard/insights",
  },
  {
    id: "governance",
    category: "monitor",
    icon: "policy",
    title: "Governance & Safety",
    summary:
      "12 pemeriksaan: self-check, backup inventory, config drift, combo inventory, circuit/cooldown, rate advice, deprecation radar, capability coverage, budget confidence, cost allocation, webhook readiness, performance.",
    steps: [
      "Buka Governance & Safety dari sidebar.",
      "Klik Snapshot config untuk membuat baseline drift.",
      "Pantau panel 3 (drift), 5 (circuit), 9 (budget confidence), dan 11 (webhook).",
      "Backup inventory menampilkan file SQLite terbaru di ~/.meai/db.",
      "Perbaiki item berwarna amber/merah sebelum mengubah routing.",
    ],
    tip: "Snapshot config hanya membaca settings dan menulis file baseline; tidak mengubah konfigurasi aktif.",
    href: "/dashboard/governance",
  },
  {
    id: "cli-tools",
    category: "integrasi",
    icon: "terminal",
    title: "CLI Tools",
    summary:
      "Sambungkan Claude Code, Codex, Cursor, Cline, OpenCode, dan tool lain ke MeAI dengan satu klik.",
    steps: [
      "Buka CLI Tools → pilih tool.",
      "Klik Connect; MeAI menulis konfigurasi tool ke file yang benar.",
      "Jalankan tool seperti biasa — request akan lewat MeAI.",
    ],
    tip: "Beberapa tool butuh restart setelah config ditulis. Cek indikator status di kartu tool.",
    href: "/dashboard/cli-tools",
  },
  {
    id: "endpoint",
    category: "integrasi",
    icon: "api",
    title: "Endpoint & API key",
    summary:
      "Base URL OpenAI-compatible, key MeAI, dan tunnel publik. Semua client memakai key MeAI, bukan key provider.",
    steps: [
      "Buka Endpoint & Key.",
      "Salin Base URL (mis. http://127.0.0.1:20128/v1) dan API key.",
      "Gunakan endpoint /v1/chat/completions (OpenAI), /v1/messages (Claude), atau endpoint format lain yang didukung.",
    ],
    tip: "Jangan pakai URL tunnel untuk trafik lokal; tunnel hanya untuk akses dari luar mesin.",
    href: "/dashboard/endpoint",
  },
  {
    id: "models",
    category: "integrasi",
    icon: "model_training",
    title: "Model & prefix provider",
    summary:
      "Model dipanggil sebagai provider/model (mis. cbcn/deepseek-v4.1-flash). Prefix mencegah tabrakan nama antar provider.",
    steps: [
      "Lihat daftar model di Endpoint & Key atau GET /v1/models.",
      "Pakai prefix provider untuk memilih jalur yang pasti.",
      "Sembunyikan model yang tidak dipakai lewat pengaturan disabled models (tidak menghapus katalog).",
    ],
    tip: "Tanpa prefix, model dicari di provider default; 404 'No active credentials' biasanya berarti prefix salah atau provider belum connected.",
    href: "/dashboard/endpoint",
  },
  {
    id: "console-log",
    category: "monitor",
    icon: "receipt_long",
    title: "Console Log",
    summary:
      "Log request real-time: model, status, latency, dan pesan error upstream. Tempat pertama untuk debugging.",
    steps: [
      "Buka Console Log.",
      "Cari request yang gagal berdasarkan model atau status.",
      "Baca baris URL + body error untuk melihat respons upstream asli.",
    ],
    tip: "Error 11128 = header official-client hilang/dibuang proxy; build ini sudah mengirim X-Conversation-*/X-API-Key. Error 11140 = akun dibatasi provider (unusual activity), bukan masalah OAuth.",
    href: "/dashboard/console-log",
  },
  {
    id: "security",
    category: "keamanan",
    icon: "shield",
    title: "Keamanan & password",
    summary:
      "Dashboard dilindungi cookie auth_token, API key MeAI, dan rate limit. Ganti password default sebelum expose ke jaringan.",
    steps: [
      "Ganti password default (123456) di Profile.",
      "Buat API key terpisah untuk tiap client agar bisa dicabut sendiri.",
      "Jangan expose port 20128 ke internet tanpa tunnel + password kuat.",
    ],
    tip: "API key provider disimpan terenkripsi di DB; jangan pernah membagikan file DB atau backup mentah.",
    href: "/dashboard/profile",
  },
  {
    id: "troubleshooting",
    category: "mulai",
    icon: "build",
    title: "Troubleshooting cepat",
    summary:
      "Pola error yang paling sering muncul dan langkah perbaikannya.",
    steps: [
      "400/11128 CodeBuddy Intl → header official-client hilang atau dibuang proxy; pastikan request tidak dimodifikasi. Build ini sudah mengirim X-Conversation-*/X-API-Key.",
      "403/11140 CodeBuddy Intl → akun dibatasi provider karena unusual activity; quota tetap terbaca, chat pulih setelah pembatasan berakhir atau lewat appeal di official client.",
      "404 No active credentials → prefix model salah atau provider belum punya koneksi aktif.",
      "429 → key/model kena limit; MeAI otomatis pindah key. Cek Quota Tracker untuk waktu reset.",
      "401 → token/key expired; reconnect atau update key.",
      "Quota tidak berubah → klik Refresh (force), cek Console Log untuk error upstream.",
      "Bonus pack CodeBuddy berkurang → pack sekali pakai kedaluwarsa; cek panel Check-in untuk status hari ini (klaim API key ditolak gateway).",
    ],
    tip: "Untuk masalah yang menetap, buka Console Log dan salin requestId error saat melapor.",
    href: "/dashboard/console-log",
  },
];

const FAQ = [
  {
    q: "Apa arti confidence low/medium/high pada forecast quota?",
    a: "Confidence dihitung dari jumlah sampel dan rentang waktu: high jika ≥10 sampel dan ≥2 jam, medium jika ≥4 sampel dan ≥30 menit, selain itu low. Forecast tetap ditampilkan jika data cukup, tetapi label confidence mengingatkan bahwa estimasi burn-rate bisa berubah. Reset/expiry yang lebih dulu akan mengalahkan proyeksi habis.",
  },
  {
    q: "Kenapa riwayat quota kosong padahal dashboard pernah dibuka?",
    a: "Sampel ditulis saat route /api/usage dipanggil. Jika dashboard ditutup, tidak ada panggilan baru kecuali sampler latar belakang diaktifkan. Buat file ~/.hermes/state/meai-quota-sampler.enabled; timer 15 menit akan mengambil sampel dari semua koneksi aktif tanpa membuka browser. Tanpa marker, sampler sengaja tidak melakukan panggilan provider.",
  },
  {
    q: "Apakah Purge menghapus data quota provider?",
    a: "Tidak. Purge hanya menghapus baris riwayat lokal (tabel quotaHistory) untuk satu koneksi; kuota, bonus pack, dan koneksi upstream tidak berubah. Pengambilan quota berikutnya akan membuat baris baru.",
  },
  {
    q: "Apakah budget per koneksi memblokir request?",
    a: "Tidak. Budget per koneksi adalah peringatan: bar dan notifikasi saat 80% / 100%, bukan hard limit. Budget global costBudgetDaily juga tetap berupa peringatan. Untuk menghentikan pemakaian, nonaktifkan koneksi atau hapus key di provider.",
  },
  {
    q: "Bagaimana memilih semua model dari satu provider?",
    a: "Di model picker, klik + all pada header provider. Ini menambahkan semua model provider yang terlihat dan belum dipilih. Wildcard literal provider/* tidak dipakai karena resolver combo memakai nama model eksplisit; + all memberi hasil yang sama tanpa entri wildcard yang tidak bisa di-resolve.",
  },
  {
    q: "Apakah drag reorder combo mengubah fallback?",
    a: "Ya. Urutan baris adalah urutan percobaan: model paling atas dicoba lebih dulu, lalu turun ke bawah. Drag dan tombol ↑/↓ mengubah urutan yang sama; simpan combo agar perubahan berlaku.",
  },
  {
    q: "Apakah Round Robin Sticky itu fallback API key?",
    a: "Bukan. Round Robin = pembagian beban bergiliran. Fallback = perpindahan otomatis saat key gagal (limit/401/5xx), dan fallback selalu aktif di strategi apa pun. Untuk perilaku 'key 1 limit → key 2', cukup tambahkan beberapa koneksi; tidak perlu menyalakan Round Robin.",
  },
  {
    q: "Kenapa CodeBuddy CN menampilkan Monthly 500/500 padahal belum dipakai?",
    a: "Itu bug pembacaan field CycleCapacity. Sejak perbaikan 22 Okt 2026, MeAI memakai field Capacity untuk paket subscription dan memvalidasi used/total terhadap remain; paket baru tampil 0/500.",
  },
  {
    q: "Kenapa Bonus Pack CodeBuddy berkurang?",
    a: "Bonus pack adalah kredit sekali pakai. Banyak paket kampanye punya masa berlaku pendek di ExpiredTime (mis. 5 hari) meskipun CycleEndTime-nya terlihat berbulan-bulan; setelah ExpiredTime lewat, provider mengirim Status=3 dan CapacityUsed=100 sebagai penanda mati. MeAI sekarang memakai ExpiredTime sebagai expiry dan menampilkan semua paket (aktif lebih dulu), jadi riwayat tidak terlihat hilang.",
  },
  {
    q: "Bisakah check-in CodeBuddy dilakukan dengan API key?",
    a: "Tidak. Endpoint /billing/meter/daily-checkin menolak API key dengan 403 'API key not allowed for this path or method'. Yang bisa dibaca dengan API key adalah status check-in (/checkin-activity-status), dan MeAI menampilkannya di kartu quota. Klaim hanya bisa lewat client resmi/OAuth; client resmi mengirim X-Device-Token dari security SDK yang tidak bisa dibuat dari API key (proyek open-source seperti magpie menandai kondisi ini 'own-app' dan menyuruh check-in di app resmi). Tidak ada header atau trik API key yang membuka endpoint ini.",
  },
  {
    q: "Kenapa sparkline/forecast quota kosong?",
    a: "Sparkline butuh minimal 2 sampel dan forecast butuh rentang ≥12 menit. MeAI mencatat 1 sampel/menit ke tabel SQLite server (dibagi lintas device), retensi 7 hari; buka halaman Quota beberapa menit lalu refresh. Jika endpoint riwayat gagal, browser memakai riwayat lokal sebagai fallback. Jika quota reset (used turun), seri lama dibuang agar burn-rate tidak negatif.",
  },
  {
    q: "Apakah API key CodeBuddy Intl bisa dipakai untuk chat?",
    a: "Ya, API key tetap jalur utama. Gateway intl meminta header official-client X-Conversation-*/X-API-Key/X-User-Id; build ini sudah mengirimkannya. Jika muncul 11128, header dibuang proxy. Jika muncul 11140, akun sedang dibatasi provider karena unusual activity — bukan masalah OAuth; quota tetap terbaca. Pembatasan ini account-level: tidak ada header/bypass yang aman. Pulihkan lewat appeal 'Submit feedback' di official client, tunggu review, atau pakai API key akun lain; selama menunggu gunakan model yang sama lewat cbcn/*.",
  },
];

function matchesQuery(feature, query) {
  if (!query) return true;
  const haystack = [
    feature.title,
    feature.summary,
    feature.tip,
    ...(feature.steps || []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function GuideCard({ feature, index }) {
  return (
    <Card
      hover
      padding="md"
      id={feature.id}
      className="group fade-in flex h-full scroll-mt-24 flex-col gap-3"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms`, animationFillMode: "both" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[22px]">{feature.icon}</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{feature.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{feature.summary}</p>
        </div>
      </div>

      <details className="group/details mt-auto rounded-lg border border-border-subtle bg-surface-2/40 px-3 py-2">
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-text-primary">
          Cara pakai
        </summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-text-muted">
          {feature.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {feature.tip && (
          <p className="mt-2 rounded-md bg-primary/5 px-2 py-1.5 text-[11px] leading-relaxed text-text-muted">
            <span className="font-semibold text-primary">Tips: </span>
            {feature.tip}
          </p>
        )}
      </details>

      <Link
        href={feature.href}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary transition-transform group-hover:translate-x-0.5"
      >
        Buka halaman
        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
      </Link>
    </Card>
  );
}

export default function GuidePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return FEATURES.filter((feature) => {
      const categoryOk = category === "all" || feature.category === category;
      return categoryOk && matchesQuery(feature, normalizedQuery);
    });
  }, [category, normalizedQuery]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border-subtle bg-gradient-to-br from-primary/15 via-surface to-surface p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-10 size-56 rounded-full bg-brand-500/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
            <span className="material-symbols-outlined text-[15px]">menu_book</span>
            Panduan fitur MeAI
          </div>
          <h1 className="max-w-3xl text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Semua fitur, cara pakai, dan jebakan umum — dalam satu tempat.
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-text-muted">
            Cari fitur, buka langkah pemakaian, lalu langsung menuju halamannya. Ditulis
            untuk pemakaian sehari-hari: provider, multi-key fallback, Round Robin Sticky,
            combo, usage, quota tracker, CLI tools, dan keamanan.
          </p>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-text-muted">
            {["OpenAI-compatible", "OAuth + API key", "Quota tracker", "Combo fallback", "Mobile-friendly"].map((tag) => (
              <span key={tag} className="rounded-full border border-border-subtle bg-surface/70 px-2.5 py-1">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Search + categories */}
      <section className="flex flex-col gap-3">
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-text-muted">
            search
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Cari fitur… (mis. quota, fallback, oauth, 11128)"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-10 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted/70 focus:border-primary"
            aria-label="Cari fitur"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
              aria-label="Bersihkan pencarian"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((item) => {
            const active = category === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-primary/30 bg-primary/15 text-primary"
                    : "border-border-subtle bg-surface text-text-muted hover:border-primary/20 hover:text-text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Feature grid */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((feature, index) => (
          <GuideCard key={feature.id} feature={feature} index={index} />
        ))}
      </section>

      {filtered.length === 0 && (
        <Card padding="lg" className="text-center">
          <span className="material-symbols-outlined text-[32px] text-text-muted">search_off</span>
          <p className="mt-2 text-sm font-semibold text-text-primary">Tidak ada fitur yang cocok</p>
          <p className="mt-1 text-xs text-text-muted">
            Coba kata kunci lain, atau tekan{" "}
            <button
              type="button"
              className="font-semibold text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
            >
              reset filter
            </button>
            .
          </p>
        </Card>
      )}

      {/* FAQ */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Pertanyaan yang sering muncul</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5"
            >
              <summary className="cursor-pointer select-none text-xs font-semibold text-text-primary">
                {item.q}
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="pb-2 text-center text-[11px] text-text-muted">
        Panduan ini ikut ter-build bersama dashboard; setiap perilaku yang dijelaskan
        diverifikasi terhadap kode dan API live.
      </p>
    </div>
  );
}
