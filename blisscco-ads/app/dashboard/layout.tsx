import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import Badge from "@/components/ui/Badge";
import Sidebar from "@/components/dashboard/Sidebar";
import MobileNav from "@/components/dashboard/MobileNav";

export const metadata: Metadata = {
  title: "Dashboard | Blisscco",
  description: "Blisscco demo dashboard with sample data.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-ink/95 px-5 py-3 sm:px-8">
          <Link href="/" aria-label="Blisscco landing page" className="rounded lg:hidden">
            <Logo />
          </Link>
          <span className="hidden text-sm text-mist/60 lg:block">Blisscco dashboard</span>
          <div className="flex items-center gap-3">
            <Badge tone="violet">Demo data</Badge>
            <Link href="/" className="rounded py-2 text-sm text-mist/75 hover:text-aqua">
              Landing page
            </Link>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-5 pb-24 pt-6 focus-visible:outline-none sm:px-8 lg:pb-10"
        >
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
