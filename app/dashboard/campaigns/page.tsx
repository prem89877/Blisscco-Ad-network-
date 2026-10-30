import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";

// Purana demo page hata diya. Har role ko uske asli page par bhejte hain.
export default async function CampaignsRedirectPage() {
  const account = await requireAccount();
  if (account.role === "advertiser") redirect("/dashboard/advertiser/campaigns");
  if (account.role === "admin") redirect("/dashboard/admin");
  redirect("/dashboard/publisher");
}
