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
  const [webhookResult, setWebhookResult] = useState(null);
  const [pricingState, setPricingState] = useState(null);
  const [costLabels, setCostLabels] = useState({});
  const [probeModel, setProbeModel] = useState("cbcn/deepseek-v4.1-flash");
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState(null);

  const load = () => fetch("/api/governance", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((payload) => {
    setData(payload);
    setCostLabels(Object.fromEntries((payload.costAllocation || []).map((row) => [row.name, row.label || ""])));
  }).catch((err) => setError(err.message));

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

  const testWebhook = async () => {
    const response = await fetch("/api/governance/webhook", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    setWebhookResult(payload);
    setNotice(payload.ok ? `Webhook OK (HTTP ${payload.status}).` : payload.error || "Webhook gagal.");
  };

  const snapshotPricing = async () => {
    const response = await fetch("/api/governance/pricing-snapshot", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(payload.error || "Pricing snapshot gagal.");
    else { setPricingState(payload.count); setNotice(`Pricing snapshot: ${payload.count} model.`); load(); }
  };

  const runProbe = async () => {
    setProbeBusy(true);
    setProbeResult(null);
    const response = await fetch("/api/governance/live-probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: probeModel }) });
    const payload = await response.json().catch(() => ({}));
    setProbeResult(payload);
    setProbeBusy(false);
    setNotice(payload.ok ? `Probe ${probeModel}: HTTP ${payload.status} · ${payload.latencyMs}ms` : payload.error || "Probe gagal.");
  };

  const saveCostLabel = async (name) => {
    const response = await fetch("/api/governance/cost-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, label: costLabels[name] }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(payload.error || "Label gagal disimpan.");
    else { setNotice("Label biaya disimpan."); load(); }
  };

  if (error) return <div className="p-4"><Card className="border-danger/30 bg-danger/10 p-4 text-sm text-danger">Gagal memuat governance: {error}</Card></div>;
  if (!data) return <div className="p-4"><div className="h-64 animate-pulse rounded-2xl bg-surface-2" /></div>;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold text-text-main">Governance & Safety</h1><p className="mt-0.5 text-xs text-text-muted">12 pemeriksaan operasional: backup, drift, katalog, biaya, webhook, performa, dan probe manual.</p></div>
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

        <Panel title="5. Catalog changes" hint={data.catalogDiff.available ? "snapshot harian" : "belum ada"}>
          {!data.catalogDiff.available ? <p className="text-xs text-text-muted">Belum ada `catalog-diff.json`; jalankan catalog watcher.</p> : (
            <>
              <Row label="Model saat ini" value={fmt(data.catalogDiff.count)} />
              <Row label="Ditambah" value={`+${data.catalogDiff.added}`} tone={data.catalogDiff.added ? "text-emerald-600 dark:text-emerald-400" : "text-text-muted"} />
              <Row label="Dihapus" value={`−${data.catalogDiff.removed}`} tone={data.catalogDiff.removed ? "text-amber-600 dark:text-amber-400" : "text-text-muted"} />
              <Row label="Snapshot" value={data.catalogDiff.ts ? new Date(data.catalogDiff.ts * 1000).toLocaleString() : "—"} />
            </>
          )}
        </Panel>

        <Panel title="6. Deprecation & pricing radar" hint="model">
          {data.deprecations ? <pre className="max-h-24 overflow-auto text-[10px] text-text-muted">{JSON.stringify(data.deprecations).slice(0, 500)}</pre> : <p className="text-xs text-text-muted">Belum ada file `~/.meai/model-deprecations.json`; radar belum memiliki data.</p>}
          {data.priceDiff ? <Row label="Pricing diff" value={`+${data.priceDiff.added?.length || 0} / −${data.priceDiff.removed?.length || 0} / Δ${data.priceDiff.changed?.length || 0}`} /> : <Row label="Pricing diff" value="belum ada snapshot" />}
          <Button variant="ghost" size="xs" onClick={snapshotPricing}>Snapshot pricing</Button>
          {pricingState ? <p className="text-[10px] text-text-muted">{pricingState} model tersimpan.</p> : null}
        </Panel>

        <Panel title="7. Capability coverage" hint={`${data.capabilityCoverage.length} provider`}>
          {data.capabilityCoverage.map((row) => <Row key={row.provider} label={row.provider} value={`score ${row.score ?? "—"}`} />)}
        </Panel>

        <Panel title="8. Budget confidence" hint={data.budgetConfidence.confidence}>
          <Row label="Spend hari ini" value={usd(data.budgetConfidence.pacing.spendToday)} />
          <Row label="Projected" value={`${usd(data.budgetConfidence.projectedLow)}–${usd(data.budgetConfidence.projectedHigh)}`} />
          <Row label="Budget" value={data.budgetConfidence.pacing.budget ? usd(data.budgetConfidence.pacing.budget) : "belum diset"} />
          <Row label="Status" value={data.budgetConfidence.pacing.status} tone={data.budgetConfidence.pacing.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} />
        </Panel>

        <Panel title="9. Cost allocation" hint="label bebas">
          {data.costAllocation.length === 0 ? <p className="text-xs text-text-muted">Belum ada usage per key.</p> : data.costAllocation.map((row) => (
            <div key={row.name} className="border-t border-border/50 py-1.5">
              <div className="flex items-center justify-between gap-2 text-[10px]"><span className="truncate text-text-muted" title={row.name}>{row.name}</span><span className="shrink-0 text-text-main">{usd(row.cost)} · {fmt(row.requests)} req</span></div>
              <div className="mt-1 flex gap-1">
                <input value={costLabels[row.name] || ""} onChange={(event) => setCostLabels((current) => ({ ...current, [row.name]: event.target.value }))} maxLength={40} placeholder="Label proyek/tim" aria-label={`Label biaya ${row.name}`} className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-[10px] text-text-main" />
                <button type="button" onClick={() => saveCostLabel(row.name)} className="rounded border border-border px-2 text-[9px] text-primary">Simpan</button>
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="10. Alert webhook" hint={data.webhook.configured ? "configured" : "not configured"}>
          <Row label="Status" value={data.webhook.configured ? "aktif" : "belum diset"} tone={data.webhook.configured ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} />
          <Row label="Host" value={data.webhook.urlHost || "—"} />
          <p className="text-[10px] text-text-muted">Set `alertWebhookUrl` di Settings untuk mengaktifkan.</p>
          <Button variant="secondary" size="sm" onClick={testWebhook} disabled={!data.webhook.configured}>Test webhook</Button>
          {webhookResult ? <p className="text-[10px] text-text-muted">{webhookResult.ok ? `HTTP ${webhookResult.status}` : webhookResult.error}</p> : null}
        </Panel>

        <Panel title="11. Performance & storage" hint="snapshot">
          <Row label="DB size" value={bytes(data.performance.dbBytes)} />
          <Row label="Usage rows" value={fmt(data.performance.usageRows)} />
          <Row label="Quota rows" value={fmt(data.performance.quotaRows)} />
          <Row label="Timeline buckets" value={fmt(data.performance.timelineBuckets)} />
        </Panel>

        <Panel title="12. Live probe (manual)" hint="1 request">
          <p className="text-[10px] text-text-muted">Membuat API key sementara, mengirim satu request kecil, lalu menghapusnya. Tidak dijadwalkan otomatis karena provider dapat menagih request.</p>
          <div className="flex gap-1">
            <input value={probeModel} onChange={(event) => setProbeModel(event.target.value)} maxLength={120} aria-label="Model untuk live probe" placeholder="cbcn/deepseek-v4.1-flash" className="h-8 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-[10px] text-text-main" />
            <Button variant="secondary" size="sm" onClick={runProbe} disabled={probeBusy || !probeModel.trim()}>{probeBusy ? "Probe…" : "Probe"}</Button>
          </div>
          {probeResult ? (
            <div className={`rounded-md border p-2 text-[10px] ${probeResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-danger/30 bg-danger/10 text-danger"}`}>
              <div className="font-semibold">HTTP {probeResult.status ?? "—"} · {probeResult.latencyMs ?? "—"}ms</div>
              <div className="mt-0.5 break-words">{probeResult.ok ? `usage ${probeResult.usage?.total_tokens ?? "—"} token` : probeResult.error || "gagal"}</div>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
