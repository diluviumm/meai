"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import useSettingsStore from "@/store/settingsStore"; // dipakai fetchSettings di region auto-merge (ronde-36)
import Button from "./Button";
import Modal from "./Modal";


const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
];

const systemItems = []; // FORK-MAEL: Proxy Pools + Skills dihapus dari menu (25 Sep 2026, reversible: git)

/** Item navigasi sidebar — ronde-26 (rail glow + icon chip + hover transform) */
function NavItem({ href, label, icon, active, onClose }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={cn(
        "relative flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-200 group",
        active
          ? "bg-gradient-to-r from-primary/[0.16] to-primary/[0.04] text-primary"
          : "text-text-muted hover:bg-surface-2/70 hover:text-text-main hover:translate-x-[2px]"
      )}
    >
      {active && (
        <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_10px_var(--color-primary)]" />
      )}
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          active ? "bg-primary/15" : "bg-white/[0.03] group-hover:bg-white/[0.07]"
        )}
      >
        <span className={cn("material-symbols-outlined text-[17px]", active ? "fill-1 text-primary" : "group-hover:text-primary transition-colors")}>
          {icon}
        </span>
      </span>
      <span className="text-[13px] font-medium tracking-[0.01em]">{label}</span>
    </Link>
  );
}

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [forkCheck, setForkCheck] = useState(null);   // {behind, commits, dirtyFiles, logTail, error}
  const [forkState, setForkState] = useState(null);   // fase proses update dari server
  const [showForkModal, setShowForkModal] = useState(false);
  const [forkApplying, setForkApplying] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const forkBusy = typeof forkState === "string" && /^(queued|apply|build|restart)/.test(forkState);

  useEffect(() => {
    useSettingsStore.getState().fetchSettings().then((data) => {
      if (data?.enableTranslator) setEnableTranslator(true);
    });
  }, []);

  // Fork update (ronde-26): auto-check upstream saat mount + poll fase proses (web-based, tanpa cron)
  // Banner "versi npm baru" upstream TIDAK diadopsi — updater fork sengaja dimatikan (H2, PLAN-FITUR).
  useEffect(() => {
    let alive = true;
    const toCheck = (d) => ({ behind: d.behind, commits: d.commits || [], dirtyFiles: d.dirtyFiles || 0, logTail: d.logTail || "", error: d.error || null });
    const applyState = (d) => { if (alive && d && typeof d.state === "string") setForkState(d.state); };
    fetch("/api/upstream")
      .then((r) => r.json())
      .then((d) => { if (alive) setForkCheck(toCheck(d)); applyState(d); })
      .catch(() => { if (alive) setForkCheck({ behind: null, error: "cek gagal" }); });
    const timer = setInterval(() => {
      fetch("/api/upstream?mode=state").then((r) => r.json()).then(applyState).catch(() => {});
    }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  // Jalankan update fork dari web: POST -> systemd-run terpisah (aman dari restart app)
  const handleForkApply = async () => {
    setForkApplying(true);
    try {
      const r = await fetch("/api/upstream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      });
      const d = await r.json();
      if (!r.ok) {
        setForkCheck((prev) => ({ ...(prev || {}), error: d.error || "gagal memulai update" }));
        setForkApplying(false);
        return;
      }
      setForkState(d.state || "queued");
    } catch {
      setForkCheck((prev) => ({ ...(prev || {}), error: "jaringan/server error" }));
      setForkApplying(false);
    }
  };


  return (
    <>
      <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
        {/* Gateway live chip (ronde-26) */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.8)]" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/90">Gateway Live</span>
        </div>

        {/* Logo */}
        <div className="px-6 py-4 flex flex-col gap-2">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-[10px] bg-gradient-to-br from-brand-400 to-brand-700 ring-1 ring-white/15 shadow-[0_0_18px_-4px_rgba(200,191,255,.55),var(--shadow-warm)]">
              <span className="material-symbols-outlined text-white text-[20px]">hub</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold tracking-tight text-text-main">
                {APP_CONFIG.name}
              </h1>
              <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
            </div>
          </Link>
          {forkBusy && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-2 text-xs text-primary" role="status" aria-live="polite" title={forkState || ""}>
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <span className="min-w-0 flex-1 truncate">{forkState || "Mengupdate fork…"}</span>
            </div>
          )}
          {!forkBusy && forkCheck && forkCheck.error && (
            <button onClick={() => setShowForkModal(true)} className="w-full cursor-pointer rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-left text-[11px] text-danger transition hover:bg-danger/15">
              Cek update gagal — klik utk detail
            </button>
          )}
          {!forkBusy && forkCheck && forkCheck.behind > 0 && (
            <button onClick={() => setShowForkModal(true)} title="Commit upstream baru tersedia — update langsung dari web" className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-left text-[11px] font-semibold text-amber-300 transition hover:bg-amber-400/15">
              <span className="material-symbols-outlined text-[13px]">system_update_alt</span>
              <span className="flex-1">{forkCheck.behind} commit upstream</span>
              <span className="underline">Update</span>
            </button>
          )}
          {!forkBusy && forkCheck && !forkCheck.error && forkCheck.behind === 0 && (
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-text-subtle">
              <span className="material-symbols-outlined text-[13px] text-success">check_circle</span>
              <span>fork up-to-date</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(item.href)} onClose={onClose} />
          ))}

          {/* System section */}
          <div className="pt-3 mt-2 space-y-0.5">
            <p className="px-4 text-[10px] font-bold text-text-subtle uppercase tracking-[0.18em] mb-2">
              System
            </p>

            {systemItems.map((item) => (
              <NavItem key={item.href} {...item} active={isActive(item.href)} onClose={onClose} />
            ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? <NavItem key={item.href} {...item} active={isActive(item.href)} onClose={onClose} /> : null;
            })}

            
            
            {/* Settings */}
            <NavItem href="/dashboard/profile" label="Settings" icon="settings" active={isActive("/dashboard/profile")} onClose={onClose} />
          </div>
        </nav>

      </aside>

      {/* Remote Promo Modal */}

      {/* Fork Update Modal — cek + update dari web (ronde-26) */}
      <Modal
        isOpen={showForkModal}
        onClose={() => setShowForkModal(false)}
        title={forkBusy ? "Mengupdate Fork…" : "Update Fork MeAI dari Web"}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForkModal(false)} disabled={forkBusy}>
              {forkBusy ? "Proses berjalan di latar belakang" : "Tutup"}
            </Button>
            {typeof forkState === "string" && /^done/.test(forkState) ? (
              <Button variant="primary" onClick={() => globalThis.location.reload()}>Muat ulang</Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleForkApply}
                loading={forkApplying || forkBusy}
                disabled={forkBusy || !forkCheck || forkCheck.behind === null || forkCheck.behind === 0}
              >
                {forkBusy ? "Berjalan…" : "Update & Build"}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {forkCheck && forkCheck.error && <p className="text-danger text-xs">{forkCheck.error}</p>}
          {forkBusy && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary" aria-live="polite">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <span className="min-w-0 flex-1 truncate">{forkState}</span>
            </div>
          )}
          {forkCheck && forkCheck.behind > 0 && (
            <>
              <p className="text-xs text-text-muted">
                {forkCheck.behind} commit upstream baru — hanya yang aman (tak menyentuh file fork) yang di-cherry-pick, lalu build & restart otomatis.
              </p>
              <ol className="max-h-56 space-y-1 overflow-y-auto custom-scrollbar">
                {(forkCheck.commits || []).map((c) => (
                  <li key={c.sha} className="flex items-center gap-2 rounded-lg bg-surface-2/70 px-2 py-1 text-xs">
                    <code className="shrink-0 text-primary">{c.sha}</code>
                    <span className="shrink-0 text-text-subtle">{c.date}</span>
                    <span className="min-w-0 flex-1 truncate" title={c.msg}>{c.msg}</span>
                  </li>
                ))}
              </ol>
              {forkCheck.dirtyFiles > 0 && (
                <p className="text-xs text-warning">{forkCheck.dirtyFiles} file lokal belum di-commit — tetap dilindungi (update aman tak menyentuhnya).</p>
              )}
            </>
          )}
          {forkCheck && forkCheck.behind === 0 && !forkCheck.error && (
            <p className="text-xs text-success">Fork sudah up-to-date dengan upstream. Tidak ada yang perlu di-update.</p>
          )}
          {forkCheck && forkCheck.logTail && (
            <pre className="max-h-28 overflow-auto custom-scrollbar rounded-lg bg-black/30 p-2 text-[10px] text-text-subtle">{forkCheck.logTail}</pre>
          )}
        </div>
      </Modal>
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};
