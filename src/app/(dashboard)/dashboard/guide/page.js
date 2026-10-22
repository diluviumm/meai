"use client";

import { useMemo, useRef, useState } from "react";
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
      "Buka Providers → pilih provider → Add Connection. Untuk provider OAuth, klik Connect with OAuth dan selesaikan login di browser.",
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
      "Gunakan tombol show/hide expired untuk menyembunyikan paket lama.",
    ],
    tip: "Kalau provider membalas 505/error sementara, MeAI menampilkan data terakhir yang masih segar (stale) alih-alih mengosongkan kartu.",
    href: "/dashboard/quota",
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
    tip: "Error 11128 CodeBuddy Intl berarti kredensial API key tidak punya izin chat — gunakan OAuth.",
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
      "400/11128 CodeBuddy Intl → API key tidak punya izin chat; reconnect lewat OAuth.",
      "404 No active credentials → prefix model salah atau provider belum punya koneksi aktif.",
      "429 → key/model kena limit; MeAI otomatis pindah key. Cek Quota Tracker untuk waktu reset.",
      "401 → token/key expired; reconnect atau update key.",
      "Quota tidak berubah → klik Refresh (force), cek Console Log untuk error upstream.",
    ],
    tip: "Untuk masalah yang menetap, buka Console Log dan salin requestId error saat melapor.",
    href: "/dashboard/console-log",
  },
];

const FAQ = [
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
    a: "Bonus pack adalah kredit sekali pakai. Yang sudah expired/habis tetap dikirim provider; MeAI sekarang menyembunyikannya di balik tombol 'show expired' agar paket aktif dan paket mendatang terlihat lebih dulu.",
  },
  {
    q: "Apakah API key CodeBuddy Intl bisa dipakai untuk chat?",
    a: "Tidak. Gateway chat www.codebuddy.ai memverifikasi channel client resmi dan menolak API key dengan 400/11128. API key tetap bisa membaca quota. Gunakan OAuth untuk chat.",
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
  const searchRef = useRef(null);

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
            ref={searchRef}
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
