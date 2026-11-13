import { handleClickGet, methodNotAllowed } from "@/lib/ads/click-handler";

// GET /api/v1/ads/click?ref=<ref>  (click ka redirect: user ad par click karta hai, yahan se advertiser ki destination par jaata hai)
// Query me SIRF `ref` (Blisscco ka signed click reference). Destination URL kabhi query/body se nahi: database ke creative row se aati hai.
// Ek serve ka sirf PEHLA click ginta hai; dobara click = redirect phir bhi hota hai, par kuch naya nahi likhta.
// Sirf GET. HEAD/POST/... = 405 (HEAD ko Next GET na bana de, warna crawler click gin leta).
// CORS nahi (project ka niyam). Billing: serve par sirf budget hold; CPC campaign ka charge serve ke PEHLE valid click par (DB record_ad_click), duplicate/not_counted par nahi. CPM campaign me click par charge nahi.
// Logic: lib/ads/click-handler.ts (query, rate limit) -> lib/ads/click.ts (ref + destination) -> DB function record_ad_click (day-12-10, atomic dedupe).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  return handleClickGet(request);
}

export async function HEAD() {
  return methodNotAllowed();
}
export async function POST() {
  return methodNotAllowed();
}
export async function PUT() {
  return methodNotAllowed();
}
export async function PATCH() {
  return methodNotAllowed();
}
export async function DELETE() {
  return methodNotAllowed();
}
