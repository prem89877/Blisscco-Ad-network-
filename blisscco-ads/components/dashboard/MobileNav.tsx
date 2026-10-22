"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_NAV, isActive } from "@/lib/dashboard-nav";

/** Bottom tab bar for phones and tablets (below lg). Easy to reach with a thumb. */
export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Dashboard"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {DASHBOARD_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center border-t-2 px-0.5 text-center text-[12px] font-medium transition-colors min-[360px]:text-[13px] ${
                  active ? "border-aqua bg-violet/10 text-aqua" : "border-transparent text-mist/70 hover:text-mist"
                }`}
              >
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
