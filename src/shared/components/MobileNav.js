"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard/overview", label: "Overview", icon: "space_dashboard" },
  { href: "/dashboard/insights", label: "Insights", icon: "monitoring" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota", icon: "data_usage" },
  { href: "/dashboard/guide", label: "Panduan", icon: "menu_book" },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigasi cepat mobile" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-0.5 py-1.5 text-[9px] ${active ? "text-primary" : "text-text-muted"}`} aria-current={active ? "page" : undefined}>
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
