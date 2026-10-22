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
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-ink lg:hidden"
    >
      {DASHBOARD_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 items-center justify-center border-t-2 px-1 text-[13px] font-medium ${
              active ? "border-aqua text-aqua" : "border-transparent text-mist/70"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
