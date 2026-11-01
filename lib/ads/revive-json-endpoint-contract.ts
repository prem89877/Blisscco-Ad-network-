// Day 24 Part 1: controlled JSON endpoint contract ka STRICT, reusable validator (repo-root wali endpoint setup guide ke mutabiq; file ka naam hi guide ke naam se milta hai).
//
// Yeh module sirf validate karta hai. Production me attach NAHI hai: serving, fallback, billing, tracking, ledger, DB, env, network
// kuch nahi chhuta, aur koi flag chalu nahi karta. Koi log nahi. Kabhi throw nahi karta.
//
// Contract (response body, ek JSON object, <= 65,536 UTF-8 bytes):
//   { "headline": string, "body": string, "cta_text": string | null (optional), "destination_url": "https://..." }
//
// Niyam (project ke maujooda creative rules ke saath compatible; tests inhe maujooda provider-creative extract + build functions se milate hain):
//   - headline 1..HEADLINE_MAX, body 1..BODY_MAX, cta_text 0..CTA_MAX (khali/whitespace/null/omitted => null); trim ke baad ginti.
//   - plain text: koi `<` `>`, koi HTML entity (&amp; / &#38; / &#x26;), koi control character nahi.
//   - destination_url: project ke safeDestination rule se (https, koi credentials nahi, max 2048). Result me normalized href.
//   - executable/markup keys (html, script, iframe, adm, ...) => poora payload reject (case-insensitive).
//   - baaki anjaani keys: default me IGNORE (adapter jaisa) aur result me nahi aati; strictFields:true par reject.
//
// Galti ka jawab sirf fixed reason code hai. Raw input, field ki value, destination URL ya koi secret kabhi nahi.

import { safeDestination } from "./click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "../campaigns/creative-validation";

/** Guide ke mutabiq 65,536 UTF-8 bytes. Adapter ke limit ke barabar hone ki jaanch test me hai (yahan adapter import nahi hota). */
export const JSON_ENDPOINT_MAX_BYTES = 65536;

export const JSON_ENDPOINT_REQUIRED_FIELDS: readonly string[] = Object.freeze(["headline", "body", "destination_url"]);
export const JSON_ENDPOINT_OPTIONAL_FIELDS: readonly string[] = Object.freeze(["cta_text"]);
export const JSON_ENDPOINT_ALLOWED_FIELDS: readonly string[] = Object.freeze(["headline", "body", "cta_text", "destination_url"]);

/** Inn keys ka matlab executable/markup creative: poora payload reject (maujooda provider adapter ki list ke barabar; test drift pakadta hai). */
export const JSON_ENDPOINT_EXECUTABLE_KEYS: ReadonlySet<string> = new Set([
  "html", "script", "scripts", "js", "javascript", "iframe", "tag", "code", "markup", "adm", "creative_html", "ad_html", "body_html", "snippet", "embed", "vast", "xml",
]);

export const JSON_ENDPOINT_REASONS = [
  "invalid_input",
  "invalid_utf8",
  "too_large",
  "invalid_json",
  "not_an_object",
  "executable_field",
  "unknown_field",
  "missing_field",
  "invalid_headline",
  "invalid_body",
  "invalid_cta_text",
  "invalid_destination",
] as const;

export type JsonEndpointReason = (typeof JSON_ENDPOINT_REASONS)[number];

export type JsonEndpointCreative = Readonly<{
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
}>;

export type JsonEndpointValidation =
  | Readonly<{ ok: true; creative: JsonEndpointCreative }>
  | Readonly<{ ok: false; reason: JsonEndpointReason }>;

export type JsonEndpointOptions = Readonly<{ strictFields?: boolean }>;

// Har reason ka ek hi pehle se bana, frozen object: galti ke result me input se aaya kuch bhi ho hi nahi sakta.
const FAILURES: Readonly<Record<JsonEndpointReason, JsonEndpointValidation>> = Object.freeze(
  Object.fromEntries(JSON_ENDPOINT_REASONS.map((r) => [r, Object.freeze({ ok: false as const, reason: r })])) as Record<JsonEndpointReason, JsonEndpointValidation>,
);
const fail = (reason: JsonEndpointReason): JsonEndpointValidation => FAILURES[reason];

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Plain text: trim ke baad 1..max (allowEmpty par 0..max => ""), koi < > entity ya control char nahi. Warna null. */
function plainText(raw: unknown, max: number, allowEmpty: boolean): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0) return allowEmpty ? "" : null;
  if (text.length > max) return null;
  if (/[<>]/.test(text) || CONTROL_RE.test(text) || ENTITY_RE.test(text)) return null;
  return text;
}

/** Parsed JSON object => safe normalized creative ya fixed reason. Size ki jaanch yahan bhi (dobara serialize karke). */
export function validateJsonEndpointPayload(input: unknown, options: JsonEndpointOptions = {}): JsonEndpointValidation {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return fail("not_an_object");
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input);
    } catch {
      return fail("invalid_input");
    }
    if (typeof serialized !== "string") return fail("invalid_input");
    if (serialized.length > JSON_ENDPOINT_MAX_BYTES || new TextEncoder().encode(serialized).byteLength > JSON_ENDPOINT_MAX_BYTES) return fail("too_large");
    return validateObject(input as Record<string, unknown>, options?.strictFields === true);
  } catch {
    return fail("invalid_input");
  }
}

/** Raw response body (JSON text ya bytes) => safe normalized creative ya fixed reason. 65,536 UTF-8 bytes ki hadd yahan lagti hai. */
export function validateJsonEndpointText(input: unknown, options: JsonEndpointOptions = {}): JsonEndpointValidation {
  try {
    let text: string;
    if (typeof input === "string") {
      if (input.length > JSON_ENDPOINT_MAX_BYTES) return fail("too_large"); // UTF-16 units <= UTF-8 bytes, isliye yeh pakka oversize hai
      if (LONE_SURROGATE_RE.test(input)) return fail("invalid_utf8");
      if (new TextEncoder().encode(input).byteLength > JSON_ENDPOINT_MAX_BYTES) return fail("too_large");
      text = input;
    } else if (input instanceof Uint8Array) {
      if (input.byteLength > JSON_ENDPOINT_MAX_BYTES) return fail("too_large");
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
      } catch {
        return fail("invalid_utf8");
      }
    } else {
      return fail("invalid_input");
    }
    if (text.trim() === "") return fail("invalid_json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail("invalid_json");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return fail("not_an_object");
    return validateObject(parsed as Record<string, unknown>, options?.strictFields === true);
  } catch {
    return fail("invalid_input");
  }
}

function validateObject(obj: Record<string, unknown>, strictFields: boolean): JsonEndpointValidation {
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (JSON_ENDPOINT_EXECUTABLE_KEYS.has(key.toLowerCase())) return fail("executable_field");
  }
  if (strictFields) {
    for (const key of keys) {
      if (!JSON_ENDPOINT_ALLOWED_FIELDS.includes(key)) return fail("unknown_field");
    }
  }
  const own = (k: string): boolean => Object.prototype.hasOwnProperty.call(obj, k);
  for (const k of JSON_ENDPOINT_REQUIRED_FIELDS) {
    if (!own(k) || obj[k] === undefined || obj[k] === null) return fail("missing_field");
  }

  const headline = plainText(obj.headline, HEADLINE_MAX, false);
  if (headline === null) return fail("invalid_headline");
  const body = plainText(obj.body, BODY_MAX, false);
  if (body === null) return fail("invalid_body");

  let ctaText: string | null = null;
  if (own("cta_text") && obj.cta_text !== null && obj.cta_text !== undefined) {
    const cta = plainText(obj.cta_text, CTA_MAX, true);
    if (cta === null) return fail("invalid_cta_text");
    ctaText = cta === "" ? null : cta;
  }

  const destinationUrl = safeDestination(obj.destination_url);
  if (destinationUrl === null) return fail("invalid_destination");

  return Object.freeze({ ok: true as const, creative: Object.freeze({ headline, body, ctaText, destinationUrl }) });
}
