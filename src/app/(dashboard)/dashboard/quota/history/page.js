"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { forecastQuota } from "../../usage/components/ProviderLimits/quotaHistory";

const RANGES = [
  { id: "1h", hours: 1, label: "1 jam" },
  { id: "24h", hours: 24, label: "24 jam" },
  { id: "7d", hours: 168, label: "7 hari" },
];
const COLORS = ["#14b8a6", "#8b5cf6"];

function linePath(samples, width, height, maxT, minT) {
  if (!samples?.length) return "";
  const span = Math.max(1, maxT - minT);
  return samples.map((sample, index) => {
    const x = samples.length === 1 ? width / 2 : ((sample.t - minT) / span) * width;
    const y = height - (Math.max(0, Math.min(100, sample.pct)) / 100) * (height - 10) - 5;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function pointY(sample, height) {
  return height - (Math.max(0, Math.min(100, sample.pct)) / 100) * (height - 10) - 5;
}

function QuotaHistoryChart({ seriesByConnection, rangeHours }) {
  const width = 820;
  const height = 260;
  const allSamples = Object.values(seriesByConnection).flat();
  if (allSamples.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
        Belum ada sampel untuk kuota ini pada rentang {rangeHours} jam.
      </div>
    );
  }
  const minT = Math.min(...allSamples.map((s) => s.t));
  const maxT = Math.max(...allSamples.map((s) => s.t));
  const paths = Object.entries(seriesByConnection).map(([id, samples], index) => ({
    id,
    samples,
    color: COLORS[index % COLORS.length],
    path: linePath(samples, width, height, maxT, minT),
  }));

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/60 bg-bg-subtle p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" role="img" aria-label="Grafik riwayat quota">
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = height - (pct / 100) * (height - 10) - 5;
          return (
            <g key={pct}>
              <line x1="0" y1={y} x2={width} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="4 4" />
              <text x="2" y={y - 2} fontSize="9" fill="currentColor" fillOpacity="0.45">{pct}%</text>
            </g>
          );
        })}
        {paths.map(({ id, samples, color, path }) => (
          <g key={id}>
            <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {samples.length === 1 && (
              <circle cx={width / 2} cy={pointY(samples[0], height)} r="3" fill={color} />
            )}
            {samples.map((sample) => (
              <circle
                key={`${id}-${sample.t}`}
                cx={((sample.t - minT) / Math.max(1, maxT - minT)) * width}
                cy={pointY(sample, height)}
                r="2"
                fill={color}
              >
                <title>{new Date(sample.t).toLocaleString()} · {sample.pct.toFixed(1)}% sisa · {sample.used}/{sample.total}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-text-muted">
        <span>{new Date(minT).toLocaleString()} → {new Date(maxT).toLocaleString()}</span>
        <span>{allSamples.length} sampel · sumbu Y = % sisa</span>
      </div>
    </div>
  );
}

export default function QuotaHistoryPage() {
  const [connections, setConnections] = useState([]);
  const [primary, setPrimary] = useState("");
  const [compare, setCompare] = useState("");
  const [range, setRange] = useState("24h");
  const [quotaName, setQuotaName] = useState("");
  const [histories, setHistories] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [budgetById, setBudgetById] = useState({});
  const [budgetDraft, setBudgetDraft] = useState({});
  const [todayStats, setTodayStats] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then((data) => {
        if (!alive) return;
        const active = (data.connections || []).filter((c) => c && c.isActive !== false);
        setConnections(active);
        setPrimary((current) => current || active[0]?.id || "");
        setCompare((current) => current || active[1]?.id || "");
      })
      .catch(() => alive && setError("Gagal memuat daftar koneksi"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/usage/stats?period=today").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([settings, stats]) => {
      if (!alive) return;
      const config = settings?.costBudgetByConnection && typeof settings.costBudgetByConnection === "object"
        ? settings.costBudgetByConnection
        : {};
      setBudgetById(config);
      setBudgetDraft(config);
      setTodayStats(stats);
    });
    return () => { alive = false; };
  }, []);

  const connectionSpend = useMemo(() => {
    const spend = {};
    for (const entry of Object.values(todayStats?.byAccount || {})) {
      if (!entry?.connectionId) continue;
      spend[entry.connectionId] = (spend[entry.connectionId] || 0) + (Number(entry.cost) || 0);
    }
    return spend;
  }, [todayStats]);

  const saveBudget = async (id) => {
    const raw = String(budgetDraft[id] ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setNotice("Budget harus angka ≥ 0 atau kosong.");
      return;
    }
    const next = { ...budgetById };
    if (value === null) delete next[id];
    else next[id] = value;
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costBudgetByConnection: next }),
    });
    if (!response.ok) {
      setNotice(`Gagal menyimpan budget (HTTP ${response.status}).`);
      return;
    }
    setBudgetById(next);
    setNotice(value === null ? "Budget koneksi dihapus." : `Budget koneksi disimpan: $${value.toFixed(2)}/hari.`);
  };

  useEffect(() => {
    if (!primary) return undefined;
    let alive = true;
    const hours = RANGES.find((r) => r.id === range)?.hours || 24;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading state for the newly selected range
    setLoading(true);
    setError("");
    const ids = [primary, compare].filter(Boolean);
    Promise.all(ids.map(async (id) => {
      const response = await fetch(`/api/usage/${encodeURIComponent(id)}/history?hours=${hours}&limit=500`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return [id, (await response.json()).series || {}];
    }))
      .then((entries) => {
        if (!alive) return;
        setHistories(Object.fromEntries(entries));
        const names = new Set();
        entries.forEach(([, series]) => Object.keys(series).forEach((name) => names.add(name)));
        setQuotaName((current) => (current && names.has(current) ? current : [...names][0] || ""));
      })
      .catch((err) => alive && setError(`Gagal memuat riwayat: ${err.message}`))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [primary, compare, range]);

  const quotaNames = useMemo(() => {
    const names = new Set();
    Object.values(histories).forEach((series) => Object.keys(series).forEach((name) => names.add(name)));
    return [...names].sort();
  }, [histories]);

  const seriesByConnection = useMemo(() => {
    if (!quotaName) return {};
    const out = {};
    for (const id of [primary, compare].filter(Boolean)) {
      if (histories[id]?.[quotaName]?.length) out[id] = histories[id][quotaName];
    }
    return out;
  }, [histories, primary, compare, quotaName]);

  const latest = useMemo(() => {
    const rows = [];
    for (const [id, samples] of Object.entries(seriesByConnection)) {
      const last = samples[samples.length - 1];
      if (!last) continue;
      const conn = connections.find((c) => c.id === id);
      rows.push({
        id,
        name: conn?.name || conn?.provider || id.slice(0, 8),
        last,
        forecast: forecastQuota({ used: last.used, total: last.total }, samples),
      });
    }
    return rows;
  }, [seriesByConnection, connections]);

  const purge = async (id) => {
    if (!id) return;
    if (!confirm("Hapus seluruh riwayat quota koneksi ini? Tindakan ini tidak bisa dibatalkan.")) return;
    const response = await fetch(`/api/usage/${encodeURIComponent(id)}/history`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data.error || `Gagal menghapus (HTTP ${response.status})`);
      return;
    }
    setNotice(`Riwayat dihapus: ${data.deleted || 0} baris.`);
    setHistories((prev) => ({ ...prev, [id]: {} }));
  };

  const rangeLabel = RANGES.find((r) => r.id === range)?.label || range;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-main">Riwayat Quota</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Sampel SQLite lintas device · filter provider, zoom rentang, dan bandingkan dua koneksi.
          </p>
        </div>
        <Link href="/dashboard/quota" className="text-xs font-medium text-primary hover:underline">
          ← Kembali ke Quota Tracker
        </Link>
      </div>

      <Card className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-[10px] text-text-muted">
            Koneksi utama
            <select value={primary} onChange={(event) => setPrimary(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text-main">
              {connections.map((conn) => <option key={conn.id} value={conn.id}>{conn.name || conn.provider}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-text-muted">
            Bandingkan dengan
            <select value={compare} onChange={(event) => setCompare(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text-main">
              <option value="">— tidak membandingkan —</option>
              {connections.filter((conn) => conn.id !== primary).map((conn) => <option key={conn.id} value={conn.id}>{conn.name || conn.provider}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-text-muted">
            Rentang
            <select value={range} onChange={(event) => setRange(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text-main">
              {RANGES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-text-muted">
            Kuota
            <select value={quotaName} onChange={(event) => setQuotaName(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text-main">
              {quotaNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>

        {error ? <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p> : null}
        {notice ? <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">{notice}</p> : null}

        <details className="rounded-xl border border-border/60 bg-bg-subtle p-2" open>
          <summary className="cursor-pointer px-1 text-[11px] font-semibold text-text-main">Budget per koneksi (hari ini)</summary>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {connections.map((conn) => {
              const spend = connectionSpend[conn.id] || 0;
              const budget = Number(budgetById[conn.id]) || 0;
              const pct = budget > 0 ? Math.min(100, (spend / budget) * 100) : 0;
              return (
                <div key={conn.id} className="rounded-lg border border-border/60 bg-surface p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-text-main">{conn.name || conn.provider}</span>
                    <span className={budget > 0 && spend >= budget ? "font-semibold text-danger" : "text-text-muted"}>
                      ${spend.toFixed(2)}{budget > 0 ? ` / $${budget.toFixed(2)}` : ""}
                    </span>
                  </div>
                  {budget > 0 ? (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className={`h-full rounded-full ${pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Budget $/hari"
                      value={budgetDraft[conn.id] ?? ""}
                      onChange={(event) => setBudgetDraft((prev) => ({ ...prev, [conn.id]: event.target.value }))}
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-[11px] text-text-main"
                    />
                    <Button variant="secondary" size="xs" onClick={() => saveBudget(conn.id)}>Simpan</Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-1 px-1 text-[10px] text-text-muted">
            Ambang ini dipakai alert budget per koneksi. Notifikasi dikirim maksimal sekali per tingkat per hari.
          </p>
        </details>

        {loading ? (
          <div className="h-56 animate-pulse rounded-xl bg-surface-2" />
        ) : (
          <QuotaHistoryChart seriesByConnection={seriesByConnection} rangeHours={RANGES.find((r) => r.id === range)?.hours || 24} />
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {latest.map((row, index) => (
            <div key={row.id} className="rounded-xl border border-border/60 bg-bg-subtle p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium text-text-main">
                  <span className="inline-block size-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  {row.name}
                </span>
                <Button variant="ghost" size="xs" onClick={() => purge(row.id)} title="Purge history koneksi ini">Purge</Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-text-muted">
                <span>{row.last.pct.toFixed(1)}% sisa</span>
                <span>{row.last.used} / {row.last.total}</span>
                <span>{new Date(row.last.t).toLocaleString()}</span>
              </div>
              {row.forecast ? (
                <div className="mt-1 text-[11px] text-text-muted" title={row.forecast.title}>
                  {row.forecast.short} · keyakinan <b>{row.forecast.confidence}</b> · {row.forecast.samples} sampel
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-text-muted">Forecast muncul setelah ≥12 menit data.</div>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-text-muted">
          Rentang aktif: {rangeLabel}. Retensi server dapat diatur lewat <code>MEAI_QUOTA_HISTORY_RETENTION_DAYS</code> (1–90 hari).
          Sampel hanya berasal dari respons provider; tidak ada data quota yang dibuat-buat.
        </p>
      </Card>
    </div>
  );
}
