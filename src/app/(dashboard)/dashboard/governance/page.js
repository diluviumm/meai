"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

const fmt = (n) => new Intl.NumberFormat().format(Number(n) || 0);
const usd = (n) => `$${(Number(n) || 0).toFixed(4)}`;
const bytes = (n) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : "—");

function Row({ label, value, tone = "text-text-main" }) {
  return <div className="flex items-center justify-between gap-2 border-t border-border/50 py-1 text-[11px]"><span className="text-text-muted">{label}</span><span className={`truncate font-medium ${tone}`}>{value}</span></div>;
}

function Panel({ title, hint, children }) {
  return <Card className="flex min-w-0 flex-col gap-2 p-3 sm:p-4"><div className="flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-text-main">{title}</h2><span className="text-[9px] text-text-muted">{hint}</span></div>{children}</Card>;
}

export default function GovernancePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backupResult, setBackupResult] = useState(null);

  const load = () => fetch("/api/governance", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(setData).catch((err) => setError(err.message));

  useEffect(() => { load(); }, []);

  const snapshot = async () => {
    const response = await fetch("/api/governance/snapshot", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(payload.error || "Snapshot gagal.");
    else { setNotice(`Snapshot config tersimpan (${payload.keys} key).`); load(); }
  };

  const checkBackup = async (name) => {
    const response = await fetch("/api/governance/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(payload.error || "Pemeriksaan backup gagal.");
    else { setBackupResult(payload); setNotice(`Backup ${name}: integrity ${payload.integrity}, ${payload.tables} tabel.`); }
  };

  if (error) return <div className="p-4"><Card className="border-danger/30 bg-danger/10 p-4 text-sm text-danger">Gagal memuat governance: {error}</Card></div>;
  if (!data) return <div className="p-4"><div className="h-64 animate-pulse rounded-2xl bg-surface-2" /></div>;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold text-text-main">Governance & Safety</h1><p className="mt-0.5 text-xs text-text-muted">12 pemeriksaan operasional: backup, drift, circuit, biaya, webhook, dan performa.</p></div>
        <div className="flex items-center gap-2"><Button variant="secondary" size="sm" onClick={snapshot}>Snapshot config</Button><span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-text-muted">{new Date(data.generatedAt).toLocaleString()}</span></div>
      </div>
      {notice ? <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">{notice}</p> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="1. Fork self-check" hint={data.selfCheck.version}>
          <Row label="API/DB" value={data.selfCheck.ok ? "OK" : "gagal"} tone={data.selfCheck.ok ? "text-emerald-600 dark:text-emerald-400" : "text-danger"} />
          <Row label="Usage rows" value={fmt(data.selfCheck.usageRows)} />
          <Row label="Quota rows" value={fmt(data.selfCheck.quotaRows)} />
          <Row label="Connections" value={fmt(data.selfCheck.connections)} />
        </Panel>

        <Panel title="2. Backup inventory" hint={`${data.backups.length} file`}>
          {data.backups.length === 0 ? <p className="text-xs text-text-muted">Tidak ada file backup.</p> : data.backups.slice(0, 4).map((item) => <div key={item.name} className="border-t border-border/50 py-1 text-[10px]"><div className="flex items-center justify-between gap-2"><span className="truncate font-medium text-text-main" title={item.name}>{item.name}</span><button type="button" onClick={() => checkBackup(item.name)} className="shrink-0 text-[9px] text-primary hover:underline">check</button></div><div className="text-text-muted">{bytes(item.bytes)} · {new Date(item.modified).toLocaleDateString()}</div></div>)}
          {backupResult ? <p className="rounded-md border border-border/60 bg-bg-subtle px-2 py-1 text-[10px] text-text-muted">{backupResult.name}: {backupResult.integrity} · {backupResult.tables} tabel · {backupResult.quotaRows ?? "—"} quota</p> : null}
        </Panel>

        <Panel title="3. Config drift" hint={data.configDrift.available ? "snapshot ada" : "belum ada"}>
          <Row label="Status" value={!data.configDrift.available ? "snapshot belum dibuat" : data.configDrift.changedKeys.length ? `${data.configDrift.changedKeys.length} key berubah` : "tidak ada drift"} tone={data.configDrift.changedKeys?.length ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"} />
          <Row label="Snapshot" value={data.configDrift.checkedAt ? new Date(data.configDrift.checkedAt).toLocaleString() : "—"} />
          {data.configDrift.changedKeys?.slice(0, 4).map((key) => <Row key={key} label={key} value="changed" tone="text-amber-600 dark:text-amber-400" />)}
          {data.settingsAudit?.slice(0, 3).map((entry) => <Row key={entry.ts} label={`audit ${new Date(entry.ts).toLocaleTimeString()}`} value={(entry.changed || []).map((item) => item.key).join(", ").slice(0, 38)} />)}
        </Panel>

        <Panel title="4. Combo inventory" hint={`${data.comboInventory.count} combo`}>
          {data.comboInventory.names.slice(0, 6).map((name) => <Row key={name} label={name} value="aktif" />)}
          <Row label="Updated" value={data.comboInventory.latestUpdatedAt ? new Date(data.comboInventory.latestUpdatedAt).toLocaleString() : "—"} />
        </Panel>

        <Panel title="5. Circuit / cooldown" hint={`${data.circuit.length} koneksi`}>
          {data.circuit.length === 0 ? <p className="text-xs text-text-muted">Tidak ada koneksi 429/cooldown.</p> : data.circuit.slice(0, 5).map((row) => <Row key={row.id} label={row.name} value={`${row.state} · ${row.rate429}×429`} tone={row.state === "cooldown" ? "text-amber-600 dark:text-amber-400" : "text-text-main"} />)}
        </Panel>

        <Panel title="6. Rate-limit & timeout advice" hint={`${data.rateAdvice.length} saran`}>
          {data.rateAdvice.length === 0 ? <p className="text-xs text-text-muted">Tidak ada 429 atau p95 di atas 30s.</p> : data.rateAdvice.map((row) => <div key={row.name} className="border-t border-border/50 py-1 text-[10px]"><div className="font-medium text-text-main">{row.name}</div><div className="text-text-muted">{row.advice} · 429 {row.rate429} · p95 {row.p95 ? Math.round(row.p95) : "—"}ms</div></div>)}
          {data.timeoutAdvisor.slice(0, 3).map((row) => <Row key={`timeout-${row.name}`} label={`${row.name} timeout`} value={`${Math.round(row.recommendedMs / 1000)}s`} />)}
        </Panel>

        <Panel title="7. Deprecation & pricing radar" hint="model">
          {data.deprecations ? <pre className="max-h-24 overflow-auto text-[10px] text-text-muted">{JSON.stringify(data.deprecations).slice(0, 500)}</pre> : <p className="text-xs text-text-muted">Belum ada file `~/.meai/model-deprecations.json`; radar belum memiliki data.</p>}
          {data.priceDiff ? <Row label="Pricing diff" value={`+${data.priceDiff.added?.length || 0} / −${data.priceDiff.removed?.length || 0} / Δ${data.priceDiff.changed?.length || 0}`} /> : <Row label="Pricing diff" value="belum ada snapshot" />}
        </Panel>

        <Panel title="8. Capability coverage" hint={`${data.capabilityCoverage.length} provider`}>
          {data.capabilityCoverage.map((row) => <Row key={row.provider} label={row.provider} value={`score ${row.score ?? "—"}`} />)}
        </Panel>

        <Panel title="9. Budget confidence" hint={data.budgetConfidence.confidence}>
          <Row label="Spend hari ini" value={usd(data.budgetConfidence.pacing.spendToday)} />
          <Row label="Projected" value={`${usd(data.budgetConfidence.projectedLow)}–${usd(data.budgetConfidence.projectedHigh)}`} />
          <Row label="Budget" value={data.budgetConfidence.pacing.budget ? usd(data.budgetConfidence.pacing.budget) : "belum diset"} />
          <Row label="Status" value={data.budgetConfidence.pacing.status} tone={data.budgetConfidence.pacing.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} />
        </Panel>

        <Panel title="10. Cost allocation" hint="per key">
          {data.costAllocation.length === 0 ? <p className="text-xs text-text-muted">Belum ada usage per key.</p> : data.costAllocation.map((row) => <Row key={row.name} label={row.name} value={`${usd(row.cost)} · ${fmt(row.requests)} req`} />)}
        </Panel>

        <Panel title="11. Alert webhook" hint={data.webhook.configured ? "configured" : "not configured"}>
          <Row label="Status" value={data.webhook.configured ? "aktif" : "belum diset"} tone={data.webhook.configured ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} />
          <Row label="Host" value={data.webhook.urlHost || "—"} />
          <p className="text-[10px] text-text-muted">Set `alertWebhookUrl` di Settings untuk mengaktifkan.</p>
        </Panel>

        <Panel title="12. Performance & storage" hint="snapshot">
          <Row label="DB size" value={bytes(data.performance.dbBytes)} />
          <Row label="Usage rows" value={fmt(data.performance.usageRows)} />
          <Row label="Quota rows" value={fmt(data.performance.quotaRows)} />
          <Row label="Timeline buckets" value={fmt(data.performance.timelineBuckets)} />
        </Panel>
      </div>
    </div>
  );
}
