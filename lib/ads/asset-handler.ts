import { isUuid } from "@/lib/campaigns/constants";
import { downloadStoredImage, lookupRichAssets } from "./rich-assets-db";
import { ASSET_KIND_TO_STORED, isPublicAssetKind, isRichAdDeliveryEnabled, ownedStoredPath, verifyImageForServing } from "./rich-assets";

// GET /api/v1/ads/asset/[id]?kind=logo|image  (id = ad id jo match response me aaya)
//
// Private bucket ki image SIRF tab jab: flag ON, ad approved, campaign active, advertiser (aur profile) active (DB function),
// path usi advertiser + campaign ka, aur bytes asli PNG/JPEG/WebP hon jo size aur dimension niyam par khare utarein.
// Baaki sab (galat id, galat kind, pending / rejected / paused / archived ad, doosre advertiser ki path, missing file) => ek jaisa 404.
// Sirf database ka asli outage 503 hai. Koi login/cookie nahi: image end user ke browser me <img> se khulti hai; ad id waise bhi public hai.
// Sirf padhta hai: koi write nahi, aur kisi bhi paise ya tracking wale hisse ko haath nahi lagata.

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Blisscco-Api-Version": "1" } as const;

const notFound = () => new Response(null, { status: 404, headers: BASE_HEADERS });
const unavailable = () => new Response(null, { status: 503, headers: BASE_HEADERS });

export async function handleAssetGet(request: Request, id: string): Promise<Response> {
  try {
    if (!isRichAdDeliveryEnabled(process.env)) return notFound();
    if (typeof id !== "string" || !isUuid(id)) return notFound();

    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (key !== "kind") return notFound();
    if (params.getAll("kind").length > 1) return notFound();
    const kindParam = params.get("kind") ?? "image";
    if (!isPublicAssetKind(kindParam)) return notFound();
    const stored = ASSET_KIND_TO_STORED[kindParam];

    const found = await lookupRichAssets(id);
    if (found.outcome === "error") return unavailable();
    if (found.outcome !== "ok") return notFound();

    const path = ownedStoredPath(stored === "logo" ? found.record.logoPath : found.record.bannerPath, found.record, stored);
    if (path === null) return notFound();

    const bytes = await downloadStoredImage(path);
    if (bytes === null) return notFound();
    const verdict = verifyImageForServing(stored, bytes);
    if (!verdict.ok) return notFound();

    const body = new Uint8Array(bytes.length);
    body.set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": verdict.mime,
        "Content-Length": String(body.length),
        // Ad pause / reject hone par image jaldi band ho: bahut chhota cache.
        "Cache-Control": "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Referrer-Policy": "no-referrer",
        "X-Blisscco-Api-Version": "1",
      },
    });
  } catch {
    return notFound();
  }
}
