import type { AssetKind, ImageMime } from "@/lib/campaigns/creative-assets";

// Phase 4 Step 3B: logo / banner ke PIXEL dimensions aur banner ka aspect ratio. PURA module: koi database, env ya network nahi.
// Dimensions file ke asli bytes se padhe jaate hain (PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X). Browser ya file ka naam kuch nahi batata.
// Upload par (server action) aur image serve karte waqt (asset proxy) dono jagah yahi niyam chalte hain.

export type ImageSize = { width: number; height: number };

/** Logo: dono taraf kam se kam 64 px, zyada se zyada 1024 px. (Ratio ki shart nahi: dikhate waqt box me fit hota hai.) */
export const LOGO_MIN_SIDE = 64;
export const LOGO_MAX_SIDE = 1024;

/** Banner: width 600..2400 px, height 200..1300 px, aur aspect ratio 1.91:1 (width/height) ke aas-paas. */
export const BANNER_MIN_WIDTH = 600;
export const BANNER_MAX_WIDTH = 2400;
export const BANNER_MIN_HEIGHT = 200;
export const BANNER_MAX_HEIGHT = 1300;
export const BANNER_TARGET_RATIO = 1.91;
/** +-5 percent: 1200x628 (1.911) ko milta hai; square ya bahut lamba/patla banner nahi. */
export const BANNER_RATIO_TOLERANCE = 0.05;
export const BANNER_RATIO_MIN = BANNER_TARGET_RATIO * (1 - BANNER_RATIO_TOLERANCE);
export const BANNER_RATIO_MAX = BANNER_TARGET_RATIO * (1 + BANNER_RATIO_TOLERANCE);

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function pngSize(b: Uint8Array): ImageSize | null {
  // 8 signature + 4 length + "IHDR" + width(4) + height(4)
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2; // 0xFFD8 ke baad
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // padding
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // bina length wale markers
      continue;
    }
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    // SOF0-SOF15 (DHT 0xC4, JPG 0xC8, DAC 0xCC chhodkar): frame header = [precision(1), height(2), width(2)]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const kind = ascii(b, 12, 4);
  if (kind === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (kind === "VP8 ") {
    // keyframe start code 9d 01 2a, phir 14-bit width, 14-bit height
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (kind === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** File ke bytes se (width, height). Samajh na aaye ya shape kharab ho toh null. Kabhi throw nahi karta. */
export function readImageSize(bytes: Uint8Array, mime: ImageMime): ImageSize | null {
  try {
    const size = mime === "image/png" ? pngSize(bytes) : mime === "image/jpeg" ? jpegSize(bytes) : webpSize(bytes);
    if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0) return null;
    return size;
  } catch {
    return null;
  }
}

export type DimensionCheck = { ok: true; width: number; height: number } | { ok: false; error: string };

/** Sirf niyam (size pehle se padha hua). */
export function checkImageSize(kind: AssetKind, size: ImageSize): DimensionCheck {
  const { width, height } = size;
  if (kind === "logo") {
    if (width < LOGO_MIN_SIDE || height < LOGO_MIN_SIDE) return { ok: false, error: `Logo must be at least ${LOGO_MIN_SIDE} x ${LOGO_MIN_SIDE} pixels.` };
    if (width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) return { ok: false, error: `Logo must be at most ${LOGO_MAX_SIDE} x ${LOGO_MAX_SIDE} pixels.` };
    return { ok: true, width, height };
  }
  if (width < BANNER_MIN_WIDTH || height < BANNER_MIN_HEIGHT) {
    return { ok: false, error: `Ad image must be at least ${BANNER_MIN_WIDTH} x ${BANNER_MIN_HEIGHT} pixels.` };
  }
  if (width > BANNER_MAX_WIDTH || height > BANNER_MAX_HEIGHT) {
    return { ok: false, error: `Ad image must be at most ${BANNER_MAX_WIDTH} x ${BANNER_MAX_HEIGHT} pixels.` };
  }
  const ratio = width / height;
  if (ratio < BANNER_RATIO_MIN || ratio > BANNER_RATIO_MAX) {
    return { ok: false, error: "Ad image must have a 1.91:1 shape (for example 1200 x 628 pixels)." };
  }
  return { ok: true, width, height };
}

/** Bytes -> dimensions padho -> niyam. Dimensions na padh sakein toh bhi reject (fail-closed). */
export function checkImageDimensions(kind: AssetKind, mime: ImageMime, bytes: Uint8Array): DimensionCheck {
  const size = readImageSize(bytes, mime);
  const label = kind === "logo" ? "Logo" : "Ad image";
  if (!size) return { ok: false, error: `${label} size could not be read. Use a standard PNG, JPG or WebP file.` };
  return checkImageSize(kind, size);
}
