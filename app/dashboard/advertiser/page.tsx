import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";

// Purana sample-data page hata diya. Asli campaigns wale page par bhejte hain.
export default async function AdvertiserRedirectPage() {
  const account = await requireRole(["advertiser", "admin"]);
  redirect(account.role === "admin" ? "/dashboard/admin" : "/dashboard/advertiser/campaigns");
}
