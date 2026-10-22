"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import Badge from "@/components/ui/Badge";
import { currentLabel } from "@/lib/dashboard-nav";

/** Sticky top bar shared by every dashboard page. Logo shows on phones; the sidebar has it on desktop. */
export default function DashboardHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-ink/95 px-5 py-3 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" aria-label="Blisscco landing page" className="rounded lg:hidden">
          <Logo />
        </Link>
        <p className="hidden truncate text-sm text-mist/60 lg:block">
          Dashboard <span aria-hidden>/</span> <span className="text-mist">{currentLabel(pathname)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge tone="violet">Demo data</Badge>
        <Link href="/" className="inline-flex min-h-11 items-center rounded px-1 text-sm text-mist/75 hover:text-aqua">
          Landing page
        </Link>
      </div>
    </header>
  );
}
