// Publisher row (database se aayi, type unknown) -> typed MyPublisher. PURA module (koi database/env nahi).

export type PublisherStatus = "pending" | "active" | "suspended";

export type MyPublisher = {
  id: string;
  status: PublisherStatus;
  name: string;
  websiteUrl: string | null;
  category: string | null;
};

export function toPublisher(row: unknown): MyPublisher | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as { id?: unknown; status?: unknown; name?: unknown; website_url?: unknown; category?: unknown };
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  if (r.status !== "pending" && r.status !== "active" && r.status !== "suspended") return null;
  return {
    id: r.id,
    status: r.status,
    name: r.name,
    websiteUrl: typeof r.website_url === "string" && r.website_url.length > 0 ? r.website_url : null,
    category: typeof r.category === "string" && r.category.length > 0 ? r.category : null,
  };
}

/**
 * Publisher ka load nateeja. failed = database error (publisher NAHI hai se ALAG):
 * pages failed par error dikhate hain, "Set up your platform" form nahi (warna asli publisher ko dobara setup dikhta tha).
 */
export type PublisherResult = { publisher: MyPublisher | null; failed: boolean };
