import { handlePreviewGet } from "@/lib/ads/revive-json-preview";

// GET /api/revive-json-preview  (Day 24 Part 2: sirf PROTOTYPE, alag flag se band-by-default)
// Server-side flag REVIVE_JSON_PREVIEW_ENABLED = "true" na ho toh fixed 404.
// GET ko koi argument nahi milta: URL, query, header ya cookie padhe hi nahi jaate, isliye browser se creative/destination control nahi hota.
// Yeh route publisher match API ya Revive fallback se juda NAHI hai. Koi billing, tracking, ledger, DB ya network nahi.
// Next.js ko runtime/dynamic har route file me seedha likha chahiye (re-export nahi chalta).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handlePreviewGet();
}
