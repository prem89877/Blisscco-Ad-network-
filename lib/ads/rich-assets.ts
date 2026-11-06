import { isUuid } from "@/lib/campaigns/constants";
import { ASSET_LIMITS, sniffImageMime, type AssetKind, type ImageMime } from "@/lib/campaigns/creative-assets";
import { checkImageDimensions } from "@/lib/campaigns/image-dimensions";

// Phase 4 Step 3B: Rich Ad Delivery ka PURA (pure) hissa: koi database/env/network nahi.
//   - flag (default BAND), asset URL banana, DB jawab parse karna, image bytes ki dobara jaanch.
// Images private bucket me hi rehti hain. Publisher ko sirf proxy URL milta hai: GET /api/v1/ads/asset/<ad id>?kind=logo|image.

/** Public `kind` -> bucket ki file ka prakar. "image" = advertiser ka banner. */
export const PUBLIC_ASSET_KINDS = ["logo", "image"] as const;
export type PublicAssetKind = (typeof PUBLIC_ASSET_KINDS)[number];
export const ASSET_KIND_TO_STORED: Record<PublicAssetKind, AssetKind> = { logo: "logo", image: "banner" };

export function isPublicAssetKind(v: unknown): v is PublicAssetKind {
  return v === "logo" || v === "image";
}

/** Server flag: exact "1" chahiye. Default BAND (Production par kuch nahi badalta). Band ho toh match me rich fields nahi aate aur asset route 404 deta hai. */
export function isRichAdDeliveryEnabled(env: Record<string, string | undefined>): boolean {
  return env.RICH_AD_DELIVERY_ENABLED === "1";
}

/** Match ke dauran DB se mila rich data (sirf wahi jo response ko chahiye; paths kabhi bahar nahi). */
export type RichAdFields = { brandName: string | null; hasLogo: boolean; hasImage: boolean };

/** Asset route ke liye DB ka poora jawab (server ke andar hi rehta hai). */
export type RichAssetRecord = {
  advertiserId: string;
  campaignId: string;
  brandName: string | null;
  logoPath: string | null;
  bannerPath: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const strOrNull = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" ? v : undefined);

/** get_creative_rich_assets ka jawab -> record. "not_found" ya kharab shape => null (eligible nahi / bharosa nahi). */
export function parseRichAssetResult(data: unknown): RichAssetRecord | null {
  if (!isRecord(data) || data.outcome !== "ok") return null;
  const { advertiser_id: advertiserId, campaign_id: campaignId } = data;
  if (typeof advertiserId !== "string" || !isUuid(advertiserId) || typeof campaignId !== "string" || !isUuid(campaignId)) return null;
  const brandName = strOrNull(data.brand_name);
  const logoPath = strOrNull(data.logo_path);
  const bannerPath = strOrNull(data.banner_path);
  if (brandName === undefined || logoPath === undefined || bannerPath === undefined) return null;
  return { advertiserId, campaignId, brandName, logoPath, bannerPath };
}

/**
 * Path us creative ke apne advertiser aur campaign ka hi hona chahiye: `<advertiser>/<campaign>/<logo|banner>-<uuid>.<ext>`.
 * (Database CHECK + trigger yahi rokte hain; ye server-side dusri deewar hai: kharab row se doosre advertiser ki image nahi niklegi.)
 */
export function ownedStoredPath(path: string | null, record: RichAssetRecord, kind: AssetKind): string | null {
  if (!path) return null;
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== record.advertiserId || parts[1] !== record.campaignId) return null;
  const re = new RegExp(`^${kind}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)$`);
  return re.test(parts[2]) ? path : null;
}

export function richFieldsFromRecord(record: RichAssetRecord): RichAdFields {
  return {
    brandName: record.brandName,
    hasLogo: ownedStoredPath(record.logoPath, record, "logo") !== null,
    hasImage: ownedStoredPath(record.bannerPath, record, "banner") !== null,
  };
}

/** Sirf scheme+host(+port): https, ya localhost par http. Path/query/credentials nahi. Warna null. */
export function safeAssetBase(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  return url.origin;
}

/**
 * Asset URL ka base = isi deployment ka origin (Preview par Preview URL). Sirf origin (scheme + host) liya jaata hai: key, query ya body
 * se iska koi lena-dena nahi. Bekaar origin => null (URLs nahi, ad text-only).
 */
export function assetBaseFromRequest(request: Request): string | null {
  try {
    return safeAssetBase(new URL(request.url).origin);
  } catch {
    return null;
  }
}

export function assetUrl(base: string, adId: string, kind: PublicAssetKind): string {
  return `${base}/api/v1/ads/asset/${adId}?kind=${kind}`;
}

export type ImageVerdict = { ok: true; mime: ImageMime } | { ok: false };

/** Serve karne se pehle bytes ki dobara jaanch (size limit, asli type, dimensions). Fail => 404. */
export function verifyImageForServing(kind: AssetKind, bytes: Uint8Array): ImageVerdict {
  if (bytes.length === 0 || bytes.length > ASSET_LIMITS[kind].maxBytes) return { ok: false };
  const mime = sniffImageMime(bytes.subarray(0, 16));
  if (mime === null) return { ok: false };
  if (!checkImageDimensions(kind, mime, bytes).ok) return { ok: false };
  return { ok: true, mime };
}
