"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Overview (Ronde-42) — satu halaman pusat visualisasi:
//   KPI strip + hero area chart + top models + provider health
//   + budget radial + system status + latency distribution + aktivitas terakhir
// Sumber data: API yang SUDAH ada (usage/stats, usage/chart, providers/client,
// tunnel/status, settings) — tanpa endpoint baru, tanpa duplikasi perhitungan.
// Prinsip desain (riset 2026): hierarki jelas, delta+trend, sparkline,
// state loading/empty/error eksplisit, dark-first ikut token tema.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];
const REFRESH_MS = 30000;

// ── util ─────────────────────────────────────────────────────────────────────
const fmtInt = (n) =>
  n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);
const fmtUsd = (n) => (n == null ? "–" : n < 0.01 && n > 0 ? `<$0.01` : `$${n.toFixed(n >= 10 ? 2 : 4)}`);
const fmtMs = (ms) => (ms == null ? "–" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "–";
  }
};

/** Sparkline mini (SVG) — pola riset KPI card: tren sekilas dalam 60px. */
function Sparkline({ data, stroke = "var(--color-brand-500)" }) {
  const pts = useMemo(() => {
    const arr = (data || []).filter((v) => typeof v === "number");
    if (arr.length < 2) return "";
    const max = Math.max(...arr, 1);
    const min = Math.min(...arr, 0);
    const span = max - min || 1;
    return arr
      .map((v, i) => `${(i / (arr.length - 1)) * 100},${28 - ((v - min) / span) * 24}`)
      .join(" ");
  }, [data]);
  if (!pts) return <div className="h-[28px]" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-[28px] w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Kartu KPI: label + nilai + caption + sparkline. */
function Kpi({ label, value, caption, tone, series, title }) {
  const toneClass =
    tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-danger" : "text-text";
  return (
    <Card padding="sm" className="min-w-0" title={title ? undefined : undefined}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 min-h-[16px] text-[11px] text-text-muted">{caption}</div>
      <Sparkline data={series} />
    </Card>
  );
}

/** Tooltip recharts konsisten tema. */
function ThemeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-text">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-text-muted">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.stroke }} />
          <span>{p.name}:</span>
          <span className="font-semibold tabular-nums text-text">
            {p.dataKey === "cost" ? fmtUsd(p.value) : fmtInt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Donut radial budget (SVG murni — animasi halus via transition CSS). */
function BudgetRadial({ used, budget }) {
  const pct = budget > 0 ? Math.min(used / budget, 1) : 0;
  const over = budget > 0 && used > budget;
  const R = 52;
  const C = 2 * Math.PI * R;
  const tone = over ? "var(--color-danger, #cf222e)" : pct > 0.8 ? "var(--color-warning, #d97706)" : "var(--color-brand-500)";
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[130px] w-[130px] shrink-0">
        <svg viewBox="0 0 130 130" className="h-full w-full -rotate-90">
          <circle cx="65" cy="65" r={R} fill="none" className="stroke-surface-3" strokeWidth="12" />
          <circle
            cx="65"
            cy="65"
            r={R}
            fill="none"
            stroke={tone}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.22,1,.36,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tabular-nums text-text">{Math.round(pct * 100)}%</span>
          <span className="text-[10px] uppercase tracking-wide text-text-muted">budget</span>
        </div>
      </div>
      <div className="min-w-0 space-y-1.5 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-text-muted">Terpakai</span>
          <span className="font-semibold tabular-nums text-text">{fmtUsd(used)}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-text-muted">Anggaran/hari</span>
          <span className="font-semibold tabular-nums text-text">{budget > 0 ? fmtUsd(budget) : "belum diatur"}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-text-muted">Sisa</span>
          <span className={`font-semibold tabular-nums ${over ? "text-danger" : "text-success"}`}>
            {budget > 0 ? fmtUsd(Math.max(budget - used, 0)) : "–"}
            {over && " (lewat!)"}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-text-subtle">
          Anggaran diatur di Settings → Budget. Biaya bersifat estimasi (harga token default bila tarif asli tak tersedia).
        </p>
      </div>
    </div>
  );
}

/** Bar distribusi latensi p50 → p95. */
function LatencyBar({ p50, p95, samples }) {
  if (!samples) {
    return <p className="text-sm text-text-muted">Belum ada sampel latensi — terisi otomatis tiap request lewat gateway.</p>;
  }
  const scale = Math.max(p95, 1);
  const p50w = Math.min((p50 / scale) * 100, 100);
  return (
    <div className="space-y-2">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
          style={{ width: `${p50w}%`, transition: "width 700ms cubic-bezier(.22,1,.36,1)" }}
        />
        <div className="absolute inset-y-0 left-0 w-full rounded-full border-2 border-warning" style={{ opacity: 0.35 }} />
      </div>
      <div className="flex justify-between text-[11px] text-text-muted">
        <span>p50 <b className="tabular-nums text-text">{fmtMs(p50)}</b></span>
        <span>p95 <b className="tabular-nums text-text">{fmtMs(p95)}</b></span>
        <span>{samples} sampel</span>
      </div>
      <p className="text-[11px] leading-snug text-text-subtle">
        p95 = 95% request lebih cepat dari nilai ini (ekor distribusi yang dirasakan pengguna).
      </p>
    </div>
  );
}

// ── komponen utama ───────────────────────────────────────────────────────────
export default function OverviewPageClient() {
  const [period, setPeriod] = useState("today");
  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [conns, setConns] = useState(null); // providers/client
  const [tunnel, setTunnel] = useState(null);
  const [settings, setSettings] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(0); // ronde-38: Date.now() hanya setelah mount (anti hydration mismatch)

  const load = useCallback(
    async (silent = false) => {
      // setState setelah microtask: perpindahan periode menampilkan skeleton
      // tanpa memicu cascading render sinkron dari dalam effect (react-hooks).
      if (!silent) {
        await Promise.resolve();
        setLoading(true);
      }
      try {
        const [s, c, pc, t, se, h] = await Promise.all([
          fetch(`/api/usage/stats?period=${period}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/usage/chart?period=${period}`).then((r) => (r.ok ? r.json() : null)),
          fetch("/api/providers/client").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/tunnel/status").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/settings").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/healthz").then((r) => (r.ok ? r.json() : { ok: false })),
        ]);
        setStats(s);
        setChart(Array.isArray(c) ? c : []);
        setConns(pc);
        setTunnel(t);
        setSettings(se);
        setHealth(h);
        setErr(s ? "" : "Gagal memuat statistik — coba lagi.");
      } catch {
        setErr("Gagal terhubung ke gateway.");
      } finally {
        setLoading(false);
        setNow(Date.now());
      }
    },
    [period],
  );

  useEffect(() => {
    // Load awal via async IIFE — pola repo agar lolos react-hooks/set-state-in-effect;
    // interval tetap memakai load() silent (pemanggilan dari callback, bukan badan effect).
    let alive = true;
    (async () => {
      if (alive) await load();
    })();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [load]);

  // ── derivasi (semua dari data API, tanpa angka karangan) ──
  const sparkReq = useMemo(() => chart.map((d) => d.requests), [chart]);
  const sparkTok = useMemo(() => chart.map((d) => d.tokens), [chart]);
  const sparkCost = useMemo(() => chart.map((d) => d.cost), [chart]);
  const chartMax = useMemo(() => Math.max(...chart.map((d) => d.tokens), 1), [chart]);

  const topModels = useMemo(() => {
    if (!stats?.byModel) return [];
    return Object.entries(stats.byModel)
      .map(([name, v]) => ({
        name,
        requests: v.requests || 0,
        tokens: (v.promptTokens || 0) + (v.completionTokens || 0),
        cost: v.cost || 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 6);
  }, [stats]);
  const topMax = Math.max(...topModels.map((m) => m.tokens), 1);

  const connsList = useMemo(() => conns?.connections || [], [conns]);
  const activeConns = connsList.filter((c) => c.isActive);

  const budget = typeof settings?.costBudgetDaily === "number" ? settings.costBudgetDaily : 0;
  const used = stats?.totalCost || 0;

  const lat = stats?.latency || { p50: null, p95: null, samples: 0 };

  const recent = useMemo(() => (stats?.recentRequests || []).slice(0, 6), [stats]);

  const tunnelOn = Boolean(tunnel?.tunnel?.running);
  const gatewayOk = Boolean(health?.ok);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 sm:px-6">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text sm:text-2xl">Overview</h1>
          <p className="text-sm text-text-muted">
            Pusat kendali gateway — penggunaan, kesehatan provider, dan sistem dalam satu layar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              gatewayOk ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${gatewayOk ? "animate-pulse bg-success" : "bg-danger"}`} />
            {gatewayOk ? "Gateway Live" : "Gateway Down"}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-border-subtle bg-surface text-xs">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  period === p.value ? "bg-brand-500 text-white" : "text-text-muted hover:bg-surface-2"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {err}{" "}
          <button type="button" className="underline" onClick={() => load()}>
            Muat ulang
          </button>
        </div>
      )}

      {/* ── KPI strip ── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label="Requests"
          value={loading ? "…" : fmtInt(stats?.totalRequests)}
          caption={`periode ${PERIODS.find((p) => p.value === period)?.label}`}
          series={sparkReq}
        />
        <Kpi
          label="Tokens"
          value={loading ? "…" : fmtInt((stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0))}
          caption={`input ${fmtInt(stats?.totalPromptTokens)} · output ${fmtInt(stats?.totalCompletionTokens)}`}
          series={sparkTok}
        />
        <Kpi
          label="Est. Cost"
          value={loading ? "…" : fmtUsd(stats?.totalCost)}
          caption={budget > 0 ? `budget harian ${fmtUsd(budget)}` : "estimasi dari tarif token"}
          tone={budget > 0 && used > budget ? "bad" : undefined}
          series={sparkCost}
        />
        <Kpi
          label="p95 Latency"
          value={loading ? "…" : fmtMs(lat.p95)}
          caption={lat.samples ? `p50 ${fmtMs(lat.p50)} · ${lat.samples} sampel` : "belum ada sampel"}
          tone={lat.p95 == null ? undefined : lat.p95 < 5000 ? "good" : lat.p95 < 15000 ? "warn" : "bad"}
          title={`p95 ${fmtMs(lat.p95)} · p50 ${fmtMs(lat.p50)} · ${lat.samples} sampel`}
        />
        <Kpi
          label="Providers"
          value={loading ? "…" : `${activeConns.length}/${connsList.length}`}
          caption={`${connsList.filter((c) => c.testStatus === "available").length} teruji available`}
          tone={activeConns.length === 0 ? "bad" : undefined}
        />
      </section>

      {/* ── Hero chart ── */}
      <Card padding="sm" title="Penggunaan Gateway" subtitle="Token & request per interval — hover untuk detail"
        action={<span className="text-[11px] text-text-muted">puncak {fmtInt(chartMax)} token</span>}>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="gTok" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-text-subtle)" }} tickLine={false} minTickGap={28} />
              <YAxis
                yAxisId="tok"
                tick={{ fontSize: 10, fill: "var(--color-text-subtle)" }}
                tickLine={false}
                tickFormatter={fmtInt}
                width={52}
              />
              <YAxis yAxisId="req" orientation="right" tick={{ fontSize: 10, fill: "var(--color-text-subtle)" }} tickLine={false} tickFormatter={fmtInt} width={34} />
              <Tooltip content={<ThemeTooltip />} />
              <Area yAxisId="tok" type="monotone" dataKey="tokens" name="Tokens" stroke="var(--color-brand-500)" fill="url(#gTok)" strokeWidth={2} />
              <Line yAxisId="req" type="monotone" dataKey="requests" name="Requests" stroke="var(--color-success, #16a34a)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Top models + Provider health ── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padding="sm" title="Top Models" subtitle="Kontribusi token pada periode terpilih">
          {topModels.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Belum ada request pada periode ini.</p>
          ) : (
            <ul className="space-y-3">
              {topModels.map((m) => (
                <li key={m.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate font-medium text-text" title={m.name}>{m.name}</span>
                    <span className="shrink-0 tabular-nums text-text-muted">
                      {fmtInt(m.tokens)} tok · {fmtInt(m.requests)} req{m.cost > 0 ? ` · ${fmtUsd(m.cost)}` : ""}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600"
                      style={{ width: `${(m.tokens / topMax) * 100}%`, transition: "width 700ms cubic-bezier(.22,1,.36,1)" }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="sm" title="Provider Health" subtitle={`${activeConns.length} koneksi aktif dari ${connsList.length}`}>
          {connsList.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Belum ada koneksi provider.</p>
          ) : (
            <ul className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
              {connsList.map((c) => {
                const tone =
                  c.testStatus === "available"
                    ? "bg-success"
                    : c.testStatus === "unavailable"
                      ? "bg-danger"
                      : "bg-surface-3";
                return (
                  <li key={c.id} className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-surface-2/50 px-3 py-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-text">
                          {c.name || c.provider}
                          {!c.isActive && <span className="ml-1.5 font-normal text-text-muted">(nonaktif)</span>}
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-subtle">{c.provider}</span>
                      </div>
                      {c.lastError ? (
                        <p className="mt-0.5 truncate text-[11px] text-danger" title={c.lastError}>
                          {c.lastError}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {/* ── Budget radial + Latency ── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padding="sm" title="Budget Harian" subtitle="Estimasi biaya hari ini vs anggaran">
          <BudgetRadial used={used} budget={budget} />
        </Card>

        <Card padding="sm" title="Distribusi Latensi" subtitle="Sebaran waktu respons gateway">
          <LatencyBar p50={lat.p50} p95={lat.p95} samples={lat.samples} />
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border-subtle pt-3 text-center">
            <div>
              <div className="text-lg font-bold tabular-nums text-text">{fmtInt(stats?.totalRequests ?? null)}</div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted">requests</div>
            </div>
            <div>
              <div className={`text-lg font-bold tabular-nums ${tunnelOn ? "text-success" : "text-text-muted"}`}>
                {tunnelOn ? "ON" : "OFF"}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted">cloudflare tunnel</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums text-text">{recent.length ? fmtTime(recent[0]?.timestamp) : "–"}</div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted">request terakhir</div>
            </div>
          </div>
        </Card>
      </section>

      {/* ── Aktivitas terakhir ── */}
      <Card padding="sm" title="Aktivitas Terakhir" subtitle={`${recent.length} request terakhir tercatat`}>
        {recent.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">Belum ada aktivitas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-[10px] uppercase tracking-wide text-text-subtle">
                  <th className="py-2 pr-3 font-semibold">Waktu</th>
                  <th className="py-2 pr-3 font-semibold">Model</th>
                  <th className="py-2 pr-3 font-semibold">Provider</th>
                  <th className="py-2 pr-3 text-right font-semibold">Tokens</th>
                  <th className="py-2 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={`${r.timestamp}-${i}`} className="border-b border-border-subtle/50 last:border-0">
                    <td className="py-2 pr-3 tabular-nums text-text-muted">{fmtTime(r.timestamp)}</td>
                    <td className="max-w-[180px] truncate py-2 pr-3 font-medium text-text">{r.model || "–"}</td>
                    <td className="py-2 pr-3 text-text-muted">{r.provider || "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-text">
                      {fmtInt((r.promptTokens || 0) + (r.completionTokens || 0))}
                    </td>
                    <td className="py-2 text-right tabular-nums text-text">{r.cost > 0 ? fmtUsd(r.cost) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-text-subtle">
          Semua angka diambil langsung dari gateway — lihat panduan pemakaian di <code className="rounded bg-surface-2 px-1">docs/PANDUAN.md</code>.
        </p>
      </Card>
    </div>
  );
}
