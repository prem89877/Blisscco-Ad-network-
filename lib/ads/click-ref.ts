import { isUuid } from "@/lib/campaigns/constants";
import {
  CLOCK_SKEW_SECONDS,
  MAX_TOKEN_LENGTH,
  MAX_TTL_SECONDS,
  SERVE_REF_RE,
  decodeCanonicalB64Url,
  hmac,
  publisherTag,
  safeEqual,
  type TrackingConfig,
} from "./tracking-token";

// Day 12 Prompt 5 Part 2: CLICK REFERENCE (sirf helper; redirect route is part me NAHI hai).
// PURA module: koi database/env/server-only/logging nahi. Signing secret `readTrackingConfig(env)` wale TrackingConfig se aata hai (server-only, tracking token wala hi secret);
// is module me koi naya env variable nahi hai. Isliye bina database ke test hota hai.
//
// Click reference kya hai:
//   * Ek kamyab serve ke liye Blisscco server ka signed (HMAC-SHA256) reference: "serve bsr_... par, is publisher ke liye, is creative par click report/redirect ho sakta hai, is samay tak".
//     Format: bc1.<payload base64url>.<signature base64url>
//   * Impression/tracking token (bt1) se ALAG hai: alag prefix, alag signing label, alag payload shape. bt1 token click ref ki jagah nahi chalta, aur click ref bt1 ki jagah nahi.
//   * Creative se BANDHA hai: payload me creative ka ONE-WAY tag hai (creative id khud nahi). Verify ke samay creative DATABASE ke serve row se aata hai,
//     caller ke diye hue creative/ad id se kabhi nahi. Caller jo creative bataye wo sirf is tag se milaya jaata hai.
//   * Destination URL is reference me NAHI hai aur browser se kabhi nahi li jaati. Destination baad ke part me DATABASE se creative ke row se aayega.
//   * Time-limited: exp = serve ka samay + TTL (tracking token jaisi hi umr). Payload sirf signed hai, encrypted nahi: publisher/creative id nahi, sirf opaque serve_ref + one-way tags.
//   * Rotation: config ka previous secret se purane refs verify hote hain; naye hamesha current secret se.
//   * Click ref milna click ka SABOOT nahi hai: koi click yahan record nahi hota.

export const CLICK_REF_PREFIX = "bc1";
const TAG_RE = /^[0-9a-f]{32}$/;
const PAYLOAD_KEYS = ["c", "exp", "iat", "p", "r", "v"];

export type ClickRefFailure =
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "not_yet_valid"
  | "unknown_serve"
  | "publisher_mismatch"
  | "creative_mismatch"
  | "serve_mismatch"
  | "unavailable";

/** Creative ka one-way tag (secret ke bina creative id wapas nahi nikalta). Publisher tag se alag label: dono tag aapas me badle nahi ja sakte. */
export function creativeTag(secret: string, creativeId: string): string {
  return hmac(secret, `blisscco:click:creative:${creativeId.toLowerCase()}`).toString("hex").slice(0, 32);
}

function signClickRef(secret: string, payloadB64: string): Buffer {
  return hmac(secret, `blisscco:click:${CLICK_REF_PREFIX}:${payloadB64}`);
}

export type ClickRefGrant = { ref: string; expiresAtMs: number };

export type MintClickRefInput = {
  serveRef: string;
  publisherId: string;
  creativeId: string;
  /** Database ka serve ka samay (ad_serve_log.served_at). Exp isi se bandhi hai. */
  servedAtMs: number;
  nowMs: number;
};

/**
 * Deterministic: wahi serve (ref, publisher, creative, served_at) hamesha wahi click ref deta hai.
 * null = ref nahi banta (koi id galat, serve ka samay bhavishya me, ya serve ki ijazat-avadhi nikal chuki).
 */
export function mintClickRef(config: TrackingConfig, input: MintClickRefInput): ClickRefGrant | null {
  const { serveRef, publisherId, creativeId, servedAtMs, nowMs } = input;
  if (!config.secrets.length) return null;
  if (typeof serveRef !== "string" || !SERVE_REF_RE.test(serveRef)) return null;
  if (typeof publisherId !== "string" || !isUuid(publisherId)) return null;
  if (typeof creativeId !== "string" || !isUuid(creativeId)) return null;
  if (!Number.isFinite(servedAtMs) || !Number.isFinite(nowMs)) return null;
  if (servedAtMs > nowMs + CLOCK_SKEW_SECONDS * 1000) return null;

  const iat = Math.floor(servedAtMs / 1000);
  const exp = iat + config.ttlSeconds;
  if (nowMs >= exp * 1000) return null;

  const secret = config.secrets[0];
  const payload = JSON.stringify({
    v: 1,
    r: serveRef,
    p: publisherTag(secret, publisherId),
    c: creativeTag(secret, creativeId),
    iat,
    exp,
  });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sigB64 = signClickRef(secret, payloadB64).toString("base64url");
  return { ref: `${CLICK_REF_PREFIX}.${payloadB64}.${sigB64}`, expiresAtMs: exp * 1000 };
}

export type ClickRefClaims = {
  serveRef: string;
  publisherTag: string;
  creativeTag: string;
  issuedAtMs: number;
  expiresAtMs: number;
  /** Kaun sa secret match hua (0 = current, 1 = previous). */
  secretIndex: number;
};

export type VerifyClickRefResult = { ok: true; claims: ClickRefClaims } | { ok: false; reason: ClickRefFailure };

const fail = (reason: ClickRefFailure): { ok: false; reason: ClickRefFailure } => ({ ok: false, reason });

/** Sirf ref ki apni jaanch (database ke bina): shape, signature (PEHLE), strict payload, expiry. Kabhi throw nahi karta. */
export function verifyClickRef(ref: unknown, config: TrackingConfig, nowMs: number): VerifyClickRefResult {
  try {
    if (typeof ref !== "string" || ref.length === 0 || ref.length > MAX_TOKEN_LENGTH) return fail("malformed");
    const parts = ref.split(".");
    if (parts.length !== 3 || parts[0] !== CLICK_REF_PREFIX) return fail("malformed");
    const [, payloadB64, sigB64] = parts;
    const payloadBuf = decodeCanonicalB64Url(payloadB64);
    const sigBuf = decodeCanonicalB64Url(sigB64);
    if (!payloadBuf || !sigBuf || sigBuf.length !== 32) return fail("malformed");

    let secretIndex = -1;
    for (let i = 0; i < config.secrets.length; i += 1) {
      if (safeEqual(signClickRef(config.secrets[i], payloadB64), sigBuf)) secretIndex = i;
    }
    if (secretIndex === -1) return fail("invalid_signature");

    let data: unknown;
    try {
      data = JSON.parse(payloadBuf.toString("utf8"));
    } catch {
      return fail("malformed");
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return fail("malformed");
    const obj = data as Record<string, unknown>;
    if (Object.keys(obj).sort().join(",") !== PAYLOAD_KEYS.join(",")) return fail("malformed");

    const { v, r, p, c, iat, exp } = obj;
    if (v !== 1) return fail("malformed");
    if (typeof r !== "string" || !SERVE_REF_RE.test(r)) return fail("malformed");
    if (typeof p !== "string" || !TAG_RE.test(p)) return fail("malformed");
    if (typeof c !== "string" || !TAG_RE.test(c)) return fail("malformed");
    if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return fail("malformed");
    const iatS = iat as number;
    const expS = exp as number;
    if (expS <= iatS || expS - iatS > MAX_TTL_SECONDS) return fail("malformed");

    if (!Number.isFinite(nowMs)) return fail("malformed");
    if (iatS * 1000 > nowMs + CLOCK_SKEW_SECONDS * 1000) return fail("not_yet_valid");
    if (nowMs >= expS * 1000) return fail("expired");

    return {
      ok: true,
      claims: { serveRef: r, publisherTag: p, creativeTag: c, issuedAtMs: iatS * 1000, expiresAtMs: expS * 1000, secretIndex },
    };
  } catch {
    return fail("malformed");
  }
}

/** Database ka serve row (sirf jo jaanch ko chahiye). null = aisa koi serve_ref nahi. Production lookup baad ke part me (SQL approval ke baad). */
export type ClickServeLookup = (serveRef: string) => Promise<{ publisherId: string; creativeId: string; servedAtMs: number } | null>;

export type ClickRefCheck =
  | { ok: true; serveRef: string; publisherId: string; creativeId: string }
  | { ok: false; reason: ClickRefFailure };

/**
 * Ref + asli serve row ka milan: serve maujood ho; publisher aur creative wahi ho jin ke liye ref bana; samay serve ke samay se mel khaye.
 * Creative (aur publisher) HAMESHA database ke serve row se aate hain. `claimedCreativeId` (agar caller de) sirf ek extra milan hai:
 * ref kisi aur creative ke liye ho toh `creative_mismatch`. Ye kisi destination ya event ki ijazat nahi likhta.
 */
export async function verifyClickRefForServe(
  ref: unknown,
  deps: { config: TrackingConfig; nowMs: number; lookupServe: ClickServeLookup; claimedCreativeId?: string },
): Promise<ClickRefCheck> {
  const checked = verifyClickRef(ref, deps.config, deps.nowMs);
  if (!checked.ok) return checked;
  const { claims } = checked;

  let serve: { publisherId: string; creativeId: string; servedAtMs: number } | null;
  try {
    serve = await deps.lookupServe(claims.serveRef);
  } catch {
    return fail("unavailable");
  }
  if (!serve) return fail("unknown_serve");
  if (
    typeof serve.publisherId !== "string" || !isUuid(serve.publisherId) ||
    typeof serve.creativeId !== "string" || !isUuid(serve.creativeId) ||
    !Number.isFinite(serve.servedAtMs)
  ) {
    return fail("unavailable");
  }

  const secret = deps.config.secrets[claims.secretIndex];
  const pubOk = safeEqual(Buffer.from(publisherTag(secret, serve.publisherId), "utf8"), Buffer.from(claims.publisherTag, "utf8"));
  if (!pubOk) return fail("publisher_mismatch");
  const creativeOk = safeEqual(Buffer.from(creativeTag(secret, serve.creativeId), "utf8"), Buffer.from(claims.creativeTag, "utf8"));
  if (!creativeOk) return fail("creative_mismatch");
  if (Math.floor(serve.servedAtMs / 1000) * 1000 !== claims.issuedAtMs) return fail("serve_mismatch");

  if (deps.claimedCreativeId !== undefined) {
    if (typeof deps.claimedCreativeId !== "string" || !isUuid(deps.claimedCreativeId)) return fail("creative_mismatch");
    if (deps.claimedCreativeId.toLowerCase() !== serve.creativeId.toLowerCase()) return fail("creative_mismatch");
  }

  return { ok: true, serveRef: claims.serveRef, publisherId: serve.publisherId, creativeId: serve.creativeId };
}
