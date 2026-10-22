import type { Metadata } from "next";
import Sidebar from "@/components/dashboard/Sidebar";
import MobileNav from "@/components/dashboard/MobileNav";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

export const metadata: Metadata = {
  title: "Dashboard | Blisscco",
  description: "Blisscco demo dashboard with sample data.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <DashboardHeader />
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
