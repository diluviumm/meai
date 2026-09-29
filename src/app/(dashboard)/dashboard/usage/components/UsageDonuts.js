"use client";

import PropTypes from "prop-types";
import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import Card from "@/shared/components/Card";

const TOKEN_COLORS = ["#8b7ce8", "#2f9e5e", "#5b7fd4"]; // medium: kontras utk light+dark
const MODEL_COLORS = ["#8b7ce8", "#2f9e5e", "#c9882f", "#d45a75", "#5b7fd4", "#7c7c8a"];

const fmt = (n) => {
  const v = n || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
};

// Ronde-37: formatter utk donut Cost — nilai uang harus selalu bertanda $.
const fmtMoney = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v > 0) return `$${v.toFixed(4)}`;
  return "$0";
};

const centerLabel = (total, caption, format = fmt) => (
  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
    <span className="text-lg font-bold text-text-main">{format(total)}</span>
    <span className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">{caption}</span>
  </div>
);

function Donut({ data, colors, caption, total, format }) {
  const shown = data.filter((d) => d.value > 0);
  const fmtVal = format || fmt;
  if (!shown.length) {
    return (
      <div className="flex min-h-[170px] flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-border-subtle bg-bg/40">
        <span className="text-2xl">◍</span>
        <span className="text-xs text-text-subtle">belum ada data</span>
      </div>
    );
  }
  return (
    // Ronde-35: kolom (bukan baris) — sebelumnya `items-center` di baris membuat
    // <ul> legend ikut terpusat secara vertikal dan MENIMPA label center donut.
    <div className="relative flex min-h-[170px] flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-border-subtle bg-bg/40 py-2">
      {/* pembungkus relatif: label center hanya menempel pada area donut */}
      <div className="relative w-full">
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={3} strokeWidth={0}>
              {shown.map((d, i) => (
                <Cell key={d.name} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, fontSize: 12 }}
              itemStyle={{ color: "var(--color-text-main)" }}
              formatter={(v, n) => [fmtVal(v), n]}
            />
          </PieChart>
        </ResponsiveContainer>
        {centerLabel(total, caption, fmtVal)}
      </div>
      <ul className="relative z-10 flex w-full flex-wrap justify-center gap-x-3 gap-y-0.5 px-1">
        {shown.map((d, i) => (
          <li key={d.name} className="flex items-center gap-1 text-[11px] text-text-muted">
            <span className="inline-block size-2 rounded-full" style={{ background: colors[i % colors.length] }} />
            {d.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

Donut.propTypes = {
  data: PropTypes.array.isRequired,
  colors: PropTypes.array.isRequired,
  caption: PropTypes.string.isRequired,
  total: PropTypes.number,
  format: PropTypes.func,
};

/** Donat visualisasi ronde-26: distribusi token (in/out/cached) + request per model
 *  Ronde-37: + donut COST per provider — selama ini kartu ini hanya menunjukkan
 *  token & model, padahal yang paling sering ditanya adalah "biaya dari mana". */
export default function UsageDonuts({ stats }) {
  const tokenFlow = useMemo(
    () => [
      { name: "Input", value: stats?.totalPromptTokens || 0 },
      { name: "Output", value: stats?.totalCompletionTokens || 0 },
      { name: "Cached", value: stats?.totalCachedTokens || 0 },
    ],
    [stats]
  );

  const byModel = useMemo(() => {
    const src = stats?.byModel || {};
    const rows = Object.entries(src)
      .map(([key, d]) => ({ name: d.rawModel || key.split(" (")[0], value: (d.promptTokens || 0) + (d.completionTokens || 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    return rows;
  }, [stats]);

  const totalTokens = (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0);
  const totalModelTokens = byModel.reduce((s, d) => s + d.value, 0);

  // Ronde-37: biaya per provider (data sudah ada di stats.byProvider.cost)
  const byCost = useMemo(() => {
    const src = stats?.byProvider || {};
    return Object.entries(src)
      .map(([id, d]) => ({ name: id, value: d.cost || 0 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [stats]);
  const totalCost = byCost.reduce((s, d) => s + d.value, 0);

  return (
    <Card padding="sm" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">donut_small</span>
        <div>
          <h3 className="text-sm font-semibold text-text-main">Distribusi</h3>
          <p className="text-xs text-text-muted">Token, model &amp; biaya per provider</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
        <Donut data={tokenFlow} colors={TOKEN_COLORS} caption="token" total={totalTokens} />
        <Donut data={byModel} colors={MODEL_COLORS} caption="per model" total={totalModelTokens} />
        <Donut
          data={byCost}
          colors={[MODEL_COLORS[0], MODEL_COLORS[3], MODEL_COLORS[2], MODEL_COLORS[4], MODEL_COLORS[1]]}
          caption="cost"
          total={totalCost}
          format={fmtMoney}
        />
      </div>
    </Card>
  );
}

UsageDonuts.propTypes = { stats: PropTypes.object };
