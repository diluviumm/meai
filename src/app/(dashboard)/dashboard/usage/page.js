"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import UsageStats, {
  UsageViewControls,
  REFRESH_STORAGE_KEY,
  REFRESH_DEFAULT_MS,
  defaultRange,
} from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";
import BudgetBar from "./components/BudgetBar";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
  // Ronde-35: rentang hari bebas — preset di atas tetap ada, tidak dihapus.
  { value: "custom", label: "Custom" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");

  // Ronde-35: rentang hari kustom + interval auto-refresh (satu sumber kebenaran
  // untuk tab, chart, tabel, dan ekspor CSV).
  const [range, setRange] = useState(defaultRange);
  const [refreshMs, setRefreshMs] = useState(REFRESH_DEFAULT_MS);

  // Interval terakhir dibaca setelah mount — localStorage tidak ada saat SSR,
  // jadi membacanya di state awal akan memicu hydration mismatch. Update juga
  // ditunda ke tick berikutnya supaya bukan setState sinkron dalam effect.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(REFRESH_STORAGE_KEY);
        if (raw !== null) {
          const saved = Number(raw);
          if (Number.isFinite(saved) && saved >= 0) setRefreshMs(saved);
        }
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const changeRefresh = (ms) => {
    setRefreshMs(ms);
    try { localStorage.setItem(REFRESH_STORAGE_KEY, String(ms)); } catch {}
  };

  const periodQuery =
    period === "custom"
      ? `period=custom&from=${range.from}&to=${range.to}`
      : `period=${period}`;

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  // Export CSV (ronde-31): series harian + byProvider + byModel
  const exportCsv = async () => {
    try {
      const [chart, stats] = await Promise.all([
        fetch(`/api/usage/chart?${periodQuery}`).then((r) => r.json()),
        fetch(`/api/usage/stats?${periodQuery}`).then((r) => r.json()),
      ]);
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const num = (v) => Number(v || 0);
      const rows = [];
      rows.push(["MeAI usage export", `period=${period === "custom" ? `${range.from}..${range.to}` : period}`, new Date().toISOString()].map(esc).join(","));
      rows.push("");
      rows.push(["Daily", "Requests", "Tokens", "Cost (USD)"].map(esc).join(","));
      for (const d of chart || []) rows.push([d.label, num(d.requests), num(d.tokens), num(d.cost).toFixed(6)].map(esc).join(","));
      rows.push("");
      rows.push(["By provider", "Requests", "Prompt", "Completion", "Cached", "Cost (USD)"].map(esc).join(","));
      for (const [prov, v] of Object.entries(stats.byProvider || {})) {
        rows.push([prov, num(v.requests), num(v.promptTokens), num(v.completionTokens), num(v.cachedTokens), num(v.cost).toFixed(6)].map(esc).join(","));
      }
      rows.push("");
      rows.push(["By model", "Requests", "Prompt", "Completion", "Cost (USD)"].map(esc).join(","));
      for (const [model, v] of Object.entries(stats.byModel || {})) {
        rows.push([model, num(v.requests), num(v.promptTokens), num(v.completionTokens), num(v.cost).toFixed(6)].map(esc).join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `meai-usage-${period === "custom" ? `${range.from}_${range.to}` : period}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error("CSV export failed:", err);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {activeTab === "overview" && (
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              className="w-full sm:w-auto"
            />
          )}
          {activeTab === "overview" && (
            <>
              <button
                type="button"
                onClick={exportCsv}
                title="Download usage as CSV (daily + provider + model breakdown)"
                className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                <span className="hidden sm:inline">CSV</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                title="Print / save this usage page as PDF"
                className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>
                <span className="hidden sm:inline">PDF</span>
              </button>
            </>
          )}
        </div>
      </div>

      {activeTab === "overview" && (
        <>
          <UsageViewControls
            period={period}
            range={range}
            onRangeChange={setRange}
            refreshMs={refreshMs}
            onRefreshChange={changeRefresh}
          />
          <BudgetBar />
          <Suspense fallback={<CardSkeleton />}>
            <UsageStats
              period={period}
              setPeriod={setPeriod}
              hidePeriodSelector
              from={range.from}
              to={range.to}
              refreshMs={refreshMs}
            />
          </Suspense>
        </>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
