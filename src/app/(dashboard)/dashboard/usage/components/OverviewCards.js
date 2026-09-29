"use client";

import PropTypes from "prop-types";
import { useMemo } from "react";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => {
  const v = n || 0;
  return `$${v >= 0.01 ? v.toFixed(2) : v > 0 ? v.toFixed(4) : "0.00"}`;
};

// Ronde-37: angka ringkas utk caption — 44.355.020 jauh lebih cepat dibaca
// sebagai "44.4M" ketika dipakai sebagai keterangan, bukan sebagai nilai utama.
const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};

/** jumlah selama 10 menit terakhir (dari sparkline) */
const sum10 = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);

/** Sparkline mini (10 titik menit terakhir) + dot nilai akhir — ronde-28 */
function Spark({ series, color }) {
  const geom = useMemo(() => {
    const pts = (series || []).map((v) => (Number.isFinite(v) ? v : 0));
    if (pts.length < 2) return null;
    const max = Math.max(...pts);
    const min = Math.min(...pts);
    const flat = max === min; // data datar (mis. 0 traffic) -> garis di tengah agar tetap terlihat
    const range = flat ? 1 : max - min;
    const w = 100;
    const h = 22;
    const yOf = (v) => (flat ? h / 2 : h - ((v - min) / range) * (h - 4) - 2);
    const d = pts
      .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * w).toFixed(1)},${yOf(v).toFixed(1)}`)
      .join(" ");
    return { line: d, area: `${d} L${w},${h} L0,${h} Z`, endX: w, endY: yOf(pts[pts.length - 1]) };
  }, [series]);
  if (!geom) return <div className="h-[22px]" aria-hidden />;
  return (
    <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="h-[22px] w-full" aria-hidden>
      <path d={geom.area} fill={color} opacity="0.16" />
      <path
        d={geom.line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* dot nilai terakhir — indikator tetap terlihat walau garis flat */}
      <circle cx={geom.endX - 1.5} cy={geom.endY} r="2.4" fill={color} />
    </svg>
  );
}

Spark.propTypes = {
  series: PropTypes.array,
  color: PropTypes.string,
};

function KpiCard({ label, value, colorClass, title, series, caption, sparkColor }) {
  return (
    <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
      {/* label blok tinggi tetap -> angka & sparkline sejajar horizontal lintas kartu */}
      <span className="flex min-h-[32px] items-center justify-center text-xs uppercase font-semibold leading-tight tracking-[0.03em] text-text-muted sm:text-sm">
        {label}
      </span>
      <span className={`w-full truncate text-lg font-bold xl:text-xl ${colorClass}`} title={title}>
        {value}
      </span>
      <div className="w-full opacity-80">
        <Spark
          series={series}
          color={
            sparkColor ||
            (colorClass.includes("primary")
              ? "#8b7ce8"
              : colorClass.includes("success")
                ? "#2f9e5e"
                : colorClass.includes("info")
                  ? "#5b7fd4"
                  : colorClass.includes("warning")
                    ? "#c9882f"
                    : "#94949f")
          }
        />
      </div>
      <span className="text-[10px] text-text-subtle">{caption}</span>
    </Card>
  );
}

KpiCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  colorClass: PropTypes.string.isRequired,
  title: PropTypes.string,
  series: PropTypes.array,
  caption: PropTypes.string,
  sparkColor: PropTypes.string,
};

/** KPI + sparkline live (last10Minutes) — ronde-26; sejajar + caption EN + cached series — ronde-28 */
export default function OverviewCards({ stats }) {
  const last = stats?.last10Minutes || [];
  const series = {
    req: last.map((d) => d.requests || 0),
    inp: last.map((d) => d.promptTokens || 0),
    cached: last.map((d) => d.cachedTokens || 0),
    out: last.map((d) => d.completionTokens || 0),
    cost: last.map((d) => d.cost || 0),
  };
  const last10Req = sum10(series.req);
  const last10Inp = sum10(series.inp);
  const last10Out = sum10(series.out);
  const last10Cached = sum10(series.cached);

  // Ronde-37: tiap kartu wajib punya caption yang BERMAKNA.
  // Sebelumnya dua kartu cuma berbunyi "10-min sparkline" (tidak menjelaskan
  // apa pun) dan kartu Cached tidak menunjukkan seberapa besar hit rate-nya.
  const hitRate =
    stats.totalPromptTokens > 0
      ? Math.round((stats.totalCachedTokens / stats.totalPromptTokens) * 100)
      : null;
  const perReq = stats.totalRequests > 0 ? stats.totalCost / stats.totalRequests : 0;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      <KpiCard
        label="Total Requests"
        value={fmt(stats.totalRequests)}
        colorClass="text-text-main"
        title={fmt(stats.totalRequests)}
        series={series.req}
        sparkColor="#8b7ce8"
        caption={`+${fmtCompact(last10Req)} in last 10 min`}
      />
      <KpiCard
        label="Total Input Tokens"
        value={fmt(stats.totalPromptTokens)}
        colorClass="text-primary"
        title={fmt(stats.totalPromptTokens)}
        series={series.inp}
        caption={`+${fmtCompact(last10Inp)} in 10 min`}
      />
      <KpiCard
        label="Cached Tokens"
        value={fmt(stats.totalCachedTokens)}
        colorClass="text-info"
        title={`${fmt(stats.totalCachedTokens)} (${hitRate ?? 0}% dari input)`}
        series={series.cached}
        caption={hitRate === null ? "cache hits" : `${hitRate}% hit rate · +${fmtCompact(last10Cached)} in 10 min`}
      />
      <KpiCard
        label="Output Tokens"
        value={fmt(stats.totalCompletionTokens)}
        colorClass="text-success"
        title={fmt(stats.totalCompletionTokens)}
        series={series.out}
        caption={`+${fmtCompact(last10Out)} in 10 min`}
      />
      <KpiCard
        label="Est. Cost"
        value={`~${fmtCost(stats.totalCost)}`}
        colorClass="text-warning"
        title={`~${fmtCost(stats.totalCost)} · ${fmt(stats.totalRequests)} request`}
        series={series.cost}
        caption={`~$${perReq.toFixed(4)} / request`}
      />
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
