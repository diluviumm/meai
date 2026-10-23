"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

const fmt = (n) => new Intl.NumberFormat("id-ID").format(Number(n) || 0);
const usd = (n) => `$${(Number(n) || 0).toFixed(4)}`;
const idr = (n, rate) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format((Number(n) || 0) * rate);

export default function InvoicePage() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [rate, setRate] = useState("16000");
  const [tax, setTax] = useState("0");
  const [settingMsg, setSettingMsg] = useState("");

  useEffect(() => {
    fetch(`/api/billing/invoice?period=${period}&format=json`, { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((payload) => { setError(""); setData(payload); setRate(String(payload.rate)); setTax(String(payload.taxPct)); })
      .catch((err) => setError(err.message));
  }, [period]);

  const saveInvoiceSettings = async () => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usdToIdr: Number(rate), invoiceTaxPct: Number(tax) }),
    });
    setSettingMsg(response.ok ? "Pengaturan invoice disimpan." : `Gagal menyimpan (HTTP ${response.status}).`);
    if (response.ok) {
      const payload = await fetch(`/api/billing/invoice?period=${period}&format=json`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (payload) { setData(payload); setRate(String(payload.rate)); setTax(String(payload.taxPct)); }
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-main">Invoice / Rekap Biaya</h1>
          <p className="mt-0.5 text-xs text-text-muted">Format Indonesia · IDR · bukan faktur pajak resmi.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Periode invoice" className="h-8 rounded-full border border-border bg-surface px-3 text-xs text-text-main">
            <option value="today">Hari ini</option>
            <option value="7d">7 hari</option>
            <option value="30d">30 hari</option>
          </select>
          <a href={`/api/billing/invoice?period=${period}`} className="inline-flex min-h-11 items-center rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary">Download PDF</a>
        </div>
      </div>

      {error ? <Card className="border-danger/30 bg-danger/10 p-4 text-sm text-danger">Gagal memuat invoice: {error}</Card> : null}
      {!data ? <div className="h-64 animate-pulse rounded-2xl bg-surface-2" /> : (
        <>
          <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <div><div className="text-[10px] uppercase text-text-muted">Nomor</div><div className="mt-1 text-xs font-semibold text-text-main">{data.invoiceNo}</div></div>
            <div><div className="text-[10px] uppercase text-text-muted">Periode</div><div className="mt-1 text-xs font-semibold text-text-main">{data.label}</div></div>
            <div><div className="text-[10px] uppercase text-text-muted">Kurs</div><div className="mt-1 text-xs font-semibold text-text-main">1 USD = {fmt(data.rate)} IDR</div></div>
            <div><div className="text-[10px] uppercase text-text-muted">PPN</div><div className="mt-1 text-xs font-semibold text-text-main">{data.taxPct}%</div></div>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4"><div className="text-[10px] uppercase text-text-muted">Total USD</div><div className="mt-1 text-xl font-bold text-text-main">{usd(data.totalUsd)}</div></Card>
            <Card className="p-4"><div className="text-[10px] uppercase text-text-muted">PPN</div><div className="mt-1 text-xl font-bold text-text-main">{idr(data.taxUsd, data.rate)}</div></Card>
            <Card className="p-4"><div className="text-[10px] uppercase text-text-muted">Total IDR</div><div className="mt-1 text-xl font-bold text-primary">{idr(data.grandUsd, data.rate)}</div></Card>
          </div>

          <Card className="min-w-0 p-3 sm:p-4">
            <h2 className="mb-2 text-sm font-semibold text-text-main">Rincian per API key</h2>
            <div className="overflow-x-auto" tabIndex={0} aria-label="Rincian invoice per API key">
              <table className="w-full min-w-[620px] text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-wide text-text-muted"><tr><th className="py-1 pr-2">Label / key</th><th className="pr-2">Request</th><th className="pr-2">Token</th><th className="pr-2">USD</th><th>IDR</th></tr></thead>
                <tbody>
                  {data.rows.length === 0 ? <tr><td colSpan={5} className="py-3 text-text-muted">Belum ada usage pada periode ini.</td></tr> : data.rows.map((row) => (
                    <tr key={row.keyName || row.apiKeyMasked} className="border-t border-border/50">
                      <td className="max-w-[220px] truncate py-1.5 pr-2 text-text-main" title={row.keyName}>{row.keyName}</td>
                      <td className="pr-2 text-text-muted">{fmt(row.requests)}</td>
                      <td className="pr-2 text-text-muted">{fmt(Number(row.promptTokens || 0) + Number(row.completionTokens || 0))}</td>
                      <td className="pr-2 text-text-main">{usd(row.cost)}</td>
                      <td className="text-text-main">{idr(row.cost, data.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-text-main">Pengaturan invoice (kurs &amp; PPN)</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-[10px] text-text-muted">1 USD → IDR
                  <input type="number" min="1" step="1" value={rate} onChange={(event) => setRate(event.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-xs text-text-main" />
                </label>
                <label className="flex flex-col gap-1 text-[10px] text-text-muted">PPN (%)
                  <input type="number" min="0" max="100" step="1" value={tax} onChange={(event) => setTax(event.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-xs text-text-main" />
                </label>
                <div className="flex items-end"><Button variant="secondary" size="sm" onClick={saveInvoiceSettings}>Simpan pengaturan</Button></div>
              </div>
              {settingMsg ? <p className="mt-2 text-[10px] text-text-muted">{settingMsg}</p> : null}
            </details>
          </Card>

          <Card className="p-4 text-[11px] text-text-muted">
            <p><strong className="text-text-main">Catatan:</strong> rekap dihitung dari usageHistory dan pricing MeAI. PPN mengikuti setting <code>invoiceTaxPct</code> (default 0%). Dokumen ini bukan faktur pajak resmi.</p>
            <p className="mt-1">Label biaya diatur di <a href="/dashboard/governance" className="inline-flex min-h-11 items-center text-primary hover:underline">Governance → Cost allocation</a>. Kurs diatur lewat setting <code>usdToIdr</code>.</p>
          </Card>

          <div>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>Print halaman</Button>
          </div>
        </>
      )}
    </div>
  );
}
