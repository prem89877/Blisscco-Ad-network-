import { createClient } from "@/lib/supabase/server";
import {
  toAdminAdvertiserRow,
  toAdminPublisherRow,
  type AdminAdvertiserCountryRow,
  type AdminPublisherCountryRow,
} from "./admin-country-overview";

// Phase 6 Step 3 Part 3: Admin ke liye advertiser + publisher country padhna (SIRF padhna, kuch likhta nahi).
//
// Ye sirf admin page se bulaya jaata hai, jo requireRole(["admin"]) ke BAAD hi chalta hai. Upar se database ki row level security
// (advertisers_select_admin / publishers_select_admin) bhi sirf admin ko doosron ki rows padhne deti hai.
// Do alag queries: ek side fail ho (jaise SQL abhi apply nahi hui) toh sirf wahi side null; baaki admin page nahi tootta.
// Koi naya database object, grant ya policy nahi chahiye.

export const ADMIN_COUNTRY_ROW_LIMIT = 500;

export type AdminCountryOverview = {
  /** null = load fail (shape / error). Khali list = sach me koi publisher nahi. */
  publishers: AdminPublisherCountryRow[] | null;
  advertisers: AdminAdvertiserCountryRow[] | null;
  /** true => limit tak pahunche; ho sakta hai aur purani rows count me na hon. */
  publishersTruncated: boolean;
  advertisersTruncated: boolean;
};

export async function loadAdminCountryOverview(): Promise<AdminCountryOverview> {
  const out: AdminCountryOverview = { publishers: null, advertisers: null, publishersTruncated: false, advertisersTruncated: false };
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return out;
  }

  try {
    const { data, error } = await supabase
      .from("publishers")
      .select("id, name, status, country_code, country_status")
      .order("created_at", { ascending: false })
      .limit(ADMIN_COUNTRY_ROW_LIMIT);
    if (!error && Array.isArray(data)) {
      const raw = data as unknown[];
      out.publishers = raw.map(toAdminPublisherRow).filter((r): r is AdminPublisherCountryRow => r !== null);
      out.publishersTruncated = raw.length >= ADMIN_COUNTRY_ROW_LIMIT;
    }
  } catch {
    out.publishers = null;
  }

  try {
    const { data, error } = await supabase
      .from("advertisers")
      .select("id, company_name, status, country_code")
      .order("created_at", { ascending: false })
      .limit(ADMIN_COUNTRY_ROW_LIMIT);
    if (!error && Array.isArray(data)) {
      const raw = data as unknown[];
      out.advertisers = raw.map(toAdminAdvertiserRow).filter((r): r is AdminAdvertiserCountryRow => r !== null);
      out.advertisersTruncated = raw.length >= ADMIN_COUNTRY_ROW_LIMIT;
    }
  } catch {
    out.advertisers = null;
  }

  return out;
}
