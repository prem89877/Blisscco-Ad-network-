import { checkHttpsUrl } from "@/lib/accounts/validation";
import { MAX_TOKEN_LENGTH } from "./tracking-token";
import { verifyClickRefForServe, type ClickRefFailure } from "./click-ref";
import type { TrackingConfig } from "./tracking-token";
import { deliverClickToAdapter, type AdapterDelivery, type AdProviderAdapter } from "./provider-adapter";

// Day 12 Prompt 5 Part 3: CLICK redirect ka PURA logic (koi database/env/server-only/logging nahi; sab kuch `deps` se aata hai, isliye bina database ke test hota hai).
//
// Flow (GET /api/v1/ads/click?ref=bc1....):
//   1. Query me SIRF `ref`. Koi aur parameter (url, dest, redirect, next, ...) = reject. Destination caller se KABHI nahi li jaati.
//   2. ref: signature, expiry, serve ka milan (publisher + creative DATABASE ke serve row se) = lib/ads/click-ref.ts (Part 2).
//   3. Destination: DATABASE ke creative row se (lookup ke jawab me). Creative approved + campaign/advertiser active na ho toh redirect NAHI.
//      Destination ko phir app me jaanchte hain (https, no userinfo, no IP/localhost, <= 2048): jaali/purana DB data bhi open redirect nahi ban sakta.
//   4. Click likhna: atomic DB function (ek serve = ek click; dobara click = duplicate, kuch naya nahi). User phir bhi destination par jaata hai.
// Click ka matlab: sirf "is serve ke ad par redirect se click aaya". Billing/spend yahan nahi chhuta.

export const CLICK_PARAM = "ref";
export const MAX_DESTINATION_LENGTH = 2048;

/** Lookup ka jawab (click-db.ts parse karta hai). destinationUrl = null jab creative click ke layak nahi. */
export type ClickServeRow = {
  publisherId: string;
  creativeId: string;
  servedAtMs: number;
  destinationUrl: string | null;
  eligible: boolean;
};

export type RecordClickOutcome =
  | { outcome: "recorded" | "duplicate" | "not_counted"; destinationUrl: string }
  | { outcome: "rejected" | "ineligible" | "error" };

export type ClickDeps = {
  /** null = signing secret set nahi/kamzor: koi ref verify nahi ho sakta => unavailable. */
  config: TrackingConfig | null;
  nowMs: () => number;
  /** Serve + creative + destination database se. null = aisi serve nahi. Throw = database dikkat. */
  lookupServe: (serveRef: string) => Promise<ClickServeRow | null>;
  /** Atomic writer. serve_ref + (lookup se) publisher + creative; database khud dobara jaanchta hai. */
  record: (serveRef: string, publisherId: string, creativeId: string) => Promise<RecordClickOutcome>;
  /** Part 4: future provider adapter (provider-adapter.ts). Default: koi nahi. Sirf "recorded" ke BAAD sunta hai; redirect/destination par koi asar nahi. */
  adapter?: AdProviderAdapter | null;
  adapterTimeoutMs?: number;
  /** Optional: adapter ka natija (delivered/failed/timeout) dekhne ke liye. Throw kare toh ignore. */
  onAdapterOutcome?: (delivery: AdapterDelivery) => void;
};

export type ClickQueryFailure = "missing_ref" | "unexpected_parameter" | "invalid_ref";
export type ClickQueryResult = { ok: true; ref: string } | { ok: false; reason: ClickQueryFailure };

/** Query ki strict jaanch: EXACT ek parameter `ref`, ek hi baar. Destination jaisa koi bhi aur parameter reject. */
export function parseClickQuery(params: URLSearchParams): ClickQueryResult {
  const keys = [...params.keys()];
  if (keys.length === 0) return { ok: false, reason: "missing_ref" };
  if (keys.some((k) => k !== CLICK_PARAM) || keys.length > 1) return { ok: false, reason: "unexpected_parameter" };
  const ref = params.get(CLICK_PARAM);
  if (ref === null || ref.length === 0 || ref.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "invalid_ref" };
  return { ok: true, ref };
}

/**
 * Destination ki jaanch. Wahi https-rules jo creative banate waqt lagte hain (checkHttpsUrl: https only, no userinfo/'@', no IP, no localhost, no spaces),
 * aur length <= 2048. Theek ho toh parsed (ASCII, normalized) href, warna null. Kabhi throw nahi karta.
 */
export function safeDestination(raw: unknown): string | null {
  try {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_DESTINATION_LENGTH) return null;
    if (checkHttpsUrl(raw) !== undefined) return null;
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const href = parsed.href;
    if (href.length > MAX_DESTINATION_LENGTH || /[\u0000-\u0020\u007f]/.test(href)) return null;
    return href;
  } catch {
    return null;
  }
}

/**
 * redirect    : user ko `location` par bhejo. counted = recorded (is serve ka pehla click) | duplicate (pehle ho chuka) | not_counted (click gina nahi gaya, redirect phir bhi hota hai).
 * invalid     : ref me kuch galat (shape, signature, expiry, anjaani serve, doosre publisher/creative ka). Wajah JAAN-BOOJH kar nahi bataate.
 * unavailable_target : ref theek par creative missing/click ke layak nahi, ya destination jaanch me fail: REDIRECT NAHI.
 * unavailable : database / config dikkat. Dobara koshish surakshit hai.
 */
export type ClickResult =
  | { kind: "redirect"; location: string; counted: "recorded" | "duplicate" | "not_counted" }
  | { kind: "invalid"; reason: ClickRefFailure }
  | { kind: "unavailable_target" }
  | { kind: "unavailable" };

/** Kabhi throw nahi karta. */
export async function acceptClick(ref: unknown, deps: ClickDeps): Promise<ClickResult> {
  try {
    if (!deps.config) return { kind: "unavailable" };

    // Lookup ka poora row yaad rakhte hain (ref verify ke liye wahi lookup chalta hai: ek database call).
    let row: ClickServeRow | null = null;
    const checked = await verifyClickRefForServe(ref, {
      config: deps.config,
      nowMs: deps.nowMs(),
      lookupServe: async (serveRef) => {
        row = await deps.lookupServe(serveRef);
        return row ? { publisherId: row.publisherId, creativeId: row.creativeId, servedAtMs: row.servedAtMs } : null;
      },
    });
    if (!checked.ok) return checked.reason === "unavailable" ? { kind: "unavailable" } : { kind: "invalid", reason: checked.reason };

    // Click ke layak creative + destination jaanch: YE record se PEHLE, taaki disallowed destination ka click gina hi na jaye.
    const found = row as ClickServeRow | null;
    if (!found || !found.eligible || safeDestination(found.destinationUrl) === null) return { kind: "unavailable_target" };

    const written = await deps.record(checked.serveRef, checked.publisherId, checked.creativeId);
    if (written.outcome === "recorded" && deps.adapter) {
      // Blisscco ka apna click DB me ho chuka. Adapter sirf copy sunta hai; natija redirect ko nahi chhuta.
      const delivery = await deliverClickToAdapter(
        deps.adapter,
        { serveRef: checked.serveRef, publisherId: checked.publisherId, creativeId: checked.creativeId, occurredAtMs: deps.nowMs() },
        deps.adapterTimeoutMs,
      );
      try {
        deps.onAdapterOutcome?.(delivery);
      } catch {
        // observer ki galti click ko nahi chhuti
      }
    }
    switch (written.outcome) {
      case "recorded":
      case "duplicate":
      case "not_counted": {
        // Redirect usi destination par jo database ne ABHI diya (record ke waqt ka); use dobara jaanchte hain.
        const location = safeDestination(written.destinationUrl);
        if (location === null) return { kind: "unavailable_target" };
        return { kind: "redirect", location, counted: written.outcome };
      }
      case "ineligible":
        return { kind: "unavailable_target" };
      case "rejected":
        return { kind: "invalid", reason: "unknown_serve" };
      default:
        return { kind: "unavailable" };
    }
  } catch {
    return { kind: "unavailable" };
  }
}
