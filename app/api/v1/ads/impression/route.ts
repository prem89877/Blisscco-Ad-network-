import { handleImpressionPost } from "@/lib/ads/impression-handler";

// POST /api/v1/ads/impression  (impression ka event: serve ke baad browser/publisher yahan signed tracking token bhejta hai)
//   Content-Type: application/json
//   { "token": "<tracking.token jo /api/v1/ads/match ne di>", "event": "impression" }
// Sirf IMPRESSION. Click / serve / koi aur event type = 400. Koi API key nahi; token hi ijazat hai.
// Ek serve ka sirf PEHLA impression ginta hai; retry / duplicate = 200 {status:"duplicate"}, kuch naya nahi likhta.
// CORS nahi (project ka niyam): token publisher ke server se aata hai. Charge badalta nahi: charge abhi bhi serve par hai, impression par doosri baar nahi katta.
// Logic: lib/ads/impression-handler.ts (shape, rate limit) -> lib/ads/impression.ts (token + serve) -> DB function record_ad_impression (day-12-7, atomic dedupe).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Database ka apna time-out 8 second hai. Atke toh jaldi 503, latakna nahi.
export const maxDuration = 15;

export async function POST(request: Request) {
  return handleImpressionPost(request);
}
