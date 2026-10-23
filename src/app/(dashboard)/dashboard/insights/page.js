"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import OrbitalHealth from "@/shared/components/OrbitalHealth";
import AnimatedNumber from "@/shared/components/AnimatedNumber";

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

function Kpi({ label, value, hint, tone = "text-text-main", count, format }) {
  return (
    <div className="rounded-xl border border-border/60 bg-bg-subtle p-3 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 truncate text-xl font-bold ${tone}`} title={String(value)}>{count == null ? value : <AnimatedNumber value={count} format={format} />}</div>
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
  const [period, setPeriod] = useState(24);
  const [auto, setAuto] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("cost");
  const [columns, setColumns] = useState({ model: true, requests: true, success: true, p95: true, cost: true, cache: true });
  const [brush, setBrush] = useState([0, 23]);
  const [scrollTop, setScrollTop] = useState(0);
  const touchX = useRef(null);
  const [savedViews, setSavedViews] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/insights?hours=${period}`, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
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
  }, [period, refreshKey]);

  useEffect(() => {
    if (!auto) return undefined;
    const timer = setInterval(() => setRefreshKey((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [auto]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { setSavedViews(JSON.parse(localStorage.getItem("meai-insights-views") || "[]")); } catch { setSavedViews([]); }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!data?.notifications?.length) return undefined;
    const timer = setTimeout(() => {
      try {
        const previous = JSON.parse(localStorage.getItem("meai-alert-history") || "[]");
        const fresh = data.notifications.filter((item) => !previous.some((old) => old.text === item.text));
        const merged = [...fresh.map((item) => ({ ...item, ts: Date.now() })), ...previous].slice(0, 30);
        localStorage.setItem("meai-alert-history", JSON.stringify(merged));
        setAlertHistory(merged);
      } catch { /* storage may be unavailable */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [data?.notifications]);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.onopen = () => setLive(true);
    source.onmessage = () => setTicks((value) => value + 1);
    source.onerror = () => setLive(false);
    return () => source.close();
  }, []);

  const topConnection = useMemo(() => data?.connections?.[0] || null, [data]);
  const cacheRate = data?.totals?.cacheHitRate;
  const tokenEfficiency = useMemo(() => {
    const rows = data?.leaderboard || [];
    const prompt = rows.reduce((sum, row) => sum + row.promptTokens, 0);
    const completion = rows.reduce((sum, row) => sum + row.completionTokens, 0);
    const cached = rows.reduce((sum, row) => sum + row.cachedTokens, 0);
    return {
      completionShare: prompt + completion ? completion / (prompt + completion) : null,
      cacheShare: prompt ? cached / prompt : null,
      avgCostPer1k: rows.length ? rows.reduce((sum, row) => sum + (row.costPer1k || 0), 0) / rows.length : null,
    };
  }, [data]);
  const suggestions = useMemo(() => {
    const list = [];
    if (cacheRate != null && cacheRate < 0.3) list.push({ level: "warning", text: "Cache hit rendah (<30%); pertimbangkan prompt prefix stabil atau cache TTL." });
    for (const row of data?.connections || []) {
      if (row.p95 > 30_000) list.push({ level: "warning", text: `${row.name}: p95 ${Math.round(row.p95 / 1000)}s; cek provider/timeout.` });
      if (row.rate429 > 0) list.push({ level: "info", text: `${row.name}: ${row.rate429} response 429; turunkan concurrency atau tambah fallback.` });
    }
    if ((data?.expiry || []).some((row) => row.flagged)) list.push({ level: "warning", text: "Ada kuota ≤3 hari; siapkan fallback atau isi ulang." });
    if ((data?.keyAges || []).some((row) => row.stale)) list.push({ level: "info", text: "Ada API key >90 hari; jadwalkan rotasi." });
    return list.slice(0, 5);
  }, [data, cacheRate]);
  const visibleLeaderboard = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (data?.leaderboard || []).filter((row) => !q || row.model.toLowerCase().includes(q));
    const sorters = {
      cost: (a, b) => b.cost - a.cost,
      requests: (a, b) => b.requests - a.requests,
      p95: (a, b) => (b.p95 || 0) - (a.p95 || 0),
      success: (a, b) => a.successRate - b.successRate,
    };
    return [...rows].sort(sorters[sortBy] || sorters.cost);
  }, [data, query, sortBy]);
  const timelineRows = useMemo(() => (data?.timeline || []).slice(brush[0], brush[1] + 1), [data, brush]);
  const rowHeight = 28;
  const virtualStart = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const virtualEnd = Math.min(visibleLeaderboard.length, virtualStart + 14);
  const virtualRows = visibleLeaderboard.slice(virtualStart, virtualEnd);
  const topSpacer = virtualStart * rowHeight;
  const bottomSpacer = Math.max(0, (visibleLeaderboard.length - virtualEnd) * rowHeight);
  const shiftBrush = (delta) => {
    const length = data?.timeline?.length || 24;
    const width = brush[1] - brush[0];
    const start = Math.max(0, Math.min(length - 1 - width, brush[0] + delta));
    setBrush([start, start + width]);
  };
  const updateBrush = (index, value) => {
    const next = Number(value);
    setBrush((current) => index === 0 ? [Math.min(next, current[1]), current[1]] : [current[0], Math.max(next, current[0])]);
  };

  const saveCurrentView = () => {
    const next = [{ name: `${period}j · ${sortBy}${query ? ` · ${query}` : ""}`, period, sortBy, query, ts: Date.now() }, ...savedViews].slice(0, 8);
    setSavedViews(next);
    try { localStorage.setItem("meai-insights-views", JSON.stringify(next)); } catch { /* noop */ }
    setNotice("View tersimpan di browser.");
  };
  const applyView = (view) => {
    setPeriod(view.period);
    setSortBy(view.sortBy);
    setQuery(view.query || "");
    setNotice(`View diterapkan: ${view.name}.`);
  };


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

  const exportCsv = () => {
    const header = ["model", "requests", "successRate", "p50", "p95", "cost", "costPer1k", "cacheHitRate"];
    const lines = visibleLeaderboard.map((row) => header.map((key) => JSON.stringify(row[key] ?? "")).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `meai-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Leaderboard diexport sebagai CSV.");
  };

  const shareInsights = async () => {
    const response = await fetch("/api/insights/share", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: period, ttlMinutes: 60 }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setNotice(payload.error || "Share gagal."); return; }
    try { await navigator.clipboard.writeText(payload.url); setNotice("Link snapshot (60 menit) disalin."); }
    catch { setNotice(`Link snapshot (60 menit): ${payload.url}`); }
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] ${live ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-surface text-text-muted"}`}>
            <span className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-text-muted"}`} /> {live ? "LIVE" : "offline"} · {ticks}
          </span>
          <select value={period} onChange={(event) => setPeriod(Number(event.target.value))} aria-label="Periode insights" className="h-7 rounded-full border border-border bg-surface px-2 text-[10px] text-text-main">
            <option value={1}>1 jam</option>
            <option value={24}>24 jam</option>
            <option value={168}>7 hari</option>
          </select>
          <label className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-[10px] text-text-muted">
            <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} aria-label="Auto refresh 30 detik" /> auto 30s
          </label>
          <button type="button" onClick={exportInsights} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-text-muted hover:text-primary">Export JSON</button>
          <button type="button" onClick={exportCsv} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-text-muted hover:text-primary">Export CSV</button>
          <button type="button" onClick={shareInsights} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-text-muted hover:text-primary">Share 60m</button>
          <button type="button" onClick={saveCurrentView} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-text-muted hover:text-primary">Simpan view</button>
          <a href="/api/openapi" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-[11px] font-semibold text-primary hover:underline">OpenAPI</a>
        </div>
      </div>

      {notice ? <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">{notice}</p> : null}
      {savedViews.length ? (
        <div className="flex flex-wrap gap-1.5">
          {savedViews.map((view) => <button key={`${view.name}-${view.ts}`} type="button" onClick={() => applyView(view)} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-text-muted hover:text-primary">{view.name}</button>)}
        </div>
      ) : null}

      <div className="sticky top-0 z-20 -mx-3 grid grid-cols-2 gap-2 border-b border-border/50 bg-bg/90 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 sm:grid-cols-4">
        <Kpi label="Requests" value={fmtInt(data.totals.requests)} count={data.totals.requests} format={(n) => fmtInt(Math.round(n))} hint={`usageHistory ${data.windowHours} jam`} />
        <Kpi label="Success" value={pct(data.totals.successRate)} count={(data.totals.successRate || 0) * 100} format={(n) => `${n.toFixed(1)}%`} hint="2xx–3xx" tone="text-emerald-600 dark:text-emerald-400" />
        <Kpi label="Cache hit" value={pct(cacheRate)} count={(cacheRate || 0) * 100} format={(n) => `${n.toFixed(1)}%`} hint="cached / prompt token" tone="text-primary" />
        <Kpi label="Anomaly" value={data.anomaly.flagged ? `${data.anomaly.ratio}×` : "normal"} hint={`${fmtUsd(data.anomaly.currentHourCost)} jam ini`} tone={data.anomaly.flagged ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"} />
      </div>

      <OrbitalHealth items={data.connections} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">Weekday cost forecast</h2>
          <div className="flex h-24 items-end gap-1" role="img" aria-label="Rata-rata biaya per hari dalam seminggu">
            {data.weekdayForecast.map((row) => {
              const max = Math.max(0.0001, ...data.weekdayForecast.map((item) => item.avgCost || 0));
              return <span key={row.day} className="flex-1 rounded-t bg-primary/60" title={`Hari ${row.day}: ${fmtUsd(row.avgCost)}`} style={{ height: `${Math.max(4, ((row.avgCost || 0) / max) * 100)}%` }} />;
            })}
          </div>
          <div className="flex justify-between text-[9px] text-text-muted"><span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span></div>
        </Card>
        <Card className="flex flex-col gap-1 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">Prompt-cache hygiene</h2>
          {data.cacheHygiene.slice(0, 4).map((row) => <div key={row.model} className="flex items-center justify-between gap-2 border-t border-border/50 py-1 text-[10px]"><span className="truncate text-text-main" title={row.model}>{row.model}</span><span className={row.cacheRate != null && row.cacheRate < 0.2 ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}>{pct(row.cacheRate)}</span></div>)}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex min-w-0 flex-col gap-2 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">Latency heatmap per model · connection</h2>
          <div className="overflow-x-auto" tabIndex={0} aria-label="Heatmap latency per model dan koneksi">
            <div className="min-w-[430px] space-y-1">
              {data.latencyHeatmap.map((row) => <div key={row.key} className="grid grid-cols-[130px_repeat(24,minmax(0,1fr))] items-center gap-0.5"><span className="truncate pr-1 text-[9px] text-text-muted" title={row.key}>{row.key}</span>{row.cells.map((cell, hour) => <span key={hour} className="h-3 rounded-[2px]" style={{ backgroundColor: cell.requests ? `rgba(93,79,176,${0.12 + Math.min(1, (cell.p95 || 0) / 30000) * 0.8})` : "rgba(148,148,159,.08)" }} title={`${hour}:00 · p95 ${cell.p95 ? Math.round(cell.p95) : "—"}ms · ${cell.requests} req`} />)}</div>)}
            </div>
          </div>
        </Card>
        <Card className="flex flex-col gap-1 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-text-main">SLO incident timeline</h2>
          {data.sloIncidents.length === 0 ? <p className="text-xs text-text-muted">Tidak ada breach pada jendela ini.</p> : data.sloIncidents.map((row) => <div key={`${row.startHour}-${row.endHour}`} className="flex justify-between border-t border-border/50 py-1 text-[10px]"><span className="text-text-main">{String(row.startHour).padStart(2, "0")}:00–{String(row.endHour + 1).padStart(2, "0")}:00</span><span className="text-amber-600 dark:text-amber-400">{row.durationHours}j · p95 {Math.round(row.maxP95)}ms</span></div>)}
        </Card>
      </div>

      <Card className="flex min-w-0 flex-col gap-2 p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-text-main">Provider status timeline</h2>
        <div className="overflow-x-auto" tabIndex={0} aria-label="Timeline provider per jam">
          <div className="min-w-[480px] space-y-1">
            {data.providerTimeline.map((row) => (
              <div key={row.provider} className="grid grid-cols-[110px_repeat(24,minmax(0,1fr))] items-center gap-0.5">
                <span className="truncate pr-1 text-[10px] text-text-muted" title={row.provider}>{row.provider}</span>
                {row.cells.map((cell, hour) => <span key={hour} className="h-3 rounded-[2px]" style={{ backgroundColor: cell.requests ? `rgba(16,185,129,${0.12 + Math.min(1, cell.rate429 / Math.max(1, cell.requests)) * 0.7})` : "rgba(148,148,159,.08)" }} title={`${row.provider} ${hour}:00 — ${cell.requests} req · ${cell.rate429} × 429 · $${cell.cost.toFixed(4)}`} />)}
              </div>
            ))}
          </div>
        </div>
      </Card>


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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-main">Model leaderboard</h2>
            <div className="flex items-center gap-1.5">
              <input value={query} onChange={(event) => { setQuery(event.target.value); setScrollTop(0); }} placeholder="Cari model…" aria-label="Cari model leaderboard" className="h-7 w-28 rounded-md border border-border bg-surface px-2 text-[10px] text-text-main outline-none focus:border-primary" />
              <select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setScrollTop(0); }} aria-label="Urutkan leaderboard" className="h-7 rounded-md border border-border bg-surface px-2 text-[10px] text-text-main">
                <option value="cost">Cost</option><option value="requests">Req</option><option value="p95">p95</option><option value="success">Success</option>
              </select>
              <details className="relative">
                <summary className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-[10px] text-text-muted">Columns</summary>
                <div className="absolute right-0 z-30 mt-1 grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-2 text-[10px] shadow-xl">
                  {[["model", "Model"], ["requests", "Req"], ["success", "Success"], ["p95", "p95"], ["cost", "Cost"], ["cache", "Cache"]].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={columns[key]} onChange={() => setColumns((prev) => ({ ...prev, [key]: !prev[key] }))} /> {label}</label>
                  ))}
                </div>
              </details>
            </div>
          </div>
          <div className="max-h-80 overflow-auto" tabIndex={0} aria-label="Tabel leaderboard model" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            <table className="w-full min-w-[620px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-surface text-[10px] uppercase tracking-wide text-text-muted">
                <tr><th className={columns.model ? "" : "hidden"}>Model</th><th className={columns.requests ? "pr-2" : "hidden"}>Req</th><th className={columns.success ? "pr-2" : "hidden"}>Success</th><th className={columns.p95 ? "pr-2" : "hidden"}>p95</th><th className={columns.cost ? "pr-2" : "hidden"}>Cost/1k</th><th className={columns.cache ? "" : "hidden"}>Cache</th></tr>
              </thead>
              <tbody>
                <tr aria-hidden="true" style={{ height: topSpacer }}><td colSpan={6} /></tr>
                {virtualRows.map((row) => (
                  <tr key={row.model} className="border-t border-border/50">
                    <td className={`${columns.model ? "" : "hidden"} max-w-[220px] truncate py-1.5 pr-2 font-medium text-text-main`} title={row.model}>{row.model}</td>
                    <td className={`${columns.requests ? "pr-2" : "hidden"} text-text-muted`}>{fmtInt(row.requests)}</td>
                    <td className={`${columns.success ? "pr-2" : "hidden"} ${row.successRate >= 0.95 ? "text-emerald-500" : "text-amber-500"}`}>{pct(row.successRate)}</td>
                    <td className={`${columns.p95 ? "pr-2" : "hidden"} text-text-muted`}>{fmtMs(row.p95)}</td>
                    <td className={`${columns.cost ? "pr-2" : "hidden"} text-text-main`}>{row.costPer1k == null ? "—" : fmtUsd(row.costPer1k)}</td>
                    <td className={columns.cache ? "text-text-muted" : "hidden"}>{pct(row.cacheHitRate)}</td>
                  </tr>
                ))}
                <tr aria-hidden="true" style={{ height: bottomSpacer }}><td colSpan={6} /></tr>
              </tbody>
            </table>
            <div className="mt-2 text-[10px] text-text-muted">
              {visibleLeaderboard.length === 0 ? "0 model" : `${virtualStart + 1}–${virtualEnd} dari ${visibleLeaderboard.length} model · scroll untuk melihat sisanya`}
            </div>
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
        <h2 className="text-sm font-semibold text-text-main">Optimizer</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Kpi label="Completion share" value={pct(tokenEfficiency.completionShare)} hint="completion / total token" />
          <Kpi label="Cache share" value={pct(tokenEfficiency.cacheShare)} hint="cached / prompt" />
          <Kpi label="Avg cost/1k" value={tokenEfficiency.avgCostPer1k == null ? "—" : fmtUsd(tokenEfficiency.avgCostPer1k)} hint="leaderboard" />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-[11px] font-semibold text-text-main">Saran optimasi</h3>
            {suggestions.length === 0 ? <p className="text-xs text-text-muted">Belum ada saran; metrik dalam batas.</p> : suggestions.map((item, index) => (
              <div key={`${item.text}-${index}`} className="flex items-start gap-2 border-t border-border/50 py-1 text-[11px]"><span className={`mt-1 size-1.5 shrink-0 rounded-full ${item.level === "warning" ? "bg-amber-500" : "bg-primary"}`} /><span className="text-text-main">{item.text}</span></div>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="mb-1 text-[11px] font-semibold text-text-main">Usage timeline · brush</h3>
            <div
              className="flex h-16 items-end gap-0.5 touch-pan-y"
              role="img"
              aria-label={`Usage per jam, rentang ${brush[0]}–${brush[1]}`}
              onTouchStart={(event) => { touchX.current = event.touches[0]?.clientX ?? null; }}
              onTouchEnd={(event) => {
                const end = event.changedTouches[0]?.clientX;
                if (touchX.current != null && end != null && Math.abs(end - touchX.current) > 30) shiftBrush(end > touchX.current ? -2 : 2);
                touchX.current = null;
              }}
            >
              {timelineRows.map((item) => {
                const max = Math.max(1, ...timelineRows.map((row) => row.requests));
                return <span key={item.hour} className="flex-1 rounded-t-sm bg-primary/60" style={{ height: `${Math.max(3, (item.requests / max) * 100)}%` }} title={`${item.hour}:00 — ${item.requests} req, ${fmtUsd(item.cost)}`} />;
              })}
            </div>
            <div className="flex items-center justify-between gap-2 text-[9px] text-text-muted"><span>{brush[0].toString().padStart(2, "0")}:00</span><span>{brush[1].toString().padStart(2, "0")}:00</span></div>
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor="brush-start">Awal rentang</label>
              <input id="brush-start" type="range" min="0" max={Math.max(0, (data.timeline.length || 24) - 1)} value={brush[0]} onChange={(event) => updateBrush(0, event.target.value)} className="h-4 min-w-0 flex-1 accent-[var(--color-brand-500)]" />
              <label className="sr-only" htmlFor="brush-end">Akhir rentang</label>
              <input id="brush-end" type="range" min="0" max={Math.max(0, (data.timeline.length || 24) - 1)} value={brush[1]} onChange={(event) => updateBrush(1, event.target.value)} className="h-4 min-w-0 flex-1 accent-[var(--color-brand-500)]" />
            </div>
            <div className="flex justify-between text-[9px] text-text-muted"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          </div>
        </div>
        <div>
          <h3 className="mb-1 text-[11px] font-semibold text-text-main">Cache TTL advisor</h3>
          {(data.cacheTtlAdvisor || []).length === 0 ? <p className="text-xs text-text-muted">Belum ada model dengan ≥10 request untuk dinilai.</p> : data.cacheTtlAdvisor.map((row) => (
            <div key={row.model} className="flex items-center justify-between gap-2 border-t border-border/50 py-1 text-[10px]">
              <span className="truncate text-text-main" title={row.model}>{row.model}</span>
              <span className="shrink-0 text-text-muted">{pct(row.cacheHitRate)} · {row.recommendation}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-[11px] font-semibold text-text-main">Quota reset calendar</h3>
            {data.resetCalendar.length === 0 ? <p className="text-xs text-text-muted">Belum ada pola reset (butuh ≥2 reset terdeteksi).</p> : data.resetCalendar.map((row) => <div key={`${row.connectionId}-${row.quotaName}`} className="flex justify-between border-t border-border/50 py-1 text-[10px]"><span className="truncate text-text-main">{row.name} · {row.quotaName}</span><span className="text-text-muted">{row.daysUntil <= 0 ? "sudah lewat" : `${row.daysUntil}d`}</span></div>)}
          </div>
          <div>
            <h3 className="mb-1 text-[11px] font-semibold text-text-main">API key age</h3>
            {data.keyAges.slice(0, 5).map((row) => <div key={row.id} className="flex justify-between border-t border-border/50 py-1 text-[10px]"><span className="truncate text-text-main">{row.name}</span><span className={row.stale ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}>{row.days == null ? "—" : `${row.days}d`}{row.stale ? " · rotasi" : ""}</span></div>)}
          </div>
        </div>
        <div>
          <h3 className="mb-1 text-[11px] font-semibold text-text-main">Alert history (browser)</h3>
          {alertHistory.length === 0 ? <p className="text-xs text-text-muted">Belum ada riwayat alert di browser ini.</p> : alertHistory.slice(0, 5).map((item, index) => <div key={`${item.text}-${item.ts}-${index}`} className="flex justify-between border-t border-border/50 py-1 text-[10px]"><span className="truncate text-text-main">{item.text}</span><span className="text-text-muted">{new Date(item.ts).toLocaleTimeString()}</span></div>)}
        </div>
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


