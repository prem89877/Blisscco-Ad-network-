import { createHmac, timingSafeEqual } from "node:crypto";
import { isUuid } from "@/lib/campaigns/constants";

// Day 12 Part 3: serve ke baad ke impression/click events ke liye TRACKING TOKEN.
// PURA module: koi database/env/server-only nahi (env `readTrackingConfig(env)` ko argument se milta hai), isliye bina database ke test hota hai.
//
// Token kya hai (aur kya NAHI):
//   * Ek server-signed (HMAC-SHA256) "permission slip": "serve bsr_... ke liye, is publisher ke liye, ye events (impression/click),
//     is samay tak report kiye ja sakte hain". Format: bt1.<payload base64url>.<signature base64url>
//   * Token milna KISI event ka SABOOT NAHI hai. Serve ek cheez hai, impression doosri, click teesri. Token sirf itna batata hai
//     ki Blisscco ne ye serve record kiya tha aur is serve ke events report karne ki ijazat abhi chal rahi hai.
//     Event ginna (aur use billing se jodna) baad ke part ka kaam hai; is file me koi event nahi likha jaata.
//   * Payload encrypted NAHI hai (sirf signed): usme sirf opaque serve_ref (bsr_ + 40 hex), publisher ka ONE-WAY tag, ijazat wale
//     event types aur samay hai. Publisher id, campaign id, creative id, sequential serve id, spend: kuch nahi.
//   * Signing secret (AD_TRACKING_SECRET) sirf server env me. Browser ko / response me kabhi nahi jaata.
//   * Time-limited: exp = serve ka samay + TTL (default 1 ghanta). Exp SERVE KE SAMAY se bandhi hai, "abhi" se nahi: Idempotency-Key
//     ki retry (48 ghante tak chalti hai) purane serve ka token dobara taza nahi kar sakti.
//   * Rotation: AD_TRACKING_SECRET_PREVIOUS se purane token verify hote hain; naye token hamesha current secret se bante hain.

export const TRACKING_TOKEN_PREFIX = "bt1";
/** Token me sirf yahi do event types ki ijazat ho sakti hai. "serve" jaan-boojh kar nahi: serve ka record Blisscco khud likhta hai. */
export const TRACKING_EVENTS = ["impression", "click"] as const;
export type TrackingEvent = (typeof TRACKING_EVENTS)[number];

export const DEFAULT_TTL_SECONDS = 3600;
export const MIN_TTL_SECONDS = 60;
/** Koi bhi token (chahe secret ke sath bana ho) isse zyada umr ka valid nahi maana jaata. */
export const MAX_TTL_SECONDS = 86_400;
export const MAX_TOKEN_LENGTH = 512;
export const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;
export const CLOCK_SKEW_SECONDS = 60;

export const SERVE_REF_RE = /^bsr_[0-9a-f]{40}$/;
const PUBLISHER_TAG_RE = /^[0-9a-f]{32}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const PAYLOAD_KEYS = ["e", "exp", "iat", "p", "r", "v"];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type TrackingConfig = {
  /** [current, previous?]. Sign sirf secrets[0] se hota hai; verify dono se. */
  secrets: readonly string[];
  ttlSeconds: number;
};

/** Secret jaisa dikhne wala koi aur credential (Supabase secret/service-role, publisher key) galti se yahan na aa jaye. */
function isAcceptableSecret(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < MIN_SECRET_LENGTH || value.length > MAX_SECRET_LENGTH) return false;
  if (value !== value.trim() || /\s/.test(value)) return false;
  if (value.startsWith("sb_secret_") || value.startsWith("blc_live_") || value.startsWith("eyJ")) return false;
  // .env.example ka placeholder (YOUR-...) ya "PASTE-/CHANGE-/EXAMPLE-/REPLACE-..." jaisa text copy hokar kabhi asli secret na ban jaye.
  if (/^(YOUR|PASTE|CHANGE|EXAMPLE|REPLACE|SAMPLE|DUMMY)[-_ ]/i.test(value)) return false;
  return true;
}

/** Sirf diagnosis ke liye (log ka label chunne me): secret set hi nahi, set par code ne reject kiya, ya theek. Value kabhi nahi lautati. */
export function trackingSecretStatus(env: Record<string, string | undefined>): "not_set" | "rejected" | "ok" {
  const current = env.AD_TRACKING_SECRET;
  if (typeof current !== "string" || current.length === 0) return "not_set";
  return isAcceptableSecret(current) ? "ok" : "rejected";
}

/**
 * env se config. Secret missing/kamzor/galat ho toh null: tracking band (ad phir bhi pehle jaisa milta hai, bas `tracking` nahi).
 * TTL galat ho toh default; range 60 s .. 24 ghante.
 */
export function readTrackingConfig(env: Record<string, string | undefined>): TrackingConfig | null {
  const current = env.AD_TRACKING_SECRET;
  if (!isAcceptableSecret(current)) return null;
  const secrets: string[] = [current];
  const previous = env.AD_TRACKING_SECRET_PREVIOUS;
  if (isAcceptableSecret(previous) && previous !== current) secrets.push(previous);

  let ttlSeconds = DEFAULT_TTL_SECONDS;
  const rawTtl = env.AD_TRACKING_TTL_SECONDS;
  if (typeof rawTtl === "string" && /^[0-9]{1,6}$/.test(rawTtl)) {
    const n = Number(rawTtl);
    if (n >= MIN_TTL_SECONDS && n <= MAX_TTL_SECONDS) ttlSeconds = n;
  }
  return { secrets, ttlSeconds };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data, "utf8").digest();
}

/** Publisher ka one-way tag (secret ke bina publisher id wapas nahi nikalta). */
export function publisherTag(secret: string, publisherId: string): string {
  return hmac(secret, `blisscco:tracking:pub:${publisherId.toLowerCase()}`).toString("hex").slice(0, 32);
}

function sign(secret: string, payloadB64: string): Buffer {
  return hmac(secret, `blisscco:tracking:${TRACKING_TOKEN_PREFIX}:${payloadB64}`);
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sirf canonical base64url (padding/extra characters/alag encoding wale "dusre roop" reject): token malleability band. */
export function decodeCanonicalB64Url(s: string): Buffer | null {
  if (s.length === 0 || !B64URL_RE.test(s)) return null;
  const buf = Buffer.from(s, "base64url");
  return buf.toString("base64url") === s ? buf : null;
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

export type TrackingGrant = {
  token: string;
  expiresAtMs: number;
  events: readonly TrackingEvent[];
};

export type MintInput = {
  serveRef: string;
  publisherId: string;
  /** Database ka serve ka samay (ad_serve_log.served_at). Exp isi se bandhi hai. */
  servedAtMs: number;
  nowMs: number;
};

/**
 * Deterministic: wahi serve (wahi ref, publisher, served_at) hamesha wahi token deta hai, isliye retry me alag "doosra" token nahi banta.
 * null = token nahi banta (ref/publisher galat, serve ka samay bhavishya me, ya serve ki ijazat-avadhi nikal chuki).
 */
export function mintTrackingToken(config: TrackingConfig, input: MintInput): TrackingGrant | null {
  const { serveRef, publisherId, servedAtMs, nowMs } = input;
  if (typeof serveRef !== "string" || !SERVE_REF_RE.test(serveRef)) return null;
  if (typeof publisherId !== "string" || !isUuid(publisherId)) return null;
  if (!Number.isFinite(servedAtMs) || !Number.isFinite(nowMs)) return null;
  if (servedAtMs > nowMs + CLOCK_SKEW_SECONDS * 1000) return null;

  const iat = Math.floor(servedAtMs / 1000);
  const exp = iat + config.ttlSeconds;
  if (nowMs >= exp * 1000) return null; // serve purana: ijazat khatam, naya token nahi

  const secret = config.secrets[0];
  const payload = JSON.stringify({
    v: 1,
    r: serveRef,
    p: publisherTag(secret, publisherId),
    e: [...TRACKING_EVENTS],
    iat,
    exp,
  });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sigB64 = sign(secret, payloadB64).toString("base64url");
  return {
    token: `${TRACKING_TOKEN_PREFIX}.${payloadB64}.${sigB64}`,
    expiresAtMs: exp * 1000,
    events: TRACKING_EVENTS,
  };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export type TokenFailure =
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_event_type"
  | "unknown_serve"
  | "publisher_mismatch"
  | "serve_mismatch"
  | "unavailable";

export type TokenClaims = {
  serveRef: string;
  publisherTag: string;
  events: readonly TrackingEvent[];
  issuedAtMs: number;
  expiresAtMs: number;
  /** Kaun sa secret match hua (0 = current, 1 = previous). */
  secretIndex: number;
};

export type VerifyResult = { ok: true; claims: TokenClaims } | { ok: false; reason: TokenFailure };

const fail = (reason: TokenFailure): { ok: false; reason: TokenFailure } => ({ ok: false, reason });

function isEventType(v: unknown): v is TrackingEvent {
  return typeof v === "string" && (TRACKING_EVENTS as readonly string[]).includes(v);
}

/**
 * Sirf token ki apni jaanch (database ke bina): shape, signature, expiry, aur event type ki ijazat.
 * Kabhi throw nahi karta. Galat/anjaana event type (jaise "serve", ya ijazat me na ho) => wrong_event_type.
 */
export function verifyTrackingToken(
  token: unknown,
  event: unknown,
  config: TrackingConfig,
  nowMs: number,
): VerifyResult {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return fail("malformed");
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== TRACKING_TOKEN_PREFIX) return fail("malformed");
    const [, payloadB64, sigB64] = parts;
    const payloadBuf = decodeCanonicalB64Url(payloadB64);
    const sigBuf = decodeCanonicalB64Url(sigB64);
    if (!payloadBuf || !sigBuf || sigBuf.length !== 32) return fail("malformed");

    // Signature PEHLE: payload ko tabhi bharose me lete hain jab signature sahi ho.
    let secretIndex = -1;
    for (let i = 0; i < config.secrets.length; i += 1) {
      if (safeEqual(sign(config.secrets[i], payloadB64), sigBuf)) secretIndex = i;
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

    const { v, r, p, e, iat, exp } = obj;
    if (v !== 1) return fail("malformed");
    if (typeof r !== "string" || !SERVE_REF_RE.test(r)) return fail("malformed");
    if (typeof p !== "string" || !PUBLISHER_TAG_RE.test(p)) return fail("malformed");
    if (!Array.isArray(e) || e.length === 0 || e.length > TRACKING_EVENTS.length || !e.every(isEventType)) return fail("malformed");
    if (new Set(e).size !== e.length) return fail("malformed");
    if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return fail("malformed");
    const iatS = iat as number;
    const expS = exp as number;
    if (expS <= iatS || expS - iatS > MAX_TTL_SECONDS) return fail("malformed");

    if (!Number.isFinite(nowMs)) return fail("malformed");
    if (iatS * 1000 > nowMs + CLOCK_SKEW_SECONDS * 1000) return fail("not_yet_valid");
    if (nowMs >= expS * 1000) return fail("expired");

    if (!isEventType(event) || !(e as TrackingEvent[]).includes(event)) return fail("wrong_event_type");

    return {
      ok: true,
      claims: {
        serveRef: r,
        publisherTag: p,
        events: e as TrackingEvent[],
        issuedAtMs: iatS * 1000,
        expiresAtMs: expS * 1000,
        secretIndex,
      },
    };
  } catch {
    return fail("malformed");
  }
}

// ---------------------------------------------------------------------------
// Verify + serve ki database-jaanch (lookup bahar se aata hai)
// ---------------------------------------------------------------------------

/** Database ka serve row (sirf jo jaanch ko chahiye). null = aisa koi serve_ref nahi. */
export type ServeLookup = (serveRef: string) => Promise<{ publisherId: string; servedAtMs: number } | null>;

export type TrackedEventCheck =
  | { ok: true; serveRef: string; publisherId: string; event: TrackingEvent }
  | { ok: false; reason: TokenFailure };

/**
 * Token + asli serve row ka milan: serve_ref maujood ho, publisher wahi ho jis ke liye token bana, aur token ka samay serve ke
 * samay se mel khaye. Ye sirf "is event ko report karne ki ijazat hai" tay karta hai. Ye event NAHI likhta, aur is se
 * "impression hua" sabit nahi hota. (Asli event writer + lookup SQL agle part me.)
 */
export async function verifyTrackedEvent(
  token: unknown,
  event: unknown,
  deps: { config: TrackingConfig; nowMs: number; lookupServe: ServeLookup },
): Promise<TrackedEventCheck> {
  const checked = verifyTrackingToken(token, event, deps.config, deps.nowMs);
  if (!checked.ok) return checked;
  const { claims } = checked;

  let serve: { publisherId: string; servedAtMs: number } | null;
  try {
    serve = await deps.lookupServe(claims.serveRef);
  } catch {
    return fail("unavailable");
  }
  if (!serve) return fail("unknown_serve");

  if (typeof serve.publisherId !== "string" || !isUuid(serve.publisherId) || !Number.isFinite(serve.servedAtMs)) {
    return fail("unavailable");
  }
  const secret = deps.config.secrets[claims.secretIndex];
  const expectedTag = publisherTag(secret, serve.publisherId);
  if (!safeEqual(Buffer.from(expectedTag, "utf8"), Buffer.from(claims.publisherTag, "utf8"))) return fail("publisher_mismatch");
  if (Math.floor(serve.servedAtMs / 1000) * 1000 !== claims.issuedAtMs) return fail("serve_mismatch");

  return { ok: true, serveRef: claims.serveRef, publisherId: serve.publisherId, event: event as TrackingEvent };
}
