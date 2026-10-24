import { isUuid } from "@/lib/campaigns/constants";
import type { MatchRequest } from "./types";

// Publisher ki request ki strict jaanch. Pure functions (database/network nahi).
// Privacy: sirf do fields allowed hain. Koi bhi aur field (prompt, messages, user, ...) = reject,
// taaki galti se bhi conversation text hum tak na pahunche.

export const MAX_BODY_BYTES = 2048;
export const MAX_EXCLUDE_IDS = 20;

const TOPIC_RE = /^[a-z0-9_]{1,50}$/;
const ALLOWED_KEYS: readonly string[] = ["topic", "exclude_ad_ids"];

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

  return { ok: true, value: { topic, excludeAdIds } };
}
