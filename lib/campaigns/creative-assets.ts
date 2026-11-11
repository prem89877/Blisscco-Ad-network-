// Phase 4 Step 3: logo / banner upload ki jaanch. PURA module: koi database, storage ya env nahi.
// Asli check server action me hota hai (file ke asli bytes dekh kar). Browser ki checking sirf suvidha ke liye.
// SVG aur GIF jaan-boojh kar band: SVG me script chhup sakti hai.

export const ASSET_BUCKET = "creative-assets";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const BANNER_MAX_BYTES = 4 * 1024 * 1024; // 4 MB (bucket ki limit bhi yahi hai)

// Vercel ek request ki body 4.5 MB tak hi leta hai (platform ki hard limit, next.config ke bodySizeLimit se alag). Logo + ad image ek hi
// request me jate hain, isliye dono ka jod 4 MB se zyada ho toh Vercel 413 deta hai aur browser me sirf "Failed to fetch" dikhta hai.
// 4 MB rakha hai taaki form ke baaki fields + multipart overhead ke liye jagah bache. Browser submit se PEHLE yahi jaanchta hai.
export const MAX_COMBINED_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Logo + ad image ka jod bahut bada ho toh saaf message, warna undefined. */
export function combinedUploadError(totalBytes: number): string | undefined {
  if (!Number.isFinite(totalBytes) || totalBytes <= MAX_COMBINED_UPLOAD_BYTES) return undefined;
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return `The logo and ad image together are ${mb(totalBytes)} MB. Together they must be ${mb(MAX_COMBINED_UPLOAD_BYTES)} MB or smaller. Please compress one of them and try again.`;
}

export type AssetKind = "logo" | "banner";
export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export const IMAGE_EXTENSIONS: Record < ImageMime, "png" | "jpg" | "webp" > = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const ALLOWED_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as
const;

export const ASSET_LIMITS: Record < AssetKind, { maxBytes: number;label: string } > = {
  logo: { maxBytes: LOGO_MAX_BYTES, label: "Logo" },
  banner: { maxBytes: BANNER_MAX_BYTES, label: "Ad image" },
};

export type ImageMeta = { name: string;type: string;size: number };
export type ImageCheck = |
  { ok: true;mime: ImageMime;ext: "png" | "jpg" | "webp" } |
  { ok: false;error: string };

function isImageMime(v: string): v is ImageMime {
  return Object.prototype.hasOwnProperty.call(IMAGE_EXTENSIONS, v);
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Bytes ki shuruaat se asli image type (file ka naam / browser ka type jhootha ho sakta hai). */
export function sniffImageMime(head: Uint8Array): ImageMime | null {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) {
    return "image/png";
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && // "RIFF"
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Naam, type aur size ki jaanch (bytes ke bina). Browser aur server dono yahi use karte hain. */
export function checkImageMeta(kind: AssetKind, meta: ImageMeta): { ok: true;mime: ImageMime } | { ok: false;error: string } {
  const { label, maxBytes } = ASSET_LIMITS[kind];
  if (!Number.isFinite(meta.size) || meta.size <= 0) return { ok: false, error: `Choose a ${label.toLowerCase()} image.` };
  if (meta.size > maxBytes) return { ok: false, error: `${label} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.` };
  if (!isImageMime(meta.type)) return { ok: false, error: `${label} must be a PNG, JPG or WebP image.` };
  if (!(ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(meta.name))) {
    return { ok: false, error: `${label} must be a PNG, JPG or WebP image.` };
  }
  return { ok: true, mime: meta.type };
}

/** Poori jaanch: meta + file ke asli bytes (type mel khana chahiye). */
export function checkImageUpload(kind: AssetKind, meta: ImageMeta, head: Uint8Array): ImageCheck {
  const metaCheck = checkImageMeta(kind, meta);
  if (!metaCheck.ok) return metaCheck;
  const sniffed = sniffImageMime(head);
  const { label } = ASSET_LIMITS[kind];
  if (sniffed === null || sniffed !== metaCheck.mime) {
    return { ok: false, error: `${label} is not a valid PNG, JPG or WebP image.` };
  }
  return { ok: true, mime: sniffed, ext: IMAGE_EXTENSIONS[sniffed] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Storage path: <advertiser_id>/<campaign_id>/<logo|banner>-<uuid>.<ext>  (database CHECK bhi yahi shape maangta hai). */
export function buildAssetPath(args: {
  advertiserId: string;
  campaignId: string;
  kind: AssetKind;
  ext: "png" | "jpg" | "webp";
  randomId: string;
}): string | null {
  const { advertiserId, campaignId, kind, ext, randomId } = args;
  if (![advertiserId, campaignId, randomId].every((v) => UUID.test(v))) return null;
  return `${advertiserId}/${campaignId}/${kind}-${randomId}.${ext}`;
}

/** Kya ye path isi advertiser aur isi campaign ka hai? */
export function isOwnedAssetPath(path: string, advertiserId: string, campaignId: string, kind: AssetKind): boolean {
  const parts = path.split("/");
  if (parts.length !== 3) return false;
  if (parts[0] !== advertiserId || parts[1] !== campaignId) return false;
  return new RegExp(`^${kind}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)$`).test(parts[2]);
}