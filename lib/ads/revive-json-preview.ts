// Day 24 Part 2: alag se control hone wala, SERVER-SIDE JSON endpoint PROTOTYPE ka logic (route: app/api/revive-json-preview/route.ts).
//
// Yeh sirf prototype hai. Yeh Revive fallback se, publisher match API se, serving, billing, tracking, ledger, DB ya network se KUCH nahi jodta.
// Default: BAND. Sirf server-side flag REVIVE_JSON_PREVIEW_ENABLED, exact "true" par chalu (REVIVE_FALLBACK_ENABLED se bilkul alag).
//
// Niyam:
//   1. Band => fixed 404 (body/headers fixed). Koi config, flag ka naam ya "disabled" ka ishara nahi.
//   2. Creative SIRF server-side provider function se aata hai. Request (URL, query, headers, cookies, body) yahan padhi hi nahi jaati:
//      handler ko request milti hi nahi, isliye browser se destination ya creative control nahi ho sakta.
//   3. Provider ka output day24-part1 validator se guzarta hai; response validated, normalized 4 fields se banta hai (provider ka raw output nahi).
//      Galat/exception/timeout => fixed 503. Koi provider text, URL ya error aage nahi jaata. Koi log nahi.
//   4. Headers fixed: strict JSON content-type, no-store, nosniff. Koi cookie set nahi, koi redirect nahi (sirf 200/404/503).
//   5. Default provider ek fixed, nakli (example.com) test creative deta hai. Koi real advertiser, credential ya URL nahi.

import { JSON_ENDPOINT_MAX_BYTES, validateJsonEndpointPayload } from "./revive-json-endpoint-contract";

export const PREVIEW_ENV_FLAG = "REVIVE_JSON_PREVIEW_ENABLED";
export const PREVIEW_PROVIDER_TIMEOUT_MS = 1500;
export const PREVIEW_CONTENT_TYPE = "application/json; charset=utf-8";

export type PreviewEnv = Readonly<Record<string, string | undefined>>;
export type PreviewProvider = () => unknown | Promise<unknown>;
export type PreviewDeps = Readonly<{ env?: PreviewEnv; provider?: PreviewProvider; timeoutMs?: number }>;

/** Sirf exact "true" (koi trim/case-folding nahi). Kabhi throw nahi karta. */
export function previewEnabled(env: PreviewEnv | null | undefined): boolean {
  try {
    return env !== null && env !== undefined && env[PREVIEW_ENV_FLAG] === "true";
  } catch {
    return false;
  }
}

/** Fixed, nakli test creative. Har call par naya object. Koi env/query/header/network nahi. */
export const defaultPreviewProvider: PreviewProvider = () => ({
  headline: "TEST FIXTURE: Sample sponsored headline",
  body: "Static placeholder text for the preview route. Not a real advertiser.",
  cta_text: "Learn more",
  destination_url: "https://example.com/blisscco-revive-test-fixture",
});

function respond(status: 200 | 404 | 503, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": PREVIEW_CONTENT_TYPE,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

const notFound = (): Response => respond(404, { error: "not_found" });
const unavailable = (): Response => respond(503, { error: "unavailable" });

/** Kabhi throw/reject nahi karta. Request ka koi hissa nahi padhta. */
export async function handlePreviewGet(deps: PreviewDeps = {}): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const env = deps.env ?? (typeof process !== "undefined" ? process.env : undefined);
    if (!previewEnabled(env)) return notFound();

    const provider = deps.provider ?? defaultPreviewProvider;
    const timeoutMs = typeof deps.timeoutMs === "number" && deps.timeoutMs > 0 ? deps.timeoutMs : PREVIEW_PROVIDER_TIMEOUT_MS;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const call = Promise.resolve().then(() => provider());
    call.catch(() => undefined); // deadline ke baad late reject => unhandled rejection nahi
    const raw = await Promise.race([call, deadline]);
    if (raw === "timeout") return unavailable();

    const checked = validateJsonEndpointPayload(raw);
    if (!checked.ok) return unavailable();
    const c = checked.creative;
    const payload = { headline: c.headline, body: c.body, cta_text: c.ctaText, destination_url: c.destinationUrl };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > JSON_ENDPOINT_MAX_BYTES) return unavailable();
    return respond(200, payload);
  } catch {
    return unavailable();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
