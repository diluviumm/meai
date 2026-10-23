"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const COMMANDS = [
  { href: "/dashboard/overview", label: "Overview", icon: "space_dashboard" },
  { href: "/dashboard/insights", label: "Insights & Health", icon: "monitoring" },
  { href: "/dashboard/governance", label: "Governance & Safety", icon: "policy" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/quota/history", label: "Riwayat Quota", icon: "history" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/guide", label: "Panduan", icon: "menu_book" },
  { href: "/dashboard/settings/pricing", label: "Pricing", icon: "payments" },
  { href: "/dashboard/profile", label: "Profile", icon: "person" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter((item) => !q || item.label.toLowerCase().includes(q) || item.href.includes(q));
  }, [query]);

  if (!open) return null;

  const go = (item) => {
    if (!item) return;
    router.push(item.href);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <span className="material-symbols-outlined text-text-muted">search</span>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActive((v) => Math.min(results.length - 1, v + 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActive((v) => Math.max(0, v - 1)); }
              if (event.key === "Enter") go(results[active]);
            }}
            placeholder="Cari halaman… (Ctrl/⌘ K)"
            aria-label="Cari halaman dashboard"
            className="h-12 flex-1 bg-transparent text-sm text-text-main outline-none placeholder:text-text-muted"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? <p className="p-3 text-xs text-text-muted">Tidak ada halaman cocok.</p> : results.map((item, index) => (
            <button
              key={item.href}
              type="button"
              onClick={() => go(item)}
              onMouseEnter={() => setActive(index)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${index === active ? "bg-primary/15 text-text-main" : "text-text-muted hover:bg-surface-2"}`}
            >
              <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              <span className="text-[9px] opacity-60">{item.href}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
