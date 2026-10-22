"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { DASHBOARD_NAV, isActive } from "@/lib/dashboard-nav";

/** Fixed sidebar for desktop (lg and up). Phones use MobileNav instead. */
export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-ink px-4 py-5 lg:flex">
      <Link href="/" aria-label="Blisscco landing page" className="rounded px-2">
        <Logo />
      </Link>
      <nav aria-label="Dashboard" className="mt-8">
        <ul className="space-y-1">
          {DASHBOARD_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors ${
                    active ? "bg-violet/20 text-aqua" : "text-mist/75 hover:bg-surface hover:text-mist"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="mt-auto px-2 text-xs text-mist/50">Demo dashboard. All data is sample data.</p>
    </aside>
  );
}
