import { handleMatchPost } from "@/lib/ads/match-handler";

// POST /api/ads/match  (PURANA endpoint: chalta rahega, behaviour wahi)
// Naye integrations ke liye POST /api/v1/ads/match use karo (app/api/v1/ads/match/route.ts).
// Dono routes ek hi handler chalate hain: lib/ads/match-handler.ts.
//   Authorization: Bearer blc_live_...
//   { "topic": "gaming", "exclude_ad_ids": ["<pichhle dikhaye ad ids, optional>"] }
// CORS jaan-boojh kar NAHI hai: key browser me nahi jaani chahiye.
// Publisher ko sirf ad ke public fields milte hain; advertiser/budget/campaign data kabhi nahi.
// Next.js ko runtime/dynamic har route file me seedha likha chahiye (re-export nahi chalta).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMatchPost(request);
}
