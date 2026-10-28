import { isUuid } from "@/lib/campaigns/constants";
import type { MatchRequest } from "./types";

// Publisher ki request ki strict jaanch. Pure functions (database/network nahi).
// Privacy: sirf teen fields allowed hain (topic, fallback_topics, exclude_ad_ids). Koi bhi aur field (prompt, question,
// messages, context, keywords, user, ...) = reject, taaki galti se bhi conversation text hum tak na pahunche.
// `fallback_topics` (Day 11 Part 3) bhi free text nahi hai: har entry wahi strict slug hai jo `topic` hai.

export const MAX_BODY_BYTES = 2048;
export const MAX_EXCLUDE_IDS = 20;
export const MAX_FALLBACK_TOPICS = 2;

const TOPIC_RE = /^[a-z0-9_]{1,50}$/;
const ALLOWED_KEYS: readonly string[] = ["topic", "fallback_topics", "exclude_ad_ids"];

// Idempotency-Key header: 8-64 characters, sirf letters/digits/underscore/hyphen (UUID bhi chalta hai). SQL ka CHECK bhi yahi hai.
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type IdempotencyKeyResult = { ok: true; value: string | undefined } | { ok: false };

/** Header na ho (null) => ok + undefined. Ho par galat shape => ok:false (handler 400 deta hai, chup-chaap ignore nahi karta). */
export function parseIdempotencyKey(header: string | null): IdempotencyKeyResult {
  if (header === null) return { ok: true, value: undefined };
  const value = header.trim();
  if (!IDEMPOTENCY_KEY_RE.test(value)) return { ok: false };
  return { ok: true, value };
}

export type ParseFailure =
  | "invalid_json"
  | "invalid_body"
  | "unknown_field"
  | "invalid_topic"
  | "invalid_exclude_ad_ids";

export type ParseResult = { ok: true; value: MatchRequest } | { ok: false; reason: ParseFailure };

export function parseMatchRequest(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, reason: "invalid_body" };
  }
  const obj = data as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.includes(key)) return { ok: false, reason: "unknown_field" };
  }

  const topic = obj.topic;
  if (typeof topic !== "string" || !TOPIC_RE.test(topic)) {
    return { ok: false, reason: "invalid_topic" };
  }

  // Optional: publisher ke apne diye 0-2 aur topic slugs (priority order). Sirf tab try hote hain jab `topic` par ad na mile.
  // Galat type/shape/slug => wahi 400 `invalid_topic` (naya reason nahi, taaki purane clients ka error-handling na tute).
  // Khali array = field na bhejne jaisa. Duplicate (topic ke barabar bhi) chup-chaap hata diye jaate hain.
  const fallbackTopics: string[] = [];
  const fallback = obj.fallback_topics;
  if (fallback !== undefined) {
    if (!Array.isArray(fallback) || fallback.length > MAX_FALLBACK_TOPICS) {
      return { ok: false, reason: "invalid_topic" };
    }
    const seenTopics = new Set<string>([topic]);
    for (const item of fallback) {
      if (typeof item !== "string" || !TOPIC_RE.test(item)) return { ok: false, reason: "invalid_topic" };
      if (!seenTopics.has(item)) {
        seenTopics.add(item);
        fallbackTopics.push(item);
      }
    }
  }

  let excludeAdIds: string[] = [];
  const exclude = obj.exclude_ad_ids;
  if (exclude !== undefined) {
    if (!Array.isArray(exclude) || exclude.length > MAX_EXCLUDE_IDS) {
      return { ok: false, reason: "invalid_exclude_ad_ids" };
    }
    const seen = new Set<string>();
    for (const item of exclude) {
      if (typeof item !== "string" || !isUuid(item)) {
        return { ok: false, reason: "invalid_exclude_ad_ids" };
      }
      seen.add(item.toLowerCase());
    }
    excludeAdIds = Array.from(seen);
  }

  // `fallbackTopics` key tabhi aati hai jab sach me kuch ho: purani requests ka parsed shape bilkul pehle jaisa rehta hai.
  return { ok: true, value: { topic, excludeAdIds, ...(fallbackTopics.length > 0 ? { fallbackTopics } : {}) } };
}
