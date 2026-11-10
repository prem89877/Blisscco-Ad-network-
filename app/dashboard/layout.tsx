import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Sidebar from "@/components/dashboard/Sidebar";
import MobileNav from "@/components/dashboard/MobileNav";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { getCurrentAccount, requireUser } from "@/lib/auth/session";
import { navForRole } from "@/lib/dashboard-nav";
import { logIfSlow } from "@/lib/diagnostics/log";

export const metadata: Metadata = {
  title: "Dashboard | Blisscco",
  description: "Blisscco dashboard.",
  robots: { index: false, follow: false },
};

// Har request par server user verify karta hai (middleware ke upar doosri, asli rok).
// force-dynamic jaan-boojh kar rakha hai: ye safety net hai (env na hone par bhi redirect build time par pakka na ho jaye) aur isse speed par
// koi asar nahi: client Router Cache (next.config staleTimes) alag cheez hai aur dynamic pages par bhi chalta hai.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Speed: user ka asli check aur profile query ek saath (dono React cache() se page ke saath bhi share hote hain).
  const authStartedAt = Date.now();
  const [user, account] = await Promise.all([requireUser(), getCurrentAccount()]);
  // Diagnostics: user check + profile query dheema ho (3s+) toh Vercel logs me "[diag] event=request_slow label=dashboard_layout_auth".
  logIfSlow("dashboard_layout_auth", authStartedAt);
  if (account?.roleChoicePending) redirect("/auth/choose-role");
  const items = navForRole(account?.role ?? null);

  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar items={items} />
      <div className="min-w-0 flex-1">
        <DashboardHeader email={user.email ?? ""} role={account?.role ?? null} />
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
