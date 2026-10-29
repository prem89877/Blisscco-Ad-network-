import { MAX_TOKEN_LENGTH, verifyTrackedEvent, type ServeLookup, type TrackingConfig } from "./tracking-token";

// Day 12 Part 4: IMPRESSION ingestion ka PURA logic (koi database/env/server-only/logging nahi; sab kuch `deps` se aata hai, isliye bina database ke test hota hai).
//
// Impression ki paribhasha (DAY12-PART4-IMPRESSION.md):
//   Ek impression = ad_events me ek 'impression' row, jo (1) asli kamyab serve se juda hai (token ka serve_ref database me maujood),
//   (2) usi publisher ka hai jis ke liye token bana, (3) token ki expiry (aur serve ke 24 ghante) ke andar aaya, (4) us serve ka PEHLA impression hai.
//   Serve, API response, page load, token milna: inme se koi impression nahi hai. Sirf ye path (aur uska DB writer record_ad_impression) impression likhta hai.
//
// Browser/publisher ko SIRF token chahiye. Publisher, campaign, creative, serve ki id caller se kabhi nahi li jaati: DB serve_ref se khud nikalta hai.
// Dedupe yahan nahi hota: DATABASE me unique (serve_id, event_type) + ON CONFLICT DO NOTHING hai. Yahan sirf saaf nateeja milta hai.

/** Body me sirf do fields: token aur event. Koi aur field (prompt, user, ids, timestamp, ...) = reject. */
export const IMPRESSION_EVENT = "impression" as const;
export const MAX_IMPRESSION_BODY_BYTES = 1024;
const ALLOWED_KEYS: readonly string[] = ["token", "event"];

export type ImpressionParseFailure = "invalid_json" | "invalid_body" | "unknown_field" | "invalid_token" | "invalid_event";

export type ImpressionParseResult =
  | { ok: true; value: { token: string; event: typeof IMPRESSION_EVENT } }
  | { ok: false; reason: ImpressionParseFailure };

/**
 * Request body ki strict jaanch. Token ki ASLI jaanch (signature, expiry) yahan nahi: wo acceptImpression me hoti hai.
 * Yahan sirf shape: token = bina khali string, MAX_TOKEN_LENGTH se chhota; event = EXACT "impression" (click/serve/baaki = invalid_event).
 */
export function parseImpressionRequest(raw: string): ImpressionParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "invalid_body" };
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.includes(key)) return { ok: false, reason: "unknown_field" };
  }
  const { token, event } = obj;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "invalid_token" };
  if (event !== IMPRESSION_EVENT) return { ok: false, reason: "invalid_event" };
  return { ok: true, value: { token, event: IMPRESSION_EVENT } };
}

/** Database writer ka nateeja (record_ad_impression). */
export type RecordImpressionOutcome = "recorded" | "duplicate" | "rejected" | "error";

export type ImpressionDeps = {
  /** null = tracking secret set nahi/kamzor: koi token verify nahi ho sakta => unavailable (caller ki galti nahi). */
  config: TrackingConfig | null;
  nowMs: () => number;
  /** Serve ka (publisher, served_at) database se. null = aisi serve nahi. Throw = database dikkat. */
  lookupServe: ServeLookup;
  /** Atomic writer. serve_ref + serve ka publisher (lookup se); baaki sab database khud dhoondta hai. */
  record: (serveRef: string, publisherId: string) => Promise<RecordImpressionOutcome>;
};

/**
 * recorded     : is serve ka PEHLA impression ab likha gaya.
 * duplicate    : is serve ka impression pehle ho chuka tha (retry / replay / double callback): kuch naya nahi likha, count nahi badha.
 * unauthorized : token ya serve me kuch bhi galat (signature, expiry, anjaani serve, doosre publisher ka, event type ki ijazat nahi...).
 *                Wajah JAAN-BOOJH kar nahi bataate: ek jaisa jawab, taaki endpoint se kuch jaanch-padtaal na ho sake.
 * unavailable  : database / config dikkat. Dobara bhejna surakshit hai (dedupe database me hai).
 */
export type ImpressionResult = { kind: "recorded" } | { kind: "duplicate" } | { kind: "unauthorized" } | { kind: "unavailable" };

/** Kabhi throw nahi karta. */
export async function acceptImpression(token: unknown, event: unknown, deps: ImpressionDeps): Promise<ImpressionResult> {
  try {
    if (!deps.config) return { kind: "unavailable" };

    // 1. Token (signature -> expiry -> event type ki ijazat) + serve ka database se milan (publisher, served_at). Bina database ke jaali token yahin ruk jaata hai.
    const checked = await verifyTrackedEvent(token, event, { config: deps.config, nowMs: deps.nowMs(), lookupServe: deps.lookupServe });
    if (!checked.ok) return checked.reason === "unavailable" ? { kind: "unavailable" } : { kind: "unauthorized" };
    if (checked.event !== IMPRESSION_EVENT) return { kind: "unauthorized" };

    // 2. Atomic likhna. Dedupe database ka kaam hai (unique constraint), app ke memory ka nahi.
    const outcome = await deps.record(checked.serveRef, checked.publisherId);
    switch (outcome) {
      case "recorded":
        return { kind: "recorded" };
      case "duplicate":
        return { kind: "duplicate" };
      case "rejected":
        return { kind: "unauthorized" };
      default:
        return { kind: "unavailable" };
    }
  } catch {
    return { kind: "unavailable" };
  }
}
