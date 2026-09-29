"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

/**
 * Budget harian (ronde-31): progress bar pemakaian cost hari ini vs ambang,
 * + peringatan saat lewat. Setting disimpan di settings.costBudgetDaily (USD).
 * Mandiri: fetch sendiri settings + stats hari ini (tanpa prop drilling).
 */
export default function BudgetBar({ refreshMs }) {
  const [budget, setBudget] = useState(null); // null = belum diset
  const [used, setUsed] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // Ronde-38: waktu disimpan di state (bukan Date.now() saat render) supaya
  // render server & client identik — kalau tidak, teks proyeksi bakal beda
  // dan memicu peringatan hydration.
  const [now, setNow] = useState(0);

  // Ronde-38: sebelumnya stats hari ini diambil SEKALI saat mount, jadi bar
  // membekuk selamanya kalau halaman dibiarkan terbuka (halaman Usage di sebelahnya
  // justru auto-refresh). Kini ikut interval yang dipilih pengguna.
  const interval = refreshMs > 0 ? refreshMs : 30000;
  useEffect(() => {
    let alive = true;
    let settingsTick = 0;
    const load = async () => {
      try {
        const needSettings = settingsTick++ % 10 === 0; // settings cukup tiap 10 siklus
        const [s, u] = await Promise.all([
          needSettings
            ? fetch("/api/settings").then((r) => (r.ok ? r.json() : null))
            : Promise.resolve(null),
          fetch("/api/usage/stats?period=today").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (!alive) return;
        if (s && typeof s.costBudgetDaily === "number") setBudget(s.costBudgetDaily);
        if (u) setUsed(Number(u.totalCost) || 0);
        setNow(Date.now());
      } catch { /* diam — bar tetap tampil */ }
    };
    load();
    const id = setInterval(load, interval);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [interval]);

  // jam dinding utk proyeksi (tick tiap menit). Nilai awal datang dari load()
  // (callback async) — memanggil setNow() sinkron di badan effect dilarang
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const save = async () => {
    const v = parseFloat(String(draft).replace(",", "."));
    if (!Number.isFinite(v) || v < 0) { setEditing(false); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costBudgetDaily: v }),
      });
      if (r.ok) setBudget(v);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const over = budget > 0 && used > budget;
  const warn = budget > 0 && !over && pct >= 80;
  const money = (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}`;

  // Ronde-38: proyeksi akhir hari — laju rata-rata × 24 jam. Hanya dihitung
  // setelah 45 menit berlalu supaya angka awal hari tidak menyesatkan.
  // Date.now() DIPINDAHKAN ke callback (load/interval); di badan render hanya
  // konstanta `0` sehingga komponen tetap murni (react-hooks/purity).
  const hasNow = Number.isFinite(now) && now > 0;
  const dayStart = new Date(hasNow ? now : 0);
  dayStart.setHours(0, 0, 0, 0);
  const elapsedMin = hasNow ? Math.max(1, (now - dayStart.getTime()) / 60000) : 0;
  const projected = elapsedMin > 0 ? (used / elapsedMin) * 1440 : 0;
  const showProj = hasNow && budget > 0 && elapsedMin >= 45 && used > 0;
  const projPct = showProj ? Math.round((projected / budget) * 100) : 0;
  const projOver = showProj && projected > budget;

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">payments</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Daily budget
          </span>
        </div>

        {editing ? (
          <span className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.1"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
              className="h-7 w-24 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary outline-none focus:border-primary dark:border-white/10 dark:bg-white/[0.04]"
              placeholder="USD / hari"
              aria-label="Daily budget in USD"
            />
            <button
              onClick={save}
              disabled={saving}
              className="h-7 rounded-lg bg-primary px-2.5 text-xs font-semibold text-[#171232] transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="h-7 rounded-lg border border-border px-2.5 text-xs text-text-main transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => { setDraft(budget != null ? String(budget) : ""); setEditing(true); }}
            className="group flex items-center gap-1.5 text-xs text-text-main transition-colors hover:text-primary"
            title="Klik utk atur ambang budget harian"
          >
            <b className="text-sm">{money(used)}</b>
            <span className="text-text-muted">/</span>
            <b className="text-sm">{budget > 0 ? money(budget) : "—"}</b>
            <span className="material-symbols-outlined text-[13px] text-text-muted group-hover:text-primary">edit</span>
          </button>
        )}

        {/* progress */}
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-primary"}`}
              style={{ width: `${budget > 0 ? pct : 0}%` }}
            />
          </div>
          <span className={`w-10 text-right text-xs font-semibold tabular-nums ${over ? "text-red-600 dark:text-red-400" : warn ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}`}>
            {budget > 0 ? `${pct}%` : "off"}
          </span>
        </div>

        {over && (
          <span className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400">
            <span className="material-symbols-outlined text-[14px]">warning</span>
            Over budget by {money(used - budget)}
          </span>
        )}
        {warn && !over && (
          <span className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            <span className="material-symbols-outlined text-[14px]">hourglass_bottom</span>
            {pct}% of budget used
          </span>
        )}
        {/* Ronde-38: proyeksi akhir hari — jawaban "kalau laju ini berlanjut,
            berapa yang habis?" Sebelumnya hanya ada angka berjalan hari ini. */}
        {showProj && (
          <span
            title={`Laju rata-rata ${money(used / elapsedMin)}/menit selama ${Math.floor(elapsedMin)} menit terakhir → ${money(projected)} dalam 24 jam`}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
              projOver
                ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                : "border-border bg-surface-2 text-text-muted"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">monitoring</span>
            Proyeksi akhir hari <b className={projOver ? "" : "text-text-main"}>{money(projected)}</b>
            <span className="opacity-70">({projPct}%)</span>
          </span>
        )}
      </div>
    </Card>
  );
}

BudgetBar.propTypes = {
  refreshMs: PropTypes.number,
};
