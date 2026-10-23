"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

const fmtInt = (n) => new Intl.NumberFormat().format(Number(n) || 0);
const fmtUsd = (n) => `$${(Number(n) || 0).toFixed(Number(n) >= 1 ? 2 : 4)}`;
const fmtMs = (n) => (n == null ? "—" : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`);
const pct = (n) => (n == null ? "—" : `${(Number(n) * 100).toFixed(1)}%`);

function ScoreRing({ score }) {
  const value = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = value >= 80 ? "#10b981" : value >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative grid size-14 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${value * 3.6}deg, rgba(148,148,159,.14) 0)` }}>
      <div className="grid size-11 place-items-center rounded-full bg-surface text-sm font-bold text-text-main">{score == null ? "—" : value}</div>
    </div>
  );
}

function Kpi({ label, value, hint, tone = "text-text-main" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-bg-subtle p-3 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 truncate text-xl font-bold ${tone}`} title={String(value)}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-text-muted">{hint}</div>
    </div>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState(null);
  const [combos, setCombos] = useState([]);
  const [comboName, setComboName] = useState("");
  const [sim, setSim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quiet, setQuiet] = useState({ enabled: false, start: "22:00", end: "07:00" });
  const [live, setLive] = useState(false);
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/insights?hours=24", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch("/api/combos").then((r) => (r.ok ? r.json() : { combos: [] })).catch(() => ({ combos: [] })),
    ]).then(([insights, comboData]) => {
      if (!alive) return;
      setData(insights);
      setQuiet(insights.settings?.quietHours || { enabled: false, start: "22:00", end: "07:00" });
      const list = comboData.combos || [];
      setCombos(list);
      setComboName((current) => current || list[0]?.name || "");
    }).catch((err) => alive && setError(err.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.onopen = () => setLive(true);
    source.onmessage = () => setTicks((value) => value + 1);
    source.onerror = () => setLive(false);
    return () => source.close();
  }, []);

  const topConnection = useMemo(() => data?.connections?.[0] || null, [data]);
  const cacheRate = data?.totals?.cacheHitRate;

  const saveQuiet = async () => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertQuietHours: quiet }),
    });
    setNotice(response.ok ? "Quiet hours disimpan." : `Gagal menyimpan (HTTP ${response.status}).`);
  };

  const simulate = async () => {
    if (!comboName) return;
    setSim(null);
    const response = await fetch("/api/combos/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: comboName, messages: [{ role: "user", content: "ping" }] }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(payload.error || "Simulasi gagal.");
    else setSim(payload);
  };

  const compactNow = async () => {
    const response = await fetch("/api/maintenance/quota-compaction", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(payload.error || "Compaction gagal.");
    else {
      setNotice(`Compaction selesai: ${payload.removed || 0} baris lama diringkas.`);
      setData((prev) => prev ? { ...prev, ops: { ...prev.ops, compaction: { ts: Date.now(), ...payload } } } : prev);
    }
  };

  const exportInsights = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `meai-insights-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Snapshot insights diexport sebagai JSON.");
  };

  if (loading) return <div className="p-4"><div className="h-64 animate-pulse rounded-2xl bg-surface-2" /></div>;
  if (error) return <div className="p-4"><Card className="border-danger/30 bg-danger/10 p-4 text-sm text-danger">Gagal memuat insights: {error}</Card></div>;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-main">Insights & Health</h1>
          <p className="mt-0.5 text-xs text-text-muted">Health score, leaderboard latency/biaya, anomali burn, cache, rate-limit heatmap, dan ops otomatis.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] ${live ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-surface text-text-muted"}`}>
            <span className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-text-muted"}`} /> {live ? "LIVE" : "offline"} · {ticks}
          </span>
          <button type="button" onClick={exportInsights} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-text-muted hover:text-primary">Export JSON</button>
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-text-muted">{data.windowHours} jam terakhir</span>
          <a href="/api/openapi" target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-primary hover:underline">OpenAPI</a>
        </div>
      </div>

      {notice ? <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">{notice}</p> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Requests" value={fmtInt(data.totals.requests)} hint="usageHistory 24 jam" />
        <Kpi label="Success" value={pct(data.totals.successRate)} hint="2xx–3xx" tone="text-emerald-600 dark:text-emerald-400" />
        <Kpi label="Cache hit" value={pct(cacheRate)} hint="cached / prompt token" tone="text-primary" />
        <Kpi label="Anomaly" value={data.anomaly.flagged ? `${data.anomaly.ratio}×` : "normal"} hint={`${fmtUsd(data.anomaly.currentHourCost)} jam ini`} tone={data.anomaly.flagged ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">Health score per koneksi</h2>
            <span className="text-[10px] text-text-muted">advisory · bukan hard limit</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.connections.length === 0 ? <p className="text-xs text-text-muted">Belum ada usage pada jendela ini.</p> : data.connections.slice(0, 8).map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-subtle p-2.5 transition-transform hover:-translate-y-0.5">
                <ScoreRing score={row.score} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-text-main" title={row.name}>{row.name}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-text-muted">
                    <span>{fmtInt(row.requests)} req</span>
                    <span>{pct(row.successRate)} ok</span>
                    <span>{row.rate429} × 429</span>
                    <span>p95 {fmtMs(row.p95)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className={`flex flex-col justify-between gap-3 p-3 sm:p-4 ${data.anomaly.flagged ? "border-amber-500/40" : ""}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-text-main">Burn anomaly</h2>
              <p className="mt-0.5 text-[10px] text-text-muted">Bandingkan biaya 1 jam terakhir dengan rata-rata 6 jam sebelumnya.</p>
            </div>
            <span className={`material-symbols-outlined ${data.anomaly.flagged ? "text-amber-500" : "text-emerald-500"}`}>{data.anomaly.flagged ? "warning" : "check_circle"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Jam ini" value={fmtUsd(data.anomaly.currentHourCost)} hint="cost aktual" />
            <Kpi label="Baseline/jam" value={fmtUsd(data.anomaly.baselineHourlyCost)} hint="rata-rata 6 jam" />
          </div>
          <p className={`text-xs ${data.anomaly.flagged ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}`}>
            {data.anomaly.ratio == null ? "Belum cukup baseline untuk mendeteksi anomali." : data.anomaly.flagged ? `Lonjakan ${data.anomaly.ratio}× — cek model/connection yang tidak biasa.` : `Rasio ${data.anomaly.ratio}× — masih dalam pola normal.`}
          </p>
          <p className="text-[10px] text-text-muted">Top spender: {topConnection ? `${topConnection.name} · ${fmtUsd(topConnection.cost)}` : "—"}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">Forecast & SLO</h2>
            <span className="text-[10px] text-text-muted">pacing hari ini</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Spend hari ini" value={fmtUsd(data.pacing.spendToday)} hint={data.pacing.budget ? `budget ${fmtUsd(data.pacing.budget)}` : "global budget belum diset"} />
            <Kpi label="Projected akhir hari" value={fmtUsd(data.pacing.projectedEndOfDay)} hint={`${(data.pacing.elapsedFraction * 100).toFixed(0)}% hari berjalan`} tone={data.pacing.status === "over" || data.pacing.status === "pacing-over" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"} />
            <Kpi label="SLO p95" value={fmtMs(data.slo.p95Ms)} hint={`${data.slo.breaches.length} koneksi breach`} tone={data.slo.breaches.length ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"} />
            <Kpi label="Fairness" value={data.fairness.score == null ? "—" : `${data.fairness.score}/100`} hint={`spread ${data.fairness.spread ?? "—"}`} />
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] text-text-muted">
            <span className="rounded-full border border-border/60 px-2 py-0.5">DB {data.db?.bytes ? `${(data.db.bytes / 1024 / 1024).toFixed(1)} MB` : "—"}</span>
            <span className="rounded-full border border-border/60 px-2 py-0.5">{data.providerMatrix.length} provider</span>
            <span className="rounded-full border border-border/60 px-2 py-0.5">{data.notifications.length} notifikasi</span>
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">Quota expiry forecast</h2>
            <span className="text-[10px] text-text-muted">≤3d merah</span>
          </div>
          {data.expiry.length === 0 ? <p className="text-xs text-text-muted">Belum ada kuota yang diproyeksikan habis ≤30 hari.</p> : (
            <div className="overflow-x-auto" tabIndex={0} aria-label="Forecast expiry kuota">
              <table className="w-full min-w-[420px] text-left text-[11px]">
                <thead className="text-[10px] uppercase text-text-muted"><tr><th className="py-1 pr-2">Koneksi</th><th className="pr-2">Kuota</th><th className="pr-2">Sisa</th><th>Habis</th></tr></thead>
                <tbody>{data.expiry.map((row) => <tr key={`${row.connectionId}-${row.quotaName}`} className="border-t border-border/50"><td className="max-w-[140px] truncate py-1 pr-2 text-text-main" title={row.name}>{row.name}</td><td className="pr-2 text-text-muted">{row.quotaName}</td><td className="pr-2">{row.pct}%</td><td className={row.flagged ? "font-semibold text-danger" : "text-text-muted"}>{row.daysLeft}d</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">Per-key burn anomaly</h2>
          {data.perKeyAnomaly.length === 0 ? <p className="text-xs text-text-muted">Tidak ada lonjakan per key.</p> : data.perKeyAnomaly.map((row) => (
            <div key={row.name} className="flex items-center justify-between gap-2 border-t border-border/50 py-1 text-[11px]"><span className="truncate text-text-main" title={row.name}>{row.name}</span><span className={row.flagged ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}>{row.ratio == null ? "—" : `${row.ratio}×`} · {fmtUsd(row.current)}</span></div>
          ))}
        </Card>
        <Card className="flex flex-col gap-2 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">Pricing audit</h2>
          {data.pricingAudit.length === 0 ? <p className="text-xs text-text-muted">Tidak ada selisih biaya aktual vs pricing ≥20%.</p> : data.pricingAudit.map((row) => (
            <div key={row.model} className="flex items-center justify-between gap-2 border-t border-border/50 py-1 text-[11px]"><span className="truncate text-text-main" title={row.model}>{row.model}</span><span className="text-amber-600 dark:text-amber-400">{row.deltaPct > 0 ? "+" : ""}{row.deltaPct}%</span></div>
          ))}
        </Card>
      </div>


      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">Model leaderboard</h2>
            <span className="text-[10px] text-text-muted">cost/1k + latency</span>
          </div>
          <div className="overflow-x-auto" tabIndex={0} aria-label="Tabel leaderboard model">
            <table className="w-full min-w-[620px] text-left text-[11px]">
              <thead className="text-[10px] uppercase tracking-wide text-text-muted">
                <tr><th className="py-1.5 pr-2">Model</th><th className="pr-2">Req</th><th className="pr-2">Success</th><th className="pr-2">p95</th><th className="pr-2">Cost/1k</th><th>Cache</th></tr>
              </thead>
              <tbody>
                {data.leaderboard.map((row) => (
                  <tr key={row.model} className="border-t border-border/50">
                    <td className="max-w-[220px] truncate py-1.5 pr-2 font-medium text-text-main" title={row.model}>{row.model}</td>
                    <td className="pr-2 text-text-muted">{fmtInt(row.requests)}</td>
                    <td className={`pr-2 ${row.successRate >= 0.95 ? "text-emerald-500" : "text-amber-500"}`}>{pct(row.successRate)}</td>
                    <td className="pr-2 text-text-muted">{fmtMs(row.p95)}</td>
                    <td className="pr-2 text-text-main">{row.costPer1k == null ? "—" : fmtUsd(row.costPer1k)}</td>
                    <td className="text-text-muted">{pct(row.cacheHitRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.leaderboard.length === 0 ? <p className="py-3 text-xs text-text-muted">Belum ada request pada jendela ini.</p> : null}
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">Rate-limit heatmap</h2>
            <span className="text-[10px] text-text-muted">429 / jam</span>
          </div>
          {data.heatmap.length === 0 ? <p className="text-xs text-text-muted">Belum ada request per key.</p> : (
            <div className="overflow-x-auto pb-1" tabIndex={0} aria-label="Heatmap rate limit per jam">
              <div className="min-w-[520px] space-y-1">
                <div className="grid grid-cols-[96px_repeat(24,minmax(0,1fr))] gap-0.5 text-[8px] text-text-muted">
                  <span />
                  {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 4 === 0 ? h : ""}</span>)}
                </div>
                {data.heatmap.slice(0, 8).map((row) => (
                  <div key={row.name} className="grid grid-cols-[96px_repeat(24,minmax(0,1fr))] items-center gap-0.5">
                    <span className="truncate pr-1 text-[10px] text-text-muted" title={row.name}>{row.name}</span>
                    {row.cells.map((cell, hour) => {
                      const intensity = cell.requests ? Math.min(1, cell.rate429 / cell.requests) : 0;
                      return <span key={hour} className="h-4 rounded-[3px]" style={{ backgroundColor: intensity ? `rgba(239,68,68,${0.18 + intensity * 0.82})` : "rgba(148,148,159,.08)" }} title={`${row.name} ${hour}:00 — ${cell.rate429}/${cell.requests} 429`} />;
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-[9px] text-text-muted"><span className="size-2 rounded-sm bg-danger/30" /> rendah <span className="size-2 rounded-sm bg-danger" /> tinggi</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">Automation status</h2>
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="text-text-muted">Kompaksi, drill, catalog, a11y</span>
            <Button variant="ghost" size="xs" onClick={compactNow}>Compact now</Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-border/60 bg-bg-subtle p-2">
              <div className="text-text-muted">Quota compaction</div>
              <div className="mt-0.5 font-semibold text-text-main">{data.ops.compaction ? `${fmtInt(data.ops.compaction.removed)} rows` : "belum jalan"}</div>
              <div className="text-text-muted">{data.ops.compaction?.ts ? new Date(data.ops.compaction.ts * (data.ops.compaction.ts < 1e12 ? 1000 : 1)).toLocaleString() : "—"}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-bg-subtle p-2">
              <div className="text-text-muted">Restore drill</div>
              <div className={`mt-0.5 font-semibold ${data.ops.restoreDrill?.ok ? "text-emerald-500" : "text-amber-500"}`}>{data.ops.restoreDrill ? (data.ops.restoreDrill.ok ? "OK" : "gagal") : "belum jalan"}</div>
              <div className="text-text-muted">{data.ops.restoreDrill?.quotaHistoryRows != null ? `${fmtInt(data.ops.restoreDrill.quotaHistoryRows)} baris` : "—"}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-bg-subtle p-2">
              <div className="text-text-muted">Catalog diff</div>
              <div className="mt-0.5 font-semibold text-text-main">{data.ops.catalogDiff ? `+${data.ops.catalogDiff.added?.length || 0} / −${data.ops.catalogDiff.removed?.length || 0}` : "belum ada"}</div>
              <div className="text-text-muted">{data.ops.catalogDiff?.count != null ? `${fmtInt(data.ops.catalogDiff.count)} model` : "—"}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-bg-subtle p-2">
              <div className="text-text-muted">WCAG audit</div>
              <div className="mt-0.5 font-semibold text-text-main">{data.ops.a11y ? `${data.ops.a11y.totalViolations} temuan` : "belum ada"}</div>
              <div className="text-text-muted">{data.ops.a11y ? `${data.ops.a11y.critical} critical` : "—"}</div>
            </div>
          </div>
          <p className="text-[10px] text-text-muted">Kompaksi & drill berjalan otomatis di server; status dibaca dari file state, bukan data karangan.</p>
        </Card>

        <Card className="flex flex-col gap-3 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">Quiet hours alert</h2>
          <p className="text-[10px] text-text-muted">Alert budget tidak dikirim pada jam ini; state tidak ditandai terkirim, jadi alert tetap masuk setelah jendela berakhir.</p>
          <label className="flex items-center gap-2 text-xs text-text-main">
            <input type="checkbox" checked={quiet.enabled} onChange={(e) => setQuiet({ ...quiet, enabled: e.target.checked })} aria-label="Aktifkan quiet hours" />
            Aktifkan quiet hours
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-text-muted">Mulai<input type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} aria-label="Quiet hours mulai" className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-main" /></label>
            <label className="flex flex-col gap-1 text-[10px] text-text-muted">Selesai<input type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} aria-label="Quiet hours selesai" className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-main" /></label>
          </div>
          <Button variant="secondary" size="sm" onClick={saveQuiet}>Simpan quiet hours</Button>
        </Card>
      </div>

      <Card className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-sm font-semibold text-text-main">Combo simulator (dry-run)</h2><p className="text-[10px] text-text-muted">Urutan fallback + health score + compatibility; tidak mengirim request ke provider.</p></div>
          <div className="flex items-center gap-2">
            <select value={comboName} onChange={(e) => setComboName(e.target.value)} aria-label="Pilih combo untuk simulasi" className="h-8 max-w-[240px] rounded-md border border-border bg-surface px-2 text-xs text-text-main">
              {combos.map((combo) => <option key={combo.id || combo.name} value={combo.name}>{combo.name}</option>)}
            </select>
            <Button variant="secondary" size="sm" onClick={simulate} disabled={!comboName}>Simulasikan</Button>
          </div>
        </div>
        {sim ? (
          <div className="overflow-x-auto" tabIndex={0} aria-label="Tabel simulasi combo">
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead className="text-[10px] uppercase text-text-muted"><tr><th className="py-1 pr-2">#</th><th className="pr-2">Model</th><th className="pr-2">Provider</th><th className="pr-2">Health</th><th>Kompatibel</th></tr></thead>
              <tbody>{sim.models.map((row) => <tr key={row.model} className="border-t border-border/50"><td className="py-1 pr-2 text-text-muted">{row.order}</td><td className="pr-2 font-mono text-text-main">{row.model}</td><td className="pr-2 text-text-muted">{row.provider}</td><td className="pr-2">{row.healthScore ?? "—"}</td><td className={row.compatible ? "text-emerald-500" : "text-amber-500"}>{row.compatible ? "ya" : `tidak (${row.missing.join(", ")})`}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="text-xs text-text-muted">Pilih combo lalu klik Simulasikan.</p>}
      </Card>

      <Card className="flex flex-col gap-3 p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-text-main">Notifications & provider matrix</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-[11px] font-semibold text-text-main">Notification center</h3>
            {data.notifications.length === 0 ? <p className="text-xs text-text-muted">Tidak ada notifikasi aktif.</p> : data.notifications.map((item, index) => (
              <div key={`${item.text}-${index}`} className="flex items-center gap-2 border-t border-border/50 py-1 text-[11px]">
                <span className={`size-1.5 rounded-full ${item.level === "error" ? "bg-danger" : item.level === "warning" ? "bg-amber-500" : "bg-primary"}`} />
                <span className="text-text-main">{item.text}</span>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto" tabIndex={0} aria-label="Matriks status provider">
            <h3 className="mb-1 text-[11px] font-semibold text-text-main">Provider matrix</h3>
            <table className="w-full min-w-[420px] text-left text-[10px]">
              <thead className="uppercase text-text-muted"><tr><th className="py-1 pr-2">Provider</th><th className="pr-2">Score</th><th className="pr-2">Req</th><th className="pr-2">429</th><th>p95</th></tr></thead>
              <tbody>{data.providerMatrix.map((row) => <tr key={`${row.provider}-${row.name}`} className="border-t border-border/50"><td className="py-1 pr-2 text-text-main">{row.provider}</td><td className="pr-2">{row.score ?? "—"}</td><td className="pr-2 text-text-muted">{fmtInt(row.requests)}</td><td className="pr-2 text-text-muted">{row.rate429}</td><td className="text-text-muted">{fmtMs(row.p95)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}


