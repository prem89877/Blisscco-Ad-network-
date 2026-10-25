import type { Metadata } from "next";
import Sidebar from "@/components/dashboard/Sidebar";
import MobileNav from "@/components/dashboard/MobileNav";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { getCurrentAccount, requireUser } from "@/lib/auth/session";
import { navForRole } from "@/lib/dashboard-nav";

export const metadata: Metadata = {
  title: "Dashboard | Blisscco",
  description: "Blisscco dashboard.",
  robots: { index: false, follow: false },
};

// Har request par server user verify karta hai (middleware ke upar doosri, asli rok).
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const account = await getCurrentAccount();
  const items = navForRole(account?.role ?? null);

  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar items={items} />
      <div className="min-w-0 flex-1">
        <DashboardHeader email={user.email ?? ""} />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-5 pb-24 pt-6 focus-visible:outline-none sm:px-8 lg:pb-10"
        >
          {children}
        </main>
      </div>
      <MobileNav items={items} />
    </div>
  );
}
