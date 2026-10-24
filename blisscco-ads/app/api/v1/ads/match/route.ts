import { handleMatchPost } from "@/lib/ads/match-handler";

// POST /api/v1/ads/match  (versioned public endpoint)
// Request/response purane /api/ads/match jaisa hi hai (same handler: lib/ads/match-handler.ts).
// Fark sirf itna: har jawab me header `X-Blisscco-Api-Version: 1`. JSON body nahi badalti.
//   Authorization: Bearer blc_live_...
//   { "topic": "gaming", "exclude_ad_ids": ["<pichhle dikhaye ad ids, optional>"] }
// CORS jaan-boojh kar NAHI hai: key publisher ke SERVER par rehni chahiye, browser me nahi.
// Rate limit key par hai (path par nahi), isliye dono URLs ka quota shared hai.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMatchPost(request, { extraHeaders: { "X-Blisscco-Api-Version": "1" } });
}
