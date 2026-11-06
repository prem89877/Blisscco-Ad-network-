import { handleAssetGet } from "@/lib/ads/asset-handler";

// GET /api/v1/ads/asset/<ad id>?kind=logo|image  (Phase 4 Step 3B: Rich Ad Delivery)
// Private bucket ki image ka PROXY. Logic lib/ads/asset-handler.ts me: sirf approved ad + active campaign + active advertiser,
// warna 404. Flag RICH_AD_DELIVERY_ENABLED=1 chahiye (default band => sab 404). Sirf GET. CORS nahi (<img> ko chahiye bhi nahi).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAssetGet(request, id);
}
