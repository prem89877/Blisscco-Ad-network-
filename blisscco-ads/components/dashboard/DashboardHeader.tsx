"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import Badge from "@/components/ui/Badge";
import LogoutButton from "@/components/auth/LogoutButton";
import { currentLabel } from "@/lib/dashboard-nav";

/** Sticky top bar shared by every dashboard page. Logo shows on phones; the sidebar has it on desktop. */
export default function DashboardHeader({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-ink/95 px-4 py-3 min-[400px]:gap-3 min-[400px]:px-5 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" aria-label="Blisscco landing page" className="rounded lg:hidden">
          <Logo />
        </Link>
        <p className="hidden truncate text-sm text-mist/60 lg:block">
          Dashboard <span aria-hidden>/</span> <span className="text-mist">{currentLabel(pathname)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 min-[400px]:gap-3">
        <span className="hidden min-[400px]:inline-block">
          <Badge tone="violet">Demo data</Badge>
        </span>
        {email && (
          <span className="hidden max-w-[14rem] truncate text-sm text-mist/60 xl:inline" title={email}>
            {email}
          </span>
        )}
        <Link href="/" className="inline-flex min-h-11 items-center rounded px-1 text-sm text-mist/75 hover:text-aqua">
          <span className="min-[400px]:hidden">Home</span>
          <span className="hidden min-[400px]:inline">Landing page</span>
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
