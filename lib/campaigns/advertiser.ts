// Advertiser row (database se aayi, type unknown) -> typed MyAdvertiser. PURA module (koi database/env nahi).

export type MyAdvertiser = { id: string; status: "pending" | "active" | "suspended"; companyName: string };

export function toAdvertiser(row: unknown): MyAdvertiser | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as { id?: unknown; status?: unknown; company_name?: unknown };
  if (typeof r.id !== "string" || typeof r.company_name !== "string") return null;
  if (r.status !== "pending" && r.status !== "active" && r.status !== "suspended") return null;
  return { id: r.id, status: r.status, companyName: r.company_name };
}

/**
 * Advertiser ka load nateeja. failed = database error (advertiser nahi hai se ALAG):
 * pages failed par error boundary (Try again) dikhate hain, "set up your business" ya "not found" nahi.
 */
export type AdvertiserResult = { advertiser: MyAdvertiser | null; failed: boolean };
